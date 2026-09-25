"""Declarative Home Assistant service contract and representative handlers."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from homeassistant.components.infrared import InfraredReceivedSignal
from probatio import Invalid as SchemaInvalid
import pytest
import voluptuous as vol

from custom_components.imprint_refinery.const import (
    CAPTURE_ARMING_GRACE_SECONDS,
    DOMAIN,
)
from custom_components.imprint_refinery.errors import ImprintRefineryError
from custom_components.imprint_refinery.ir_formats import (
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


def execute(awaitable):
    return asyncio.run(awaitable)


class StoreStub:
    def __init__(self) -> None:
        self.data = {
            "remote_profiles": {
                "projector_profile": {
                    "commands": {
                        "power": {
                            "code": "+9000 -4500 +560 -560",
                            "format": "raw_signed",
                        }
                    }
                }
            },
            "appliances": {
                "projector": {
                    "remote_profile_id": "projector_profile",
                    "infrared_emitter_ref": "emitter-registry-uuid",
                }
            },
        }
        self.create_remote_profile = AsyncMock()
        self.duplicate_command = AsyncMock()

    def command_for_appliance(self, appliance, command):
        return {"code": "+9000 -4500 +560 -560", "format": "raw_signed"}

    def snapshot(self):
        return {"remote_profiles": {}, "appliances": {}}

    def export_backup(self, **kwargs):
        return {
            "schema": "imprint_refinery.backup",
            "version": 2,
            "scope": "library",
            "history": "full",
            "command_count": 1,
            "remote_profiles": {},
            "appliances": {
                "projector": {
                    "name": "Projector",
                    "remote_profile_id": "projector_profile",
                    "preferred_platform": "remote",
                }
            },
        }


def runtime_hass():
    store = StoreStub()
    runtime = {
        "store": store,
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
    return hass, store


def call(action: str, **data):
    return SimpleNamespace(domain=DOMAIN, service=action, data=data, context=None)


def test_panel_inventory_is_unique_complete_and_schema_backed() -> None:
    assert len(set(PANEL_ACTIONS)) == len(PANEL_ACTIONS)
    assert set(_schemas()) == set(PANEL_ACTIONS)
    assert REGISTERED_SERVICES == ()


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


def test_import_inspection_contract_accepts_backend_auto_detection() -> None:
    validated = _schemas()[Actions.INSPECT_IMPORT](
        {Fields.CODE: "Filetype: IR signals file\nVersion: 1", Fields.FORMAT: "auto"}
    )
    assert validated[Fields.FORMAT] == "auto"


def test_catalog_identification_contract_accepts_labeled_captures() -> None:
    validated = _schemas()[Actions.IDENTIFY_CATALOG_SIGNALS](
        {
            Fields.APPLIANCE_TYPE: "light",
            Fields.CAPTURES: [
                {
                    Fields.CODE: "+9000 -4500 +560 -560",
                    Fields.FORMAT: "raw_signed",
                    Fields.ROLE: "power_off",
                },
                {
                    Fields.CODE: "+9000 -4500 +560 -1690",
                    Fields.FORMAT: "raw_signed",
                },
            ],
        }
    )

    assert validated[Fields.CAPTURES][0][Fields.ROLE] == "power_off"
    assert validated[Fields.CAPTURES][1][Fields.ROLE] == ""
    assert validated[Fields.APPLIANCE_TYPE] == "light"
    assert validated[Fields.LIMIT] == 25


def test_registration_installs_only_the_private_panel_api() -> None:
    hass, *_ = runtime_hass()
    api = register_services(hass)
    assert isinstance(api, ServiceAPI)
    assert hass.services.registered == {}


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
                "action": Actions.CREATE_REMOTE_PROFILE,
                "data": {
                    Fields.REMOTE_PROFILE_ID: " television ",
                    Fields.NAME: "Television",
                },
            },
        )
    )

    handler.assert_awaited_once()
    dispatched = handler.await_args.args[0]
    assert dispatched.data == {
        Fields.REMOTE_PROFILE_ID: "television",
        Fields.NAME: "Television",
        Fields.APPLIANCE_TYPE: "generic",
    }
    connection.send_result.assert_called_once_with(7, {"status": "saved"})
    connection.send_error.assert_not_called()


def test_send_command_uses_appliance_route_not_temporary_test_emitter(
    monkeypatch,
) -> None:
    hass, _store = runtime_hass()
    delivered = AsyncMock()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.infrared.async_send_command",
        delivered,
    )
    api = ServiceAPI(hass)
    response = execute(
        api.send_command(
            call(
                Actions.SEND_COMMAND,
                appliance_id="projector",
                command_id="power",
                infrared_emitter_ref="temporary-test-emitter",
            )
        )
    )
    assert response["status"] == States.SENT_UNCONFIRMED
    assert delivered.await_args.args[:2] == (hass, "emitter-registry-uuid")
    command = delivered.await_args.args[2]
    assert command.get_raw_timings() == [9000, -4500, 560, -560]


def test_capture_without_reported_modulation_keeps_assumed_carrier(monkeypatch) -> None:
    hass, *_ = runtime_hass()
    remove = Mock()

    def subscribe(current_hass, receiver_ref, received):
        assert current_hass is hass
        assert receiver_ref == "infrared.receiver"
        received(InfraredReceivedSignal([9000, -4500, 560, -560], None))
        return remove

    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.infrared.async_subscribe_receiver",
        subscribe,
    )

    response = execute(
        ServiceAPI(hass).capture_signal(
            call(
                Actions.CAPTURE_SIGNAL,
                infrared_receiver_ref="infrared.receiver",
                timeout=1,
            )
        )
    )

    assert response["signal"]["carrier_frequency"] == 38_000
    assert response["signal"]["carrier_source"] == "assumed"
    remove.assert_called_once_with()


def test_capture_deadline_includes_receiver_arming_grace(monkeypatch) -> None:
    hass, *_ = runtime_hass()
    remove = Mock()
    observed_timeout = None

    def subscribe(current_hass, receiver_ref, received):
        assert current_hass is hass
        assert receiver_ref == "infrared.receiver"
        return remove

    async def timeout_capture(result, *, timeout):
        nonlocal observed_timeout
        observed_timeout = timeout
        raise TimeoutError

    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.infrared.async_subscribe_receiver",
        subscribe,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.asyncio.wait_for",
        timeout_capture,
    )

    with pytest.raises(ImprintRefineryError, match="60 seconds"):
        execute(
            ServiceAPI(hass).capture_signal(
                call(
                    Actions.CAPTURE_SIGNAL,
                    infrared_receiver_ref="infrared.receiver",
                    timeout=60,
                )
            )
        )

    assert observed_timeout == 60 + CAPTURE_ARMING_GRACE_SECONDS
    remove.assert_called_once_with()


def test_backup_export_includes_only_portable_area_name(monkeypatch) -> None:
    hass, _store = runtime_hass()
    device = SimpleNamespace(id="device-1", area_id="living-room")
    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.dr.async_get",
        lambda current_hass: SimpleNamespace(
            async_get_devices=lambda **kwargs: [device]
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.services.ar.async_get",
        lambda current_hass: SimpleNamespace(
            async_get_area=lambda area_id: SimpleNamespace(
                id=area_id, name="Living room"
            )
        ),
    )

    document = execute(
        ServiceAPI(hass).export_backup(
            call(Actions.EXPORT_BACKUP, include_history=True)
        )
    )

    appliance = document["appliances"]["projector"]
    assert appliance["area_name"] == "Living room"
    assert "area_id" not in appliance
    assert "infrared_emitter_ref" not in appliance


def test_protocol_rebuild_panel_action_returns_canonical_signal_and_carrier() -> None:
    hass, *_ = runtime_hass()

    async def add_executor_job(operation):
        return operation()

    hass.async_add_executor_job = add_executor_job
    api = ServiceAPI(hass)
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
    hass, store = runtime_hass()
    api = ServiceAPI(hass)
    response = execute(
        api.handler_for(Actions.CREATE_REMOTE_PROFILE)(
            call(
                Actions.CREATE_REMOTE_PROFILE,
                remote_profile_id="television",
                name="Television",
                appliance_type="tv",
            )
        )
    )
    store.create_remote_profile.assert_awaited_once_with(
        "television", "Television", appliance_type="tv"
    )
    assert response == {"status": "saved"}


def test_duplicate_command_dispatches_complete_source_and_target_identity() -> None:
    hass, store = runtime_hass()
    response = execute(
        ServiceAPI(hass).handler_for(Actions.DUPLICATE_COMMAND)(
            call(
                Actions.DUPLICATE_COMMAND,
                remote_profile_id="projector_profile",
                command_id="power",
                target_remote_profile_id="bedroom_profile",
                target_command_id="main_power",
                name="Main power",
            )
        )
    )

    store.duplicate_command.assert_awaited_once_with(
        "projector_profile",
        "power",
        "bedroom_profile",
        "main_power",
        "Main power",
    )
    assert response == {"status": "duplicated"}


def test_service_strings_and_english_translation_cover_the_same_actions() -> None:
    from pathlib import Path

    root = (
        Path(__file__).resolve().parents[1] / "custom_components" / "imprint_refinery"
    )
    strings = json.loads((root / "strings.json").read_text())
    english = json.loads((root / "translations" / "en.json").read_text())
    assert set(strings.get("services", {})) == set(REGISTERED_SERVICES)
    assert set(english.get("services", {})) == set(REGISTERED_SERVICES)
    assert sorted(path.name for path in (root / "translations").glob("*.json")) == [
        "en.json"
    ]
    icons = json.loads((root / "icons.json").read_text())
    assert set(icons["services"]) == set(REGISTERED_SERVICES)


def test_legacy_automation_surfaces_are_absent() -> None:
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    integration = root / "custom_components" / "imprint_refinery"
    assert not (integration / "device_action.py").exists()
    assert not (integration / "services.yaml").exists()
    for source in [
        integration / "services.py",
        integration / "strings.json",
        integration / "translations" / "en.json",
        root / "frontend" / "core" / "home-assistant-use.ts",
    ]:
        value = source.read_text()
        assert "send_saved_command" not in value
        assert "imprint_refinery.send_command" not in value
