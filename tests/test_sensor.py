"""Focused tests for emitter capability diagnostics."""

import asyncio
from types import MappingProxyType

from homeassistant.config_entries import ConfigSubentry

from custom_components.imprint_refinery import const as settings
from custom_components.imprint_refinery.sensor import async_setup_entry


def test_capability_sensor_attaches_to_literal_zha_device(monkeypatch) -> None:
    zha_device = object()
    subentry = ConfigSubentry(
        data=MappingProxyType(
            {
                settings.CONF_IEEE: "AA:BB:CC:DD",
                settings.CONF_DRIVER: "zosung_ts1201",
                settings.CONF_TRANSPORT: settings.ZHA_BRIDGE,
                settings.CONF_ENDPOINT_ID: settings.DEFAULT_ENDPOINT_ID,
                settings.CONF_CLUSTER_ID: settings.DEFAULT_CLUSTER_ID,
            }
        ),
        subentry_id="sub-1",
        subentry_type=settings.EMITTER_SUBENTRY_TYPE,
        title="Living room",
        unique_id="aabbccdd",
    )
    entry = type(
        "Entry",
        (),
        {
            "entry_id": "hub",
            "get_subentries_of_type": lambda self, kind: [subentry],
        },
    )()
    hass = type("Hass", (), {"data": {settings.DOMAIN: {}}})()
    added = []
    monkeypatch.setattr(
        "custom_components.imprint_refinery.sensor.find_zha_device",
        lambda candidate_hass, ieee: zha_device,
    )

    def add_entities(entities, update_before_add=False, *, config_subentry_id=None):
        added.append((config_subentry_id, entities))

    asyncio.run(async_setup_entry(hass, entry, add_entities))

    assert len(added) == 1
    assert added[0][0] == "sub-1"
    capability_sensor = added[0][1][0]
    assert capability_sensor.device_entry is zha_device
    assert capability_sensor.device_info is None
    assert capability_sensor.native_value == "Supported"
    assert capability_sensor.extra_state_attributes["capturing"] is True
    assert "commands" not in capability_sensor.extra_state_attributes
