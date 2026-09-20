"""Declarative Home Assistant service contract and representative handlers."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from probatio import Invalid as SchemaInvalid
import pytest
import voluptuous as vol

from custom_components.imprint_refinery.const import DOMAIN
from custom_components.imprint_refinery.ir_formats import (
    IRSignal,
    analyze_signal,
    encode_known_protocol,
)
from custom_components.imprint_refinery.product_spec import Actions, Fields, States
from custom_components.imprint_refinery.services import (
    PANEL_ACTIONS,
    REGISTERED_SERVICES,
    ServiceAPI,
    _schemas,
    icon_schema,
    id_schema,
    import_payload,
    register_services,
    websocket_execute,
)
from custom_components.imprint_refinery.transmission import SendResult


def execute(awaitable):
    return asyncio.run(awaitable)


class StatusLog:
    def __init__(self) -> None:
        self.events = []

    def async_set(self, state, **details) -> None:
        self.events.append((state, details))


class StoreStub:
    def __init__(self) -> None:
        self.emitter = {"ieee": "00:11", "config": {}}
        self.data = {"emitters": {"0011": self.emitter}}
        self.add_location = AsyncMock()

    def choose_emitter(self, key=None):
        return self.emitter

    def command_at(self, location, appliance, command):
        return {"code": "+9000 -4500 +560 -560", "format": "raw_signed"}

    def snapshot(self):
        return {"emitters": [], "locations": []}


def runtime_hass():
    store = StoreStub()
    status = StatusLog()
    queue = SimpleNamespace(
        submit=AsyncMock(return_value=SendResult("token", "0011", 2, 3, 0))
    )
    transport = SimpleNamespace()
    runtime = {
        "store": store,
        "status": status,
        "signal_queue": queue,
        "transport": transport,
        "capture_tasks": {},
    }
    services = SimpleNamespace(registered={})

    def async_register(domain, name, callback, **options):
        services.registered[(domain, name)] = (callback, options)

    services.async_register = async_register
    hass = SimpleNamespace(
        data={DOMAIN: runtime},
        services=services,
        async_add_executor_job=lambda operation: operation(),
    )
    return hass, store, status, queue


def call(action: str, **data):
    return SimpleNamespace(domain=DOMAIN, service=action, data=data, context=None)


def test_panel_inventory_is_unique_complete_and_schema_backed() -> None:
    assert len(PANEL_ACTIONS) == 38
    assert len(set(PANEL_ACTIONS)) == len(PANEL_ACTIONS)
    assert set(_schemas()) == set(PANEL_ACTIONS)
    assert REGISTERED_SERVICES == (Actions.SEND_COMMAND,)


def test_public_scalar_validators_reject_ambiguous_input() -> None:
    assert id_schema(" button_1 ") == "button_1"
    assert icon_schema("") == ""
    assert icon_schema("mdi:remote") == "mdi:remote"
    with pytest.raises((vol.Invalid, SchemaInvalid)):
        id_schema("Button 1")
    with pytest.raises((vol.Invalid, SchemaInvalid)):
        icon_schema("remote")
    with pytest.raises((vol.Invalid, SchemaInvalid), match="too large"):
        import_payload("x" * 2_000_001)


def test_registration_uses_one_declarative_spec_per_service() -> None:
    hass, *_ = runtime_hass()
    with patch(
        "custom_components.imprint_refinery.services.service_helper."
        "async_register_platform_entity_service"
    ) as register:
        api = register_services(hass, lambda reference: reference)
    assert isinstance(api, ServiceAPI)
    register.assert_called_once()
    args, options = register.call_args
    assert args == (hass, DOMAIN, Actions.SEND_COMMAND)
    assert options["entity_domain"] == "remote"
    assert options["func"] == "async_send_stored_command"
    ((field, validator),) = options["schema"].items()
    assert field.schema == Fields.COMMAND_ID
    assert validator(" power ") == "power"


def test_panel_websocket_validates_and_dispatches_internal_action() -> None:
    hass, *_ = runtime_hass()
    handler = AsyncMock(return_value={"status": "saved"})
    hass.data[DOMAIN]["service_api"] = SimpleNamespace(
        handler_for=lambda action: handler
    )
    connection = SimpleNamespace(
        context=lambda message: None,
        send_result=Mock(),
        send_error=Mock(),
    )
    raw_handler = websocket_execute
    while hasattr(raw_handler, "__wrapped__"):
        raw_handler = raw_handler.__wrapped__

    execute(
        raw_handler(
            hass,
            connection,
            {
                "id": 7,
                "type": "imprint_refinery/execute",
                "action": Actions.CREATE_LOCATION,
                "data": {Fields.LOCATION_ID: " den ", Fields.NAME: "Den"},
            },
        )
    )

    handler.assert_awaited_once()
    dispatched = handler.await_args.args[0]
    assert dispatched.data == {Fields.LOCATION_ID: "den", Fields.NAME: "Den"}
    connection.send_result.assert_called_once_with(7, {"status": "saved"})
    connection.send_error.assert_not_called()


def test_send_command_routes_saved_payload_with_library_coordinates() -> None:
    hass, _store, _status, queue = runtime_hass()
    api = ServiceAPI(hass, lambda reference: "0011")
    response = execute(
        api.send_command(
            call(
                Actions.SEND_COMMAND,
                location_id="den",
                appliance_id="projector",
                command_id="power",
                emitter_id="infrared.blaster",
            )
        )
    )
    assert response["status"] == States.SENT_UNCONFIRMED
    submitted = queue.submit.await_args
    assert submitted.args[:3] == (
        "0011",
        {"ieee": "00:11", "config": {}},
        IRSignal([9000, 4500, 560, 560], 38_000),
    )
    route = submitted.kwargs["route"]
    assert (route.location, route.appliance, route.command) == (
        "den",
        "projector",
        "power",
    )


def test_protocol_rebuild_panel_action_returns_canonical_signal_and_carrier() -> None:
    hass, *_ = runtime_hass()

    async def add_executor_job(operation):
        return operation()

    hass.async_add_executor_job = add_executor_job
    api = ServiceAPI(hass, lambda reference: reference)
    api.analyze = AsyncMock(return_value={"protocol": "SIRC"})
    source = encode_known_protocol("SIRC", 16, 18)
    rebuild = next(
        item
        for item in analyze_signal(source, carrier_source="provided")[
            "protocol_rebuilds"
        ]
        if item["protocol"] == "SIRC"
    )
    signed = " ".join(
        f"{'+' if index % 2 == 0 else '-'}{duration}"
        for index, duration in enumerate(source.timings)
    )

    response = execute(
        api.rebuild_signal(
            call(
                Actions.REBUILD_SIGNAL,
                code=signed,
                format="raw_signed",
                carrier_frequency=source.carrier_frequency,
                rebuild_id=rebuild["id"],
            )
        )
    )

    assert response["rebuild"]["protocol"] == "SIRC"
    assert response["signal"]["carrier_frequency"] == 40_000
    assert len(response["signal"]["timings"]) == len(source.timings) * 3
    assert response["analysis"] == {"protocol": "SIRC"}


def test_generic_mutation_plan_calls_store_and_returns_status() -> None:
    hass, store, status, _queue = runtime_hass()
    api = ServiceAPI(hass, lambda reference: reference)
    response = execute(
        api.handler_for(Actions.CREATE_LOCATION)(
            call(Actions.CREATE_LOCATION, location_id="garage", name="Garage")
        )
    )
    store.add_location.assert_awaited_once_with("garage", "Garage")
    assert response == {"status": "saved"}
    assert status.events[-1][0] == States.IDLE


def test_service_strings_and_english_translation_cover_the_same_actions() -> None:
    from pathlib import Path

    root = (
        Path(__file__).resolve().parents[1] / "custom_components" / "imprint_refinery"
    )
    strings = json.loads((root / "strings.json").read_text())
    english = json.loads((root / "translations" / "en.json").read_text())
    assert set(strings["services"]) == set(REGISTERED_SERVICES)
    assert set(english["services"]) == set(REGISTERED_SERVICES)
    assert sorted(path.name for path in (root / "translations").glob("*.json")) == [
        "en.json"
    ]
    icons = json.loads((root / "icons.json").read_text())
    assert set(icons["services"]) == set(REGISTERED_SERVICES)
