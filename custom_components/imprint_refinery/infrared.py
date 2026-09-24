"""Home Assistant infrared entities for supported ZHA IR adapters."""

import asyncio
from collections.abc import Callable
import logging
from typing import Any

from homeassistant.components.infrared import (
    InfraredCommand,
    InfraredEmitterEntity,
    InfraredReceivedSignal,
    InfraredReceiverEntity,
)
from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import (
    CONF_CAPTURE_REASSERT_INTERVAL,
    CONF_CAPTURE_TIMEOUT,
    CONF_CLUSTER_ID,
    CONF_DRIVER,
    CONF_ENDPOINT_ID,
    CONF_IEEE,
    DEFAULT_CAPTURE_REASSERT_INTERVAL,
    DEFAULT_CAPTURE_TIMEOUT,
    DEFAULT_CLUSTER_ID,
    DEFAULT_ENDPOINT_ID,
    EMITTER_SUBENTRY_TYPE,
)
from .emitter_identity import normalize_emitter_ref
from .signal_command import signal_from_infrared_command
from .zha_bridge import ZhaBridge, find_zha_device
from .zha_drivers import driver_for_device

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    add_entities: AddEntitiesCallback,
) -> None:
    """Expose native infrared entities for every configured ZHA adapter."""
    bridge = ZhaBridge(hass)
    for subentry in entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE):
        source_device = find_zha_device(hass, str(subentry.data[CONF_IEEE]))
        adapter = _adapter_record(subentry, source_device)
        add_entities(
            [
                SignalEmitter(bridge, adapter, source_device),
                SignalReceiver(bridge, adapter, source_device),
            ],
            config_subentry_id=subentry.subentry_id,
        )


def _adapter_record(
    subentry: ConfigSubentry,
    source_device: dr.DeviceEntry | None = None,
) -> dict[str, Any]:
    """Convert config-entry data into the private ZHA driver record."""
    data = dict(subentry.data)
    driver = driver_for_device(
        str(data[CONF_DRIVER]),
        manufacturer=getattr(source_device, "manufacturer", None),
        model=getattr(source_device, "model", None),
    )
    return {
        "ieee": str(data[CONF_IEEE]).strip().lower(),
        "driver": driver.id,
        "config": {
            "endpoint_id": int(data.get(CONF_ENDPOINT_ID, DEFAULT_ENDPOINT_ID)),
            "control_cluster": int(data.get(CONF_CLUSTER_ID, DEFAULT_CLUSTER_ID)),
            "capture_timeout": int(
                data.get(CONF_CAPTURE_TIMEOUT, DEFAULT_CAPTURE_TIMEOUT)
            ),
            "capture_reassert_interval": int(
                data.get(
                    CONF_CAPTURE_REASSERT_INTERVAL,
                    DEFAULT_CAPTURE_REASSERT_INTERVAL,
                )
            ),
        },
    }


class _ZhaInfraredEntity:
    """Shared identity for the two Core infrared capabilities."""

    _attr_has_entity_name = True
    _attr_name = None

    def __init__(
        self,
        bridge: ZhaBridge,
        adapter: dict[str, Any],
        source_device: dr.DeviceEntry | None,
    ) -> None:
        self._bridge = bridge
        self._adapter = adapter
        self.device_entry = source_device


class SignalEmitter(_ZhaInfraredEntity, InfraredEmitterEntity):
    """Core infrared emitter backed by a supported ZHA adapter."""

    def __init__(
        self,
        bridge: ZhaBridge,
        adapter: dict[str, Any],
        source_device: dr.DeviceEntry | None,
    ) -> None:
        super().__init__(bridge, adapter, source_device)
        self._attr_unique_id = normalize_emitter_ref(adapter["ieee"])

    async def async_send_command(self, command: InfraredCommand) -> None:
        """Send one Core infrared command through the vendor adapter."""
        await self._bridge.send(
            self._adapter,
            signal_from_infrared_command(command),
        )


class SignalReceiver(_ZhaInfraredEntity, InfraredReceiverEntity):
    """Core infrared receiver backed by a supported ZHA adapter."""

    def __init__(
        self,
        bridge: ZhaBridge,
        adapter: dict[str, Any],
        source_device: dr.DeviceEntry | None,
    ) -> None:
        super().__init__(bridge, adapter, source_device)
        self._attr_unique_id = f"{normalize_emitter_ref(adapter['ieee'])}_receiver"
        self._capture_task: asyncio.Task[None] | None = None
        self._subscriber_count = 0

    @callback
    def async_subscribe_received_signal(
        self,
        signal_callback: Callable[[InfraredReceivedSignal], None],
    ) -> CALLBACK_TYPE:
        """Start vendor learning while at least one Core consumer is waiting."""
        unsubscribe = super().async_subscribe_received_signal(signal_callback)
        self._subscriber_count += 1
        self._ensure_capture_task()
        removed = False

        @callback
        def remove_callback() -> None:
            nonlocal removed
            if removed:
                return
            removed = True
            unsubscribe()
            self._subscriber_count -= 1
            if self._subscriber_count == 0 and self._capture_task is not None:
                self._capture_task.cancel()

        return remove_callback

    @callback
    def _ensure_capture_task(self) -> None:
        if self._capture_task is not None and not self._capture_task.done():
            return
        self._capture_task = self.hass.async_create_task(
            self._async_capture_once(),
            f"{self.entity_id} infrared capture",
        )

    async def _async_capture_once(self) -> None:
        try:
            signal = await self._bridge.capture(
                self._adapter,
                timeout=self._adapter["config"]["capture_timeout"],
                poll_interval=1,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            _LOGGER.exception("Infrared capture failed for %s", self.entity_id)
            return
        self._handle_received_signal(
            InfraredReceivedSignal(
                [
                    duration if index % 2 == 0 else -duration
                    for index, duration in enumerate(signal.timings)
                ],
                signal.carrier_frequency,
            )
        )

    async def async_will_remove_from_hass(self) -> None:
        """Stop vendor learning before unloading the provider entity."""
        if self._capture_task is not None and not self._capture_task.done():
            self._capture_task.cancel()
            await asyncio.gather(self._capture_task, return_exceptions=True)
        await super().async_will_remove_from_hass()
