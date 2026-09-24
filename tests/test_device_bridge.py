"""Appliance/device lifecycle tests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from custom_components.imprint_refinery.const import DOMAIN
from custom_components.imprint_refinery.device_bridge import (
    async_remove_consumer_device,
    remove_legacy_sensor_entities,
    remove_orphan_consumer_devices,
)


def test_orphan_cleanup_uses_global_appliance_identifiers(monkeypatch) -> None:
    kept = SimpleNamespace(id="kept", identifiers={(DOMAIN, "room__lamp")})
    stale = SimpleNamespace(id="stale", identifiers={(DOMAIN, "old__lamp")})
    registry = SimpleNamespace(async_remove_device=Mock())
    entities = SimpleNamespace(async_remove=Mock())
    monkeypatch.setattr(
        "custom_components.imprint_refinery.device_bridge.dr.async_get",
        lambda hass: registry,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.device_bridge.er.async_get",
        lambda hass: entities,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.device_bridge.er.async_entries_for_device",
        lambda registry, device_id, include_disabled_entities: (
            [SimpleNamespace(entity_id="remote.old_lamp")]
            if device_id == "stale" and include_disabled_entities
            else []
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.device_bridge.dr.async_entries_for_config_entry",
        lambda registry, entry_id: [kept, stale],
    )
    store = SimpleNamespace(data={"appliances": {"room__lamp": {}}})

    remove_orphan_consumer_devices(object(), SimpleNamespace(entry_id="entry"), store)

    registry.async_remove_device.assert_called_once_with("stale")
    entities.async_remove.assert_called_once_with("remote.old_lamp")


def test_legacy_sensor_cleanup_preserves_other_registry_entries(monkeypatch) -> None:
    entities = {
        "sensor.imprint_refinery_status": SimpleNamespace(
            entity_id="sensor.imprint_refinery_status",
            platform=DOMAIN,
        ),
        "sensor.other": SimpleNamespace(
            entity_id="sensor.other",
            platform="other",
        ),
        "remote.imprint": SimpleNamespace(
            entity_id="remote.imprint",
            platform=DOMAIN,
        ),
    }
    registry = SimpleNamespace(
        entities=entities,
        async_remove=lambda entity_id: entities.pop(entity_id),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.device_bridge.er.async_get",
        lambda _hass: registry,
    )

    remove_legacy_sensor_entities(object())

    assert set(entities) == {"sensor.other", "remote.imprint"}


def test_removing_appliance_device_preserves_profile() -> None:
    store = SimpleNamespace(remove_appliance=AsyncMock())
    hass = SimpleNamespace(data={DOMAIN: {"store": store}})
    device = SimpleNamespace(identifiers={(DOMAIN, "room__lamp")})

    assert asyncio.run(async_remove_consumer_device(hass, device)) is True
    store.remove_appliance.assert_awaited_once_with("room__lamp", confirm=True)
