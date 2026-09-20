"""Stored-command delivery and live entity projection behavior."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.exceptions import ServiceValidationError
import pytest

from custom_components.imprint_refinery.consumer import (
    ProjectionController,
    SignalSender,
    emitter_key,
)
from custom_components.imprint_refinery.entity_projection import project_library
from custom_components.imprint_refinery.remote import SignalRemote
from custom_components.imprint_refinery.signal_command import RawSignalCommand


def execute(awaitable):
    return asyncio.run(awaitable)


def one_remote(*, emitter: str | None = None, commands=None):
    [plan] = project_library(
        {
            "locations": {
                "family_room": {
                    "appliances": {
                        "television": {
                            "name": "Television",
                            "emitter_id": emitter,
                            "preferred_platform": "remote",
                            "commands": commands
                            or {"power": {"name": "Power", "role": "power_toggle"}},
                        }
                    }
                }
            }
        }
    )
    return plan


class StoreStub:
    def __init__(self, *, commands=None) -> None:
        self.primary = {"ieee": "AA:BB", "config": {}}
        self.data = {
            "emitters": {"aabb": self.primary},
            "locations": {
                "family_room": {
                    "appliances": {
                        "television": {
                            "name": "Television",
                            "preferred_platform": "remote",
                            "commands": commands
                            or {
                                "power": {
                                    "name": "Power",
                                    "role": "power_toggle",
                                    "code": "+9000 -4500 +560 -560",
                                    "format": "raw_signed",
                                }
                            },
                        }
                    }
                }
            },
        }

    def choose_emitter(self, requested=None):
        if requested not in (None, "aabb"):
            from custom_components.imprint_refinery.errors import ImprintRefineryError

            raise ImprintRefineryError("emitter_unavailable", "No such emitter")
        return self.primary

    def command_at(self, location, appliance, command):
        return self.data["locations"][location]["appliances"][appliance]["commands"][
            command
        ]


def test_emitter_key_accepts_object_identity_or_normalized_ieee() -> None:
    store = StoreStub()
    assert emitter_key(store, store.primary) == "aabb"
    assert emitter_key(store, {"ieee": "aa:bb"}) == "aabb"
    with pytest.raises(ServiceValidationError, match="not present"):
        emitter_key(store, {"ieee": "00:00"})


def test_sender_resolves_the_infrared_entity_and_preserves_library_path(
    monkeypatch,
) -> None:
    store = StoreStub()
    plan = one_remote(emitter="aabb")
    registry = SimpleNamespace(
        async_get_entity_id=lambda domain, platform, unique_id: "infrared.hall_blaster"
    )
    delivered = AsyncMock()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: registry,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.infrared.async_send_command",
        delivered,
    )

    execute(SignalSender(object(), store).send(plan, "power", context="ctx"))

    command = delivered.await_args.args[2]
    assert isinstance(command, RawSignalCommand)
    assert command.get_raw_timings() == [9000, -4500, 560, -560]
    assert command.path.location_id == "family_room"
    assert command.path.appliance_id == "television"
    assert command.path.command_id == "power"
    assert delivered.await_args.kwargs == {"context": "ctx"}


def test_sender_reports_missing_command_emitter_and_entity(monkeypatch) -> None:
    store = StoreStub()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: SimpleNamespace(async_get_entity_id=lambda *args: None),
    )

    with pytest.raises(ServiceValidationError, match="no command_id absent"):
        execute(SignalSender(object(), store).send(one_remote(), "absent"))
    with pytest.raises(ServiceValidationError, match="No such emitter"):
        execute(
            SignalSender(object(), store).send(one_remote(emitter="wrong"), "power")
        )
    with pytest.raises(ServiceValidationError, match="was not found"):
        execute(SignalSender(object(), store).send(one_remote(), "power"))


class ProjectionEntity:
    def __init__(self, store, plan) -> None:
        self.unique_id = plan.entity_key
        self.registry_device_key = plan.registry_device_key
        self.entity_id = None
        self.blueprints = [plan]
        self.async_remove = AsyncMock()

    def update_blueprint(self, plan) -> None:
        self.blueprints.append(plan)


def test_projection_adds_updates_and_removes_entities(monkeypatch) -> None:
    store = StoreStub()
    added = []
    controller = ProjectionController(
        object(), store, lambda items: added.extend(items), "remote", ProjectionEntity
    )
    execute(controller.async_sync())
    assert list(controller.entities) == ["family_room__television"]
    assert len(added) == 1

    store.data["locations"]["family_room"]["appliances"]["television"]["name"] = "TV"
    execute(controller.async_sync())
    assert len(added[0].blueprints) == 2

    removed = controller.entities["family_room__television"]
    store.data["locations"]["family_room"]["appliances"].clear()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: SimpleNamespace(
            entities={},
            async_get=lambda entity_id: None,
            async_remove=lambda entity_id: None,
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.dr.async_get",
        lambda hass: SimpleNamespace(async_get_devices=lambda **kwargs: set()),
    )
    execute(controller.async_sync())
    removed.async_remove.assert_awaited_once()
    assert controller.entities == {}


def test_remote_entity_forwards_a_batch_in_order() -> None:
    store = StoreStub()
    remote = SignalRemote(store, one_remote())
    remote.async_send_stored_command = AsyncMock()
    execute(remote.async_send_command(("first", "second", "third")))
    assert [
        call.args[0] for call in remote.async_send_stored_command.await_args_list
    ] == [
        "first",
        "second",
        "third",
    ]
