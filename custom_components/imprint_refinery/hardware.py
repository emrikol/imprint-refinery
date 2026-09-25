"""Read-only discovery of Home Assistant Core infrared hardware."""

from collections.abc import Iterable, Mapping
import logging
from typing import Any

from homeassistant.components import infrared
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)

from .const import DOMAIN, ZHA_BRIDGE
from .emitter_identity import normalize_emitter_ref
from .errors import ImprintRefineryError
from .zha_bridge import discover_zha_driver, zha_proxy

_LOGGER = logging.getLogger(__name__)


def _device_entries(registry: dr.DeviceRegistry) -> Iterable[dr.DeviceEntry]:
    devices = registry.devices
    return devices.values() if isinstance(devices, Mapping) else devices


def _zha_ieee(device: dr.DeviceEntry) -> str | None:
    for identifier in device.identifiers:
        if len(identifier) >= 2 and identifier[0] == "zha":
            return str(identifier[1]).lower()
    return None


def _device_label(device: dr.DeviceEntry, ieee: str) -> str:
    values = [device.name_by_user or device.name or ieee]
    values.extend(str(value) for value in (device.manufacturer, device.model) if value)
    values.append(ieee)
    return " · ".join(values)


async def async_discover_zha_adapter_candidates(
    hass: HomeAssistant,
) -> dict[str, dict[str, Any]]:
    """Return supported ZHA devices that could use the compatibility provider."""
    result: dict[str, dict[str, Any]] = {}
    for device in _device_entries(dr.async_get(hass)):
        ieee = _zha_ieee(device)
        if ieee is None:
            continue
        try:
            detected = discover_zha_driver(
                zha_proxy(hass, device.id),
                manufacturer=device.manufacturer,
                model=device.model,
            )
        except Exception as error:  # noqa: BLE001 - discovery must fail soft.
            level = (
                logging.DEBUG
                if isinstance(error, ImprintRefineryError)
                else logging.WARNING
            )
            _LOGGER.log(level, "Skipping ZHA IR discovery for %s: %s", device.id, error)
            continue
        if detected is None:
            continue
        driver_id, endpoint_id, cluster_id = detected
        result[device.id] = {
            "ieee": ieee,
            "driver": driver_id,
            "transport": ZHA_BRIDGE,
            "endpoint_id": endpoint_id,
            "cluster_id": cluster_id,
            "label": _device_label(device, ieee),
        }
    return result


async def async_compatibility_adapter_available(
    hass: HomeAssistant,
    *,
    configured_emitter_ids: set[str],
    core_infrared_device_ids: set[str],
) -> bool:
    """Report whether supported ZHA hardware still needs a Core provider."""
    candidates = await async_discover_zha_adapter_candidates(hass)
    return any(
        normalize_emitter_ref(str(candidate["ieee"])) not in configured_emitter_ids
        and device_id not in core_infrared_device_ids
        for device_id, candidate in candidates.items()
    )


def discover_infrared_hardware(hass: HomeAssistant) -> dict[str, list[dict[str, Any]]]:
    """Return a fresh, read-only inventory of Core infrared entities."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    areas = ar.async_get(hass)

    def describe(entity_id: str) -> dict[str, Any] | None:
        entry = registry.async_get(entity_id)
        if entry is None:
            return None
        device = devices.async_get(entry.device_id) if entry.device_id else None
        area = (
            areas.async_get_area(device.area_id)
            if device is not None and device.area_id
            else None
        )
        state = hass.states.get(entity_id)
        last_updated = getattr(state, "last_updated", None)
        name = (
            getattr(entry, "name", None)
            or getattr(entry, "original_name", None)
            or getattr(device, "name_by_user", None)
            or getattr(device, "name", None)
            or (state.name if state is not None else None)
            or entity_id
        )
        return {
            "ref": entry.id,
            "entity_id": entity_id,
            "name": name,
            "available": bool(state is not None and state.state != STATE_UNAVAILABLE),
            "last_activity": (
                last_updated.isoformat() if last_updated is not None else None
            ),
            "platform": entry.platform,
            "compatibility_adapter": entry.platform == DOMAIN,
            "device_id": getattr(device, "id", None),
            "device_name": (
                getattr(device, "name_by_user", None) or getattr(device, "name", None)
            ),
            "device_url": (
                f"/config/devices/device/{device.id}" if device is not None else None
            ),
            "entity_url": f"/config/entities/entity/{entry.id}",
            "area_name": getattr(area, "name", None),
        }

    return {
        "emitters": [
            summary
            for entity_id in infrared.async_get_emitters(hass)
            if (summary := describe(entity_id)) is not None
        ],
        "receivers": [
            summary
            for entity_id in infrared.async_get_receivers(hass)
            if (summary := describe(entity_id)) is not None
        ],
    }
