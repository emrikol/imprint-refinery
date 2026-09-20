"""Single-workspace configuration flow with repeatable emitter subentries."""

from collections.abc import Iterable, Mapping
import logging
from typing import Any

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import device_registry as dr
import voluptuous as vol

from .const import (
    CONF_CAPTURE_REASSERT_INTERVAL,
    CONF_CAPTURE_TIMEOUT,
    CONF_CLUSTER_ID,
    CONF_DEVICE,
    CONF_DRIVER,
    CONF_ENDPOINT_ID,
    CONF_IEEE,
    DEFAULT_CAPTURE_REASSERT_INTERVAL,
    DEFAULT_CAPTURE_TIMEOUT,
    DEFAULT_CLUSTER_ID,
    DEFAULT_ENDPOINT_ID,
    DOMAIN,
    EMITTER_SUBENTRY_TYPE,
    HUB_ENTRY_DATA,
    HUB_TITLE,
    ZHA_BRIDGE,
)
from .emitter_identity import normalize_emitter_ref
from .errors import ImprintRefineryError
from .zha_bridge import discover_zha_driver, zha_proxy
from .zha_drivers import DEFAULT_ZHA_DRIVER, DRIVERS

MANUAL_DEVICE = "__manual__"
HOME_ASSISTANT_DEVICE = "__home_assistant_infrared__"
MANUAL_SETUP_LABEL = "Manual setup"
HOME_ASSISTANT_SETUP_LABEL = "Use Home Assistant infrared entities"
_POSITIVE_INT = vol.All(vol.Coerce(int), vol.Range(min=1))
_ENDPOINT_ID = vol.All(vol.Coerce(int), vol.Range(min=1, max=240))
_CLUSTER_ID = vol.All(vol.Coerce(int), vol.Range(min=0, max=0xFFFF))
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


def _manual_setup_label(language: str | None) -> str:
    """Return the sole built-in setup label.

    Imprint Refinery ships English copy only. Home Assistant may request any
    locale, but untranslated integration copy intentionally falls back to the
    maintained English source.
    """
    del language
    return MANUAL_SETUP_LABEL


def _subentry_emitter_id(subentry: Any) -> str:
    value = subentry.unique_id or subentry.data.get(CONF_IEEE, "")
    return normalize_emitter_ref(str(value))


def _timing_fields(
    *,
    timeout: int = DEFAULT_CAPTURE_TIMEOUT,
    interval: int = DEFAULT_CAPTURE_REASSERT_INTERVAL,
) -> dict[Any, Any]:
    return {
        vol.Required(CONF_CAPTURE_TIMEOUT, default=timeout): _POSITIVE_INT,
        vol.Required(CONF_CAPTURE_REASSERT_INTERVAL, default=interval): _POSITIVE_INT,
    }


class _EmitterFlowMixin:
    """Discovery, forms, and normalization shared by both flow types."""

    _discovered: dict[str, dict[str, Any]]

    async def _async_discover_zha_emitters(self) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for device in _device_entries(dr.async_get(self.hass)):
            ieee = _zha_ieee(device)
            if ieee is None:
                continue
            try:
                proxy = zha_proxy(self.hass, device.id)
                detected = discover_zha_driver(proxy)
            except Exception as error:  # noqa: BLE001 - discovery must fail soft.
                level = (
                    logging.DEBUG
                    if isinstance(error, ImprintRefineryError)
                    else logging.WARNING
                )
                _LOGGER.log(
                    level, "Skipping ZHA IR discovery for %s: %s", device.id, error
                )
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

    def _async_emitter_choice_form(self, errors: dict[str, str]) -> FlowResult:
        choices = {
            device_id: data["label"]
            for device_id, data in sorted(
                self._discovered.items(), key=lambda item: item[1]["label"].casefold()
            )
        }
        choices[HOME_ASSISTANT_DEVICE] = HOME_ASSISTANT_SETUP_LABEL
        choices[MANUAL_DEVICE] = _manual_setup_label(self.hass.config.language)
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_DEVICE): vol.In(choices)}),
            errors=errors,
        )

    def _async_manual_form(self, errors: dict[str, str]) -> FlowResult:
        return self.async_show_form(
            step_id="manual",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_IEEE): str,
                    vol.Required(CONF_DRIVER, default=DEFAULT_ZHA_DRIVER): vol.In(
                        {driver.id: driver.name for driver in DRIVERS}
                    ),
                    vol.Required(
                        CONF_ENDPOINT_ID, default=DEFAULT_ENDPOINT_ID
                    ): _ENDPOINT_ID,
                    vol.Required(
                        CONF_CLUSTER_ID, default=DEFAULT_CLUSTER_ID
                    ): _CLUSTER_ID,
                    **_timing_fields(),
                }
            ),
            errors=errors,
        )

    def _selected_emitter(self, user_input: dict[str, Any]) -> dict[str, Any] | None:
        selected = user_input[CONF_DEVICE]
        discovered = self._discovered.get(selected)
        if discovered is None:
            return None
        result = dict(discovered)
        result.update(
            {
                CONF_CAPTURE_TIMEOUT: DEFAULT_CAPTURE_TIMEOUT,
                CONF_CAPTURE_REASSERT_INTERVAL: DEFAULT_CAPTURE_REASSERT_INTERVAL,
            }
        )
        return result

    @staticmethod
    def _normalize_emitter_input(data: dict[str, Any]) -> dict[str, Any]:
        return {
            CONF_IEEE: str(data[CONF_IEEE]).strip().lower(),
            CONF_DRIVER: data[CONF_DRIVER],
            "transport": ZHA_BRIDGE,
            CONF_ENDPOINT_ID: data[CONF_ENDPOINT_ID],
            CONF_CLUSTER_ID: data[CONF_CLUSTER_ID],
            CONF_CAPTURE_TIMEOUT: data[CONF_CAPTURE_TIMEOUT],
            CONF_CAPTURE_REASSERT_INTERVAL: data[CONF_CAPTURE_REASSERT_INTERVAL],
        }

    @staticmethod
    def _emitter_title(data: dict[str, Any]) -> str:
        return data.get("label") or f"IR emitter {data[CONF_IEEE]}"


