"""Synchronize appliance devices with Home Assistant registries."""

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .const import DOMAIN, EMITTER_SUBENTRY_TYPE
from .storage import SignalLibraryStore


def emitter_subentries(entry: ConfigEntry) -> list[ConfigSubentry]:
    return entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE)


def emitter_subentry_ids(entry: ConfigEntry) -> set[str]:
    return {
        subentry.unique_id
        for subentry in emitter_subentries(entry)
        if subentry.unique_id is not None
    }


def remove_legacy_sensor_entities(hass: HomeAssistant) -> None:
    """Remove registry rows for the retired status and capability sensors."""
    registry = er.async_get(hass)
    for entity in tuple(registry.entities.values()):
        if entity.platform == DOMAIN and entity.entity_id.startswith("sensor."):
            registry.async_remove(entity.entity_id)


def remove_orphan_consumer_devices(
    hass: HomeAssistant, entry: ConfigEntry, store: SignalLibraryStore
) -> None:
    """Remove HA device rows whose backing appliance no longer exists."""
    try:
        registry = dr.async_get(hass)
    except RuntimeError:
        return
    appliances = store.data.get("appliances", {})
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        owned_ids = [
            identifier for domain, identifier in device.identifiers if domain == DOMAIN
        ]
        if not owned_ids:
            continue
        if owned_ids[0] not in appliances:
            _remove_registry_device(hass, registry, device)


def remove_consumer_device_entries(hass: HomeAssistant, appliance_id: str) -> None:
    """Remove every entity and device row owned by one appliance."""
    devices = dr.async_get(hass)
    device = next(
        iter(devices.async_get_devices(identifiers={(DOMAIN, appliance_id)})),
        None,
    )
    if device is not None:
        _remove_registry_device(hass, devices, device)


def _remove_registry_device(
    hass: HomeAssistant,
    devices: dr.DeviceRegistry,
    device: dr.DeviceEntry,
) -> None:
    """Remove a consumer's entity rows before removing its device row."""
    entities = er.async_get(hass)
    for entity in er.async_entries_for_device(
        entities,
        device.id,
        include_disabled_entities=True,
    ):
        entities.async_remove(entity.entity_id)
    devices.async_remove_device(device.id)


async def async_remove_consumer_device(
    hass: HomeAssistant, device_entry: dr.DeviceEntry
) -> bool:
    """Delete the library appliance represented by a removed HA device."""
    owned = next(
        (
            identifier
            for domain, identifier in device_entry.identifiers
            if domain == DOMAIN
        ),
        None,
    )
    if owned is None:
        return True
    store: SignalLibraryStore | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        return True
    from .const import ERROR_COMMAND_NOT_FOUND
    from .errors import ImprintRefineryError

    try:
        await store.remove_appliance(owned, confirm=True)
    except ImprintRefineryError as error:
        if error.code != ERROR_COMMAND_NOT_FOUND:
            raise
    return True
