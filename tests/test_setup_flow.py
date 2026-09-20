"""Configuration-flow contract for one workspace and many emitters."""

import asyncio
from types import MappingProxyType, SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.config_entries import ConfigSubentry

from custom_components.imprint_refinery.config_flow import (
    MANUAL_DEVICE,
    ImprintRefineryConfigFlow,
    ImprintRefineryEmitterSubentryFlow,
    _device_entries,
    _manual_setup_label,
    _zha_ieee,
)
from custom_components.imprint_refinery.const import (
    CONF_CAPTURE_REASSERT_INTERVAL,
    CONF_CAPTURE_TIMEOUT,
    CONF_CLUSTER_ID,
    CONF_DEVICE,
    CONF_DRIVER,
    CONF_ENDPOINT_ID,
    CONF_IEEE,
    CONF_TRANSPORT,
    DEFAULT_CAPTURE_REASSERT_INTERVAL,
    DEFAULT_CAPTURE_TIMEOUT,
    DEFAULT_CLUSTER_ID,
    DEFAULT_ENDPOINT_ID,
    EMITTER_SUBENTRY_TYPE,
    HUB_ENTRY_DATA,
    ZHA_BRIDGE,
)


def execute(awaitable):
    return asyncio.run(awaitable)


def emitter_data(ieee: str, *, timeout: int = 60, interval: int = 8) -> dict:
    return {
        CONF_IEEE: ieee,
        CONF_DRIVER: "zosung_ts1201",
        CONF_TRANSPORT: ZHA_BRIDGE,
        CONF_ENDPOINT_ID: DEFAULT_ENDPOINT_ID,
        CONF_CLUSTER_ID: DEFAULT_CLUSTER_ID,
        CONF_CAPTURE_TIMEOUT: timeout,
        CONF_CAPTURE_REASSERT_INTERVAL: interval,
    }


def subentry(ieee: str, key: str = "emitter-a") -> ConfigSubentry:
    return ConfigSubentry(
        data=MappingProxyType(emitter_data(ieee)),
        subentry_id=key,
        subentry_type=EMITTER_SUBENTRY_TYPE,
        title=f"Emitter {ieee}",
        unique_id=ieee.replace(":", "").lower(),
    )


class Entry:
    def __init__(self, *emitters: ConfigSubentry) -> None:
        self.entry_id = "workspace"
        self.subentries = MappingProxyType(
            {item.subentry_id: item for item in emitters}
        )

    def get_subentries_of_type(self, kind):
        return [item for item in self.subentries.values() if item.subentry_type == kind]


class EntryManager:
    def __init__(self, entry: Entry) -> None:
        self.entry = entry
        self.reloads: list[str] = []

    def async_get_known_entry(self, entry_id):
        assert entry_id == self.entry.entry_id
        return self.entry

    def async_update_subentry(self, *, entry, subentry, **changes):
        assert entry is self.entry
        object.__setattr__(subentry, "data", MappingProxyType(changes["data"]))
        return True

    def async_schedule_reload(self, entry_id):
        self.reloads.append(entry_id)


def hass(entry: Entry | None = None):
    return SimpleNamespace(
        config=SimpleNamespace(language="en"),
        config_entries=EntryManager(entry) if entry else None,
    )


def bind_subentry_flow(flow, entry: Entry, *, source: str = "user", item=None) -> None:
    flow.hass = hass(entry)
    flow.handler = (entry.entry_id, EMITTER_SUBENTRY_TYPE)
    flow.context = {"source": source}
    if item is not None:
        flow.context["subentry_id"] = item.subentry_id


def test_registry_shapes_and_extended_identifiers_are_read_defensively() -> None:
    zha_device = SimpleNamespace(
        identifiers={
            ("unrelated", "value", "extension"),
            ("zha", "AA:BB:CC:DD"),
        }
    )
    mapping_registry = SimpleNamespace(devices={"x": zha_device})
    sequence_registry = SimpleNamespace(devices=(zha_device,))

    assert list(_device_entries(mapping_registry)) == [zha_device]
    assert list(_device_entries(sequence_registry)) == [zha_device]
    assert _zha_ieee(zha_device) == "aa:bb:cc:dd"


def test_manual_choice_is_always_english_until_a_human_translation_exists() -> None:
    assert _manual_setup_label("en") == "Manual setup"
    assert _manual_setup_label("uk") == "Manual setup"


