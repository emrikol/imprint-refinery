"""Home Assistant lifecycle for Imprint Refinery."""

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.typing import ConfigType

from .catalog_sessions import GuidedCatalogSessionManager
from .const import DOMAIN, HUB_TITLE
from .device_bridge import (
    async_remove_consumer_device,
    emitter_subentry_ids,
    remove_legacy_sensor_entities,
    remove_orphan_consumer_devices,
)
from .frontend_bridge import async_mount_frontend, unmount_frontend
from .services import (
    REGISTERED_SERVICES,
    icon_schema,
    register_panel_api,
    register_services,
)
from .storage import SignalLibraryStore

PLATFORMS = [
    Platform.INFRARED,
    Platform.BUTTON,
    Platform.REMOTE,
    Platform.MEDIA_PLAYER,
    Platform.SWITCH,
]

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

# Exposed for focused validation of the shared icon schema.
_icon_schema = icon_schema


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Initialize the integration domain without mutating configuration."""
    del config
    register_panel_api(hass)
    return True


async def _async_create_runtime(hass: HomeAssistant) -> dict[str, Any]:
    runtime = hass.data.setdefault(DOMAIN, {})
    if "store" in runtime:
        return runtime

    store = SignalLibraryStore(hass)
    await store.async_load()
    await store.async_refresh_analysis()
    runtime.update(
        {
            "store": store,
            "capture_tasks": {},
            "catalog_sessions": GuidedCatalogSessionManager(),
        }
    )
    return runtime


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the library and reconcile one Home Assistant config entry."""
    if entry.data.get("hub") and entry.title != HUB_TITLE:
        hass.config_entries.async_update_entry(entry, title=HUB_TITLE)

    runtime = await _async_create_runtime(hass)
    runtime["config_entry_id"] = entry.entry_id
    if not runtime.get("frontend_registered"):
        runtime["panel_registered"] = await async_mount_frontend(hass)
        runtime["frontend_registered"] = True

    store: SignalLibraryStore = runtime["store"]
    await store.async_complete_migration(entry.entry_id)
    remove_legacy_sensor_entities(hass)
    remove_orphan_consumer_devices(hass, entry, store)
    if not runtime.get("services_registered"):
        _register_services(hass)
        runtime["services_registered"] = True
    runtime.setdefault("entry_subentry_ids", {})[entry.entry_id] = emitter_subentry_ids(
        entry
    )

    entry.async_on_unload(entry.add_update_listener(_async_handle_entry_update))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload every platform and release domain-scoped resources."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded and (runtime := hass.data.get(DOMAIN)) is not None:
        runtime.get("entry_subentry_ids", {}).pop(entry.entry_id, None)
        _teardown_domain(hass, runtime)
    return unloaded


def _teardown_domain(hass: HomeAssistant, runtime: dict[str, Any]) -> None:
    for task in runtime.get("capture_tasks", {}).values():
        task.cancel()
    for service in REGISTERED_SERVICES:
        hass.services.async_remove(DOMAIN, service)
    if runtime.get("panel_registered"):
        unmount_frontend(hass)
    hass.data.pop(DOMAIN, None)


async def _async_handle_entry_update(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload only when emitter subentries actually changed."""
    runtime = hass.data.get(DOMAIN, {})
    current = emitter_subentry_ids(entry)
    known_by_entry = runtime.setdefault("entry_subentry_ids", {})
    previous = known_by_entry.get(entry.entry_id)
    known_by_entry[entry.entry_id] = current
    if previous is not None and previous != current:
        hass.config_entries.async_schedule_reload(entry.entry_id)


async def async_remove_config_entry_device(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    device_entry: dr.DeviceEntry,
) -> bool:
    """Delete the backing appliance when a virtual device is removed."""
    del config_entry
    return await async_remove_consumer_device(hass, device_entry)


def _register_services(hass: HomeAssistant) -> None:
    register_services(hass)
