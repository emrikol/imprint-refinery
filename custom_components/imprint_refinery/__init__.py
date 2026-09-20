"""Home Assistant lifecycle for Imprint Refinery."""

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.typing import ConfigType

from .catalog_sessions import GuidedCatalogSessionManager
from .const import CONF_IEEE, DOMAIN, HUB_TITLE
from .device_bridge import (
    async_remove_consumer_device,
    emitter_metadata,
    emitter_subentries,
    emitter_subentry_ids,
    register_emitter_device,
    remove_orphan_consumer_devices,
    start_emitter_name_sync,
)
from .emitter_identity import normalize_emitter_ref
from .frontend_bridge import async_mount_frontend, unmount_frontend
from .hardware import InfraredHardware, discover_home_assistant_emitters
from .services import (
    REGISTERED_SERVICES,
    icon_schema,
    register_panel_api,
    register_services,
)
from .status import ActivityStatus
from .storage import SignalLibraryStore
from .transmission import SignalQueue

PLATFORMS = [
    Platform.SENSOR,
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
    status = ActivityStatus()
    transport = InfraredHardware(hass)
    runtime.update(
        {
            "store": store,
            "status": status,
            "transport": transport,
            "capture_tasks": {},
            "signal_queue": SignalQueue(transport, status),
            "catalog_sessions": GuidedCatalogSessionManager(),
        }
    )
    return runtime


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the library and reconcile one Home Assistant config entry."""
    if entry.data.get("hub") and entry.title != HUB_TITLE:
        hass.config_entries.async_update_entry(entry, title=HUB_TITLE)

    runtime = await _async_create_runtime(hass)
    if not runtime.get("frontend_registered"):
        runtime["panel_registered"] = await async_mount_frontend(hass)
        runtime["frontend_registered"] = True

    store: SignalLibraryStore = runtime["store"]
    remove_orphan_consumer_devices(hass, entry, store)
    subentries = emitter_subentries(entry)
    for subentry in subentries:
        emitter_id = await store.async_upsert_emitter_from_entry(
            emitter_metadata(hass, entry, subentry)
        )
        register_emitter_device(hass, entry, subentry, emitter_id)

    valid_ids = {
        normalize_emitter_ref(str(item.data[CONF_IEEE])) for item in subentries
    }
    await store.async_reconcile_emitters(valid_ids)
    start_emitter_name_sync(hass, store, runtime)

    if not runtime.get("services_registered"):
        _register_services(hass)
        runtime["services_registered"] = True
    runtime.setdefault("entry_subentry_ids", {})[entry.entry_id] = emitter_subentry_ids(
        entry
    )

    entry.async_on_unload(entry.add_update_listener(_async_handle_entry_update))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    await store.async_sync_home_assistant_emitters(
        discover_home_assistant_emitters(hass)
    )
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
    if signal_queue := runtime.get("signal_queue"):
        signal_queue.close()
    for service in REGISTERED_SERVICES:
        hass.services.async_remove(DOMAIN, service)
    if runtime.get("panel_registered"):
        unmount_frontend(hass)
    if unsubscribe := runtime.get("emitter_name_sync_unsub"):
        unsubscribe()
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
    store: SignalLibraryStore = hass.data[DOMAIN]["store"]
    register_services(
        hass, lambda reference: resolve_emitter_ref(hass, store, reference)
    )


def resolve_emitter_ref(
    hass: HomeAssistant, store: SignalLibraryStore, ref: str
) -> str:
    """Resolve a stored key, IEEE address, or registered entity ID."""
    emitters = store.data.get("emitters", {})
    if ref in emitters:
        return ref
    normalized = normalize_emitter_ref(ref)
    if normalized in emitters:
        return normalized
    registry = er.async_get(hass)
    entity = registry.async_get(ref)
    if entity is not None and entity.domain == Platform.INFRARED:
        if entity.platform == DOMAIN and str(entity.unique_id) in emitters:
            return str(entity.unique_id)
        match = next(
            (
                key
                for key, record in emitters.items()
                if record.get("entity_id") in (entity.id, entity.entity_id)
            ),
            None,
        )
        if match is not None:
            return match
    raise ServiceValidationError(f"Unknown IR emitter: {ref}")
