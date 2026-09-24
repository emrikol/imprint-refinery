"""Stored-command delivery and live entity projection behavior."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.components.infrared import InfraredEmitterConsumerEntity

from custom_components.imprint_refinery.consumer import ProjectionController
from custom_components.imprint_refinery.entity_projection import project_library
from custom_components.imprint_refinery.remote import SignalRemote
from custom_components.imprint_refinery.signal_command import RawSignalCommand


def execute(awaitable):
    return asyncio.run(awaitable)


def library(*, emitter: str = "emitter-registry-uuid", name: str = "Television"):
    return {
        "remote_profiles": {
            "television_remote": {
                "name": "Television remote",
                "appliance_type": "generic",
                "commands": {
                    "power": {
                        "name": "Power",
                        "role": "power_toggle",
                        "code": "+9000 -4500 +560 -560",
                        "format": "raw_signed",
                    }
                },
            }
        },
        "appliances": {
            "family_room__television": {
                "name": name,
                "remote_profile_id": "television_remote",
                "infrared_emitter_ref": emitter,
                "preferred_platform": "remote",
            }
        },
    }


def one_remote(*, emitter: str = "emitter-registry-uuid"):
    [plan] = project_library(library(emitter=emitter))
    return plan


class StoreStub:
    def __init__(self) -> None:
        self.data = library()
        self.hass = object()

    def command_at(self, profile: str, command: str):
        return self.data["remote_profiles"][profile]["commands"][command]


def test_projected_entity_uses_core_consumer_send_path(monkeypatch) -> None:
    store = StoreStub()
    registry = SimpleNamespace(
        async_get=lambda entity_id: SimpleNamespace(device_id=None)
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: registry,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_validate_entity_id",
        lambda registry, reference: "infrared.renamed_emitter",
    )
    remote = SignalRemote(store, one_remote())
    remote._send_command = AsyncMock()

    execute(remote.async_send_stored_command("power"))

    command = remote._send_command.await_args.args[0]
    assert isinstance(command, RawSignalCommand)
    assert command.get_raw_timings() == [9000, -4500, 560, -560]
    assert command.path.remote_profile_id == "television_remote"
    assert command.path.appliance_id == "family_room__television"
    assert command.path.command_id == "power"


class ProjectionEntity:
    def __init__(self, store, plan) -> None:
        self.unique_id = plan.entity_key
        self.registry_device_key = plan.registry_device_key
        self.emitter_reference = plan.emitter
        self.entity_id = None
        self.blueprints = [plan]
        self.async_remove = AsyncMock()

    def update_blueprint(self, plan) -> None:
        self.blueprints.append(plan)


def test_projection_adds_updates_removes_and_rebinds(monkeypatch) -> None:
    store = StoreStub()
    added = []
    controller = ProjectionController(
        object(), store, lambda items: added.extend(items), "remote", ProjectionEntity
    )
    execute(controller.async_sync())
    assert list(controller.entities) == ["family_room__television"]
    original = added[0]

    store.data["appliances"]["family_room__television"]["name"] = "TV"
    execute(controller.async_sync())
    assert len(original.blueprints) == 2

    store.data["appliances"]["family_room__television"]["infrared_emitter_ref"] = (
        "second-emitter-uuid"
    )
    execute(controller.async_sync())
    replacement = controller.entities["family_room__television"]
    original.async_remove.assert_awaited_once()
    assert replacement is not original
    assert replacement.unique_id == original.unique_id
    assert replacement.emitter_reference == "second-emitter-uuid"

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
    store.data["appliances"].clear()
    execute(controller.async_sync())
    replacement.async_remove.assert_awaited_once()
    assert controller.entities == {}


def test_remote_entity_forwards_a_batch_in_order(monkeypatch) -> None:
    store = StoreStub()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: SimpleNamespace(
            async_get=lambda entity_id: SimpleNamespace(device_id=None)
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_validate_entity_id",
        lambda registry, reference: "infrared.emitter",
    )
    remote = SignalRemote(store, one_remote())
    remote.async_send_stored_command = AsyncMock()
    execute(remote.async_send_command(("first", "second", "third")))
    assert [
        call.args[0] for call in remote.async_send_stored_command.await_args_list
    ] == ["first", "second", "third"]


def test_projected_remote_is_a_core_infrared_emitter_consumer(monkeypatch) -> None:
    store = StoreStub()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_get",
        lambda hass: SimpleNamespace(
            async_get=lambda entity_id: SimpleNamespace(device_id=None)
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.consumer.er.async_validate_entity_id",
        lambda registry, reference: "infrared.renamed_emitter",
    )

    remote = SignalRemote(store, one_remote())

    assert isinstance(remote, InfraredEmitterConsumerEntity)
    assert remote._infrared_emitter_entity_id == "infrared.renamed_emitter"