def test_first_setup_creates_workspace_and_normalized_emitter_subentry(
    monkeypatch,
) -> None:
    flow = ImprintRefineryConfigFlow()
    flow.hass = hass()
    monkeypatch.setattr(flow, "_async_current_entries", list)
    monkeypatch.setattr(
        flow,
        "_async_discover_zha_emitters",
        AsyncMock(
            return_value={
                "zha-device": emitter_data("AA:BB") | {"label": "Desk transmitter"}
            }
        ),
    )

    result = execute(
        flow.async_step_user(
            {
                CONF_DEVICE: "zha-device",
            }
        )
    )

    assert result["type"] == "create_entry"
    assert result["title"] == "Imprint Refinery"
    assert result["data"] == HUB_ENTRY_DATA
    [created] = result["subentries"]
    assert created["unique_id"] == "aabb"
    assert created["title"] == "Desk transmitter"
    assert created["data"][CONF_CAPTURE_TIMEOUT] == DEFAULT_CAPTURE_TIMEOUT
    assert (
        created["data"][CONF_CAPTURE_REASSERT_INTERVAL]
        == DEFAULT_CAPTURE_REASSERT_INTERVAL
    )


def test_second_workspace_is_not_allowed(monkeypatch) -> None:
    flow = ImprintRefineryConfigFlow()
    flow.hass = hass()
    monkeypatch.setattr(flow, "_async_current_entries", lambda: [object()])
    result = execute(flow.async_step_user())
    assert result["type"] == "abort"
    assert result["reason"] == "single_instance_allowed"


def test_selecting_manual_opens_the_manual_form(monkeypatch) -> None:
    flow = ImprintRefineryConfigFlow()
    flow.hass = hass()
    monkeypatch.setattr(flow, "_async_current_entries", list)
    monkeypatch.setattr(
        flow, "_async_discover_zha_emitters", AsyncMock(return_value={})
    )
    result = execute(
        flow.async_step_user(
            {
                CONF_DEVICE: MANUAL_DEVICE,
                CONF_CAPTURE_TIMEOUT: 60,
                CONF_CAPTURE_REASSERT_INTERVAL: 8,
            }
        )
    )
    assert result["type"] == "form"
    assert result["step_id"] == "manual"


def test_discovery_skips_unusable_zha_devices(monkeypatch) -> None:
    devices = [
        SimpleNamespace(
            id="good",
            identifiers={("zha", "00:11")},
            name_by_user="Hall",
            name="Fallback",
            manufacturer="Maker",
            model="Model",
        ),
        SimpleNamespace(
            id="not-zha",
            identifiers={("other", "00:22")},
            name_by_user=None,
            name="Other",
            manufacturer=None,
            model=None,
        ),
        SimpleNamespace(
            id="broken",
            identifiers={("zha", "00:33")},
            name_by_user=None,
            name="Broken",
            manufacturer=None,
            model=None,
        ),
    ]
    flow = ImprintRefineryConfigFlow()
    flow.hass = hass()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.config_flow.dr.async_get",
        lambda _hass: SimpleNamespace(devices=devices),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.config_flow.zha_proxy",
        lambda _hass, device_id: (
            (_ for _ in ()).throw(RuntimeError("offline"))
            if device_id == "broken"
            else object()
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.config_flow.discover_zha_driver",
        lambda proxy: ("zosung_ts1201", 1, 0xE004),
    )

    found = execute(flow._async_discover_zha_emitters())
    assert set(found) == {"good"}
    assert found["good"]["label"] == "Hall · Maker · Model · 00:11"


def test_subentry_creation_rejects_existing_hardware_and_accepts_new_hardware() -> None:
    existing = subentry("00:11")
    entry = Entry(existing)
    flow = ImprintRefineryEmitterSubentryFlow()
    bind_subentry_flow(flow, entry)

    duplicate = flow._async_create_subentry(emitter_data("0011"))
    created = flow._async_create_subentry(emitter_data("00:22") | {"label": "Shelf"})

    assert duplicate["type"] == "abort"
    assert duplicate["reason"] == "already_configured"
    assert created["type"] == "create_entry"
    assert created["unique_id"] == "0022"
    assert created["title"] == "Shelf"


def test_subentry_picker_filters_emitters_already_in_the_workspace(monkeypatch) -> None:
    entry = Entry(subentry("00:11"))
    flow = ImprintRefineryEmitterSubentryFlow()
    bind_subentry_flow(flow, entry)
    monkeypatch.setattr(
        flow,
        "_async_discover_zha_emitters",
        AsyncMock(
            return_value={
                "old": {CONF_IEEE: "00:11", "label": "Existing"},
                "new": {CONF_IEEE: "00:22", "label": "Available"},
            }
        ),
    )

    form = execute(flow.async_step_user())
    assert form["type"] == "form"
    assert set(flow._discovered) == {"new"}


def test_reconfigure_updates_capture_timing_and_reloads_workspace() -> None:
    item = subentry("00:11")
    entry = Entry(item)
    flow = ImprintRefineryEmitterSubentryFlow()
    bind_subentry_flow(flow, entry, source="reconfigure", item=item)

    result = execute(
        flow.async_step_reconfigure(
            {
                CONF_CAPTURE_TIMEOUT: 25,
                CONF_CAPTURE_REASSERT_INTERVAL: 4,
            }
        )
    )

    assert result["type"] == "abort"
    assert item.data[CONF_CAPTURE_TIMEOUT] == 25
    assert flow.hass.config_entries.reloads == ["workspace"]