class ImprintRefineryConfigFlow(
    _EmitterFlowMixin, config_entries.ConfigFlow, domain=DOMAIN
):
    VERSION = 1

    def __init__(self) -> None:
        self._discovered = {}

    @classmethod
    @callback
    def async_get_supported_subentry_types(
        cls, config_entry: ConfigEntry
    ) -> dict[str, type[config_entries.ConfigSubentryFlow]]:
        return {EMITTER_SUBENTRY_TYPE: ImprintRefineryEmitterSubentryFlow}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        self._discovered = await self._async_discover_zha_emitters()
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input[CONF_DEVICE] == HOME_ASSISTANT_DEVICE:
                return self.async_create_entry(title=HUB_TITLE, data=HUB_ENTRY_DATA)
            if user_input[CONF_DEVICE] == MANUAL_DEVICE:
                return await self.async_step_manual()
            if selected := self._selected_emitter(user_input):
                return self._async_create_hub_entry(selected)
            errors[CONF_DEVICE] = "device_not_found"
        return self._async_emitter_choice_form(errors)

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        return (
            self._async_create_hub_entry(user_input)
            if user_input is not None
            else self._async_manual_form({})
        )

    def _async_create_hub_entry(self, data: dict[str, Any]) -> FlowResult:
        normalized = self._normalize_emitter_input(data)
        return self.async_create_entry(
            title=HUB_TITLE,
            data=HUB_ENTRY_DATA,
            subentries=[
                {
                    "data": normalized,
                    "subentry_type": EMITTER_SUBENTRY_TYPE,
                    "title": self._emitter_title(data),
                    "unique_id": normalize_emitter_ref(normalized[CONF_IEEE]),
                }
            ],
        )


class ImprintRefineryEmitterSubentryFlow(
    _EmitterFlowMixin, config_entries.ConfigSubentryFlow
):
    def __init__(self) -> None:
        self._discovered = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        self._discovered = await self._async_discover_zha_emitters()
        errors: dict[str, str] = {}
        if user_input is not None:
            if user_input[CONF_DEVICE] == HOME_ASSISTANT_DEVICE:
                return self.async_abort(reason="infrared_entities_auto_discovered")
            if user_input[CONF_DEVICE] == MANUAL_DEVICE:
                return await self.async_step_manual()
            if selected := self._selected_emitter(user_input):
                return self._async_create_subentry(selected)
            errors[CONF_DEVICE] = "device_not_found"
        self._remove_configured_discoveries()
        return self._async_emitter_choice_form(errors)

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        return (
            self._async_create_subentry(user_input)
            if user_input is not None
            else self._async_manual_form({})
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        subentry = self._get_reconfigure_subentry()
        if user_input is None:
            return self.async_show_form(
                step_id="reconfigure",
                data_schema=vol.Schema(
                    _timing_fields(
                        timeout=subentry.data[CONF_CAPTURE_TIMEOUT],
                        interval=subentry.data[CONF_CAPTURE_REASSERT_INTERVAL],
                    )
                ),
            )
        entry = self.hass.config_entries.async_get_known_entry(self._entry_id)
        result = self.async_update_and_abort(
            entry,
            subentry,
            data_updates={
                CONF_CAPTURE_TIMEOUT: user_input[CONF_CAPTURE_TIMEOUT],
                CONF_CAPTURE_REASSERT_INTERVAL: user_input[
                    CONF_CAPTURE_REASSERT_INTERVAL
                ],
            },
        )
        self.hass.config_entries.async_schedule_reload(entry.entry_id)
        return result

    def _async_create_subentry(self, data: dict[str, Any]) -> FlowResult:
        normalized = self._normalize_emitter_input(data)
        unique_id = normalize_emitter_ref(normalized[CONF_IEEE])
        entry = self.hass.config_entries.async_get_known_entry(self._entry_id)
        configured = entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE)
        if any(_subentry_emitter_id(item) == unique_id for item in configured):
            return self.async_abort(reason="already_configured")
        return self.async_create_entry(
            title=self._emitter_title(data),
            data=normalized,
            unique_id=unique_id,
        )

    def _remove_configured_discoveries(self) -> None:
        entry = self.hass.config_entries.async_get_known_entry(self._entry_id)
        configured = {
            _subentry_emitter_id(item)
            for item in entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE)
        }
        self._discovered = {
            device_id: data
            for device_id, data in self._discovered.items()
            if normalize_emitter_ref(str(data[CONF_IEEE])) not in configured
        }
