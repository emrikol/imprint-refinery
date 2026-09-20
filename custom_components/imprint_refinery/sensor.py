"""Read-only Home Assistant views of activity and emitter configuration."""

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity import DeviceInfo, EntityCategory
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .capabilities import emitter_capability_attributes
from .const import CONF_IEEE, DOMAIN, EMITTER_SUBENTRY_TYPE
from .emitter_identity import normalize_emitter_ref
from .product_spec import States
from .status import ActivityStatus
from .zha_bridge import find_zha_device
from .zha_drivers import get_zha_driver

_STATUS_OPTIONS = (
    States.IDLE,
    States.CAPTURING,
    States.SENDING,
    States.CAPTURE_READY,
    States.QUEUED,
    States.DISPATCHING,
    States.SENT_UNCONFIRMED,
    States.DELIVERY_FAILED,
    States.EXPIRED,
    States.QUEUE_FULL,
    States.STOPPED,
    States.ERROR,
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Expose one activity feed plus a diagnostic view for each emitter."""
    status = hass.data.get(DOMAIN, {}).get("status")
    if status is not None:
        async_add_entities([ActivitySensor(status, entry.entry_id)])
    for subentry in entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE):
        data = dict(subentry.data)
        ieee = str(data[CONF_IEEE]).strip().lower()
        emitter = EmitterCapabilities(normalize_emitter_ref(ieee), data)
        emitter.device_entry = find_zha_device(hass, ieee)
        async_add_entities([emitter], config_subentry_id=subentry.subentry_id)


class ActivitySensor(SensorEntity):
    """Latest operation reported by the integration runtime."""

    _attr_has_entity_name = True
    _attr_translation_key = "status"
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = _STATUS_OPTIONS
    _attr_icon = "mdi:remote"

    def __init__(self, status: ActivityStatus, entry_id: str) -> None:
        self._status = status
        self._attr_unique_id = f"{entry_id}_imprint_refinery_status"

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._status.async_subscribe(self._refresh))

    @property
    def native_value(self) -> str:
        return self._status.state

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._status.attributes

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()


class EmitterCapabilities(SensorEntity):
    """Static diagnostic summary for a configured signal emitter."""

    _attr_has_entity_name = True
    _attr_name = "Imprint Refinery capabilities"
    _attr_icon = "mdi:remote"
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_should_poll = False

    def __init__(self, emitter_id: str, entry_data: dict[str, Any]) -> None:
        self._attr_unique_id = f"{emitter_id}_imprint_refinery_capabilities"
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, emitter_id)})
        self._attributes = emitter_capability_attributes(
            entry_data, get_zha_driver(entry_data["driver"])
        )

    @property
    def native_value(self) -> str:
        return "Supported"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return self._attributes

    @property
    def device_info(self) -> DeviceInfo | None:
        return None if self.device_entry is not None else self._attr_device_info
