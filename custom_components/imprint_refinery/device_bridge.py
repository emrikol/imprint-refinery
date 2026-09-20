"""Synchronize signal-library devices with Home Assistant registries."""

from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr

from .const import CONF_IEEE, DOMAIN, EMITTER_SUBENTRY_TYPE
from .emitter_identity import normalize_emitter_ref
from .storage import SignalLibraryStore
from .zha_bridge import find_zha_device


def emitter_subentries(entry: ConfigEntry) -> list[ConfigSubentry]:
    return entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE)


def emitter_subentry_ids(entry: ConfigEntry) -> set[str]:
    return {
        subentry.unique_id
        for subentry in emitter_subentries(entry)
        if subentry.unique_id is not None
    }


def emitter_metadata(
    hass: HomeAssistant, entry: ConfigEntry, subentry: ConfigSubentry
) -> dict[str, Any]:
    """Combine immutable subentry settings with live registry display metadata."""
    metadata = dict(subentry.data)
    ieee = str(metadata[CONF_IEEE]).strip().lower()
    metadata[CONF_IEEE] = ieee
    source = find_zha_device(hass, ieee)
    if source is not None:
        metadata.update(
            name=getattr(source, "name_by_user", None) or getattr(source, "name", None),
            manufacturer=getattr(source, "manufacturer", None),
            model=getattr(source, "model", None),
        )
    try:
        registry = dr.async_get(hass)
        owned = registry.async_get_device_by_identifier(
            (DOMAIN, normalize_emitter_ref(ieee)), entry.entry_id
        )
    except AttributeError, RuntimeError:
        registry = None
        owned = None
    chosen_name = getattr(owned, "name_by_user", None)
    if chosen_name:
        metadata["name"] = chosen_name
        metadata["name_authoritative"] = True
        if (
            registry is not None
            and source is not None
            and getattr(source, "name_by_user", None) != chosen_name
        ):
            registry.async_update_device(source.id, name_by_user=chosen_name)
    return metadata


def register_emitter_device(
    hass: HomeAssistant,
    entry: ConfigEntry,
    subentry: ConfigSubentry,
    emitter_id: str,
) -> None:
    """Own a Home Assistant device record for one configured emitter."""
    ieee = str(subentry.data[CONF_IEEE]).strip().lower()
    registry = dr.async_get(hass)
    source = find_zha_device(hass, ieee)
    display_name = (
        getattr(source, "name_by_user", None) or getattr(source, "name", None)
        if source is not None
        else None
    )
    owned = registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        config_subentry_id=subentry.subentry_id,
        identifiers={(DOMAIN, emitter_id)},
        via_device_id=getattr(source, "id", None),
        name=display_name or f"IR emitter {ieee}",
        manufacturer=getattr(source, "manufacturer", None) or "Zigbee",
        model=getattr(source, "model", None) or "IR bridge",
    )
    links = getattr(owned, "config_entries_subentries", {}).get(entry.entry_id, set())
    if None in links:
        registry.async_update_device(
            owned.id,
            add_config_entry_id=entry.entry_id,
            add_config_subentry_id=subentry.subentry_id,
            remove_config_entry_id=entry.entry_id,
            remove_config_subentry_id=None,
        )


def start_emitter_name_sync(
    hass: HomeAssistant,
    store: SignalLibraryStore,
    runtime: dict[str, Any],
) -> None:
    """Mirror a user rename between the ZHA and Imprint Refinery devices."""
    if runtime.get("emitter_name_sync_unsub") or not hasattr(hass, "bus"):
        return
    registry = dr.async_get(hass)

    @callback
    def handle_update(event: Event) -> None:
        if event.data.get("action") != "update":
            return
        if "name_by_user" not in event.data.get("changes", {}):
            return
        changed = registry.async_get(event.data.get("device_id"))
        if changed is None:
            return
        identifiers = dict(changed.identifiers)
        if DOMAIN in identifiers:
            emitter_id = str(identifiers[DOMAIN])
            ieee = store.data["emitters"].get(emitter_id, {}).get("ieee", "")
            counterpart = find_zha_device(hass, ieee)
        elif "zha" in identifiers:
            emitter_id = normalize_emitter_ref(str(identifiers["zha"]))
            counterpart = next(
                iter(registry.async_get_devices(identifiers={(DOMAIN, emitter_id)})),
                None,
            )
        else:
            return
        record = store.data["emitters"].get(emitter_id)
        name = getattr(changed, "name_by_user", None) or getattr(changed, "name", None)
        if record is None or not name:
            return
        if (
            counterpart is not None
            and getattr(counterpart, "name_by_user", None) != name
        ):
            registry.async_update_device(counterpart.id, name_by_user=name)
        if record.get("name") != name:
            record["name"] = name
            hass.async_create_task(store.async_save())

    runtime["emitter_name_sync_unsub"] = hass.bus.async_listen(
        dr.EVENT_DEVICE_REGISTRY_UPDATED, handle_update
    )


def remove_orphan_consumer_devices(
    hass: HomeAssistant, entry: ConfigEntry, store: SignalLibraryStore
) -> None:
    """Remove HA device rows whose backing appliance no longer exists."""
    try:
        registry = dr.async_get(hass)
    except RuntimeError:
        return
    locations = store.data.get("locations", {})
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        owned_ids = [
            identifier
            for domain, identifier in device.identifiers
            if domain == DOMAIN and "__" in identifier
        ]
        if not owned_ids:
            continue
        location_id, device_id = owned_ids[0].split("__", 1)
        if device_id not in locations.get(location_id, {}).get("appliances", {}):
            registry.async_remove_device(device.id)


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
    if "__" not in owned:
        return False
    location_id, device_id = owned.split("__", 1)
    store: SignalLibraryStore | None = hass.data.get(DOMAIN, {}).get("store")
    if store is None:
        return True
    from .const import ERROR_COMMAND_NOT_FOUND
    from .errors import ImprintRefineryError

    try:
        await store.remove_appliance(location_id, device_id, confirm=True)
    except ImprintRefineryError as error:
        if error.code != ERROR_COMMAND_NOT_FOUND:
            raise
    return True
