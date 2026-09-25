"""Live Home Assistant Core infrared inventory tests."""

import asyncio
from datetime import UTC, datetime
from types import SimpleNamespace

from custom_components.imprint_refinery.hardware import (
    async_compatibility_adapter_available,
    discover_infrared_hardware,
)


def test_core_hardware_inventory_is_live_separate_and_includes_adapters(
    monkeypatch,
) -> None:
    emitter = SimpleNamespace(
        id="emitter-uuid",
        entity_id="infrared.renamed_emitter",
        platform="imprint_refinery",
        device_id="device-1",
        name=None,
        original_name="Emitter",
    )
    receiver = SimpleNamespace(
        id="receiver-uuid",
        entity_id="infrared.receiver",
        platform="esphome",
        device_id="device-2",
        name="Learning receiver",
        original_name="Receiver",
    )
    entries = {
        emitter.entity_id: emitter,
        receiver.entity_id: receiver,
    }
    registry = SimpleNamespace(async_get=entries.get)
    devices = SimpleNamespace(
        async_get=lambda device_id: SimpleNamespace(
            id=device_id,
            name_by_user="Living room IR" if device_id == "device-1" else None,
            name="IR hardware",
            area_id="living-room",
        )
    )
    areas = SimpleNamespace(
        async_get_area=lambda area_id: SimpleNamespace(name="Living room")
    )
    states = {
        emitter.entity_id: SimpleNamespace(
            state="idle",
            name="Emitter state",
            last_updated=datetime(2026, 9, 23, 12, 0, tzinfo=UTC),
        ),
        receiver.entity_id: SimpleNamespace(
            state="unavailable",
            name="Receiver",
            last_updated=datetime(2026, 9, 23, 11, 0, tzinfo=UTC),
        ),
    }
    hass = SimpleNamespace(states=SimpleNamespace(get=states.get))
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.er.async_get",
        lambda candidate: registry,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.dr.async_get",
        lambda candidate: devices,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.ar.async_get",
        lambda candidate: areas,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_get_emitters",
        lambda candidate: [emitter.entity_id],
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_get_receivers",
        lambda candidate: [receiver.entity_id],
    )

    inventory = discover_infrared_hardware(hass)

    assert inventory["emitters"] == [
        {
            "ref": "emitter-uuid",
            "entity_id": "infrared.renamed_emitter",
            "name": "Emitter",
            "available": True,
            "last_activity": "2026-09-23T12:00:00+00:00",
            "platform": "imprint_refinery",
            "compatibility_adapter": True,
            "device_id": "device-1",
            "device_name": "Living room IR",
            "device_url": "/config/devices/device/device-1",
            "entity_url": "/config/entities/entity/emitter-uuid",
            "area_name": "Living room",
        }
    ]
    assert inventory["receivers"][0]["ref"] == "receiver-uuid"
    assert inventory["receivers"][0]["available"] is False
    assert inventory["receivers"][0]["last_activity"] == "2026-09-23T11:00:00+00:00"
    assert "receiver_entity_id" not in inventory["emitters"][0]

    emitter.entity_id = "infrared.after_rename"
    entries[emitter.entity_id] = emitter
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_get_emitters",
        lambda candidate: [emitter.entity_id],
    )
    states[emitter.entity_id] = states["infrared.renamed_emitter"]
    refreshed = discover_infrared_hardware(hass)
    assert refreshed["emitters"][0]["ref"] == "emitter-uuid"
    assert refreshed["emitters"][0]["entity_id"] == "infrared.after_rename"


def test_compatibility_adapter_is_offered_only_for_unserved_supported_hardware(
    monkeypatch,
) -> None:
    candidates = {
        "already-core": {"ieee": "00:11"},
        "already-configured": {"ieee": "00:22"},
        "needs-provider": {"ieee": "00:33"},
    }
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.async_discover_zha_adapter_candidates",
        lambda hass: _async_value(candidates),
    )

    available = asyncio.run(
        async_compatibility_adapter_available(
            object(),
            configured_emitter_ids={"0022"},
            core_infrared_device_ids={"already-core"},
        )
    )
    unavailable = asyncio.run(
        async_compatibility_adapter_available(
            object(),
            configured_emitter_ids={"0022", "0033"},
            core_infrared_device_ids={"already-core"},
        )
    )

    assert available is True
    assert unavailable is False


async def _async_value(value):
    return value
