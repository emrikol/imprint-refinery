"""Hardware-neutral routing through Home Assistant's infrared contract."""

import asyncio
from typing import Any

from homeassistant.components import infrared
from homeassistant.components.infrared import InfraredReceivedSignal
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er

from .const import (
    DOMAIN,
    ERROR_CAPTURE_FAILED,
    ERROR_CAPTURE_TIMEOUT,
    ERROR_EMITTER_UNAVAILABLE,
    HOME_ASSISTANT_IR,
)
from .errors import ImprintRefineryError
from .ir_formats import DEFAULT_CARRIER_HZ, IRSignal
from .signal_command import RawSignalCommand
from .zha_bridge import ZhaBridge


class InfraredHardware:
    """Route canonical signals without exposing vendor payloads to the core."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._zha = ZhaBridge(hass)

    async def send(self, emitter: dict[str, Any], signal: IRSignal) -> None:
        """Send one signal using a native HA entity or a compatibility bridge."""
        if emitter.get("transport") == HOME_ASSISTANT_IR:
            reference = emitter.get("entity_id")
            if not reference:
                raise ImprintRefineryError(
                    ERROR_EMITTER_UNAVAILABLE,
                    "Infrared emitter entity is not configured",
                )
            await infrared.async_send_command(
                self._hass,
                str(reference),
                RawSignalCommand(signal),
            )
            return
        await self._zha.send(emitter, signal)

    async def capture(
        self,
        emitter: dict[str, Any],
        *,
        timeout: int,
        poll_interval: int,
    ) -> tuple[IRSignal, str]:
        """Capture one signal and return it with carrier provenance."""
        if emitter.get("transport") != HOME_ASSISTANT_IR:
            signal = await self._zha.capture(
                emitter,
                timeout=timeout,
                poll_interval=poll_interval,
            )
            return signal, self._zha.driver(emitter).carrier_source

        receiver = emitter.get("receiver_entity_id")
        if not receiver:
            raise ImprintRefineryError(
                ERROR_CAPTURE_FAILED,
                "The selected infrared device does not expose a receiver",
            )
        loop = asyncio.get_running_loop()
        result: asyncio.Future[InfraredReceivedSignal] = loop.create_future()

        @callback
        def received(signal: InfraredReceivedSignal) -> None:
            if not result.done():
                result.set_result(signal)

        remove = infrared.async_subscribe_receiver(
            self._hass,
            str(receiver),
            received,
        )
        try:
            captured = await asyncio.wait_for(result, timeout=timeout)
        except TimeoutError as error:
            raise ImprintRefineryError(
                ERROR_CAPTURE_TIMEOUT,
                f"No new IR signal was captured within {timeout} seconds",
            ) from error
        finally:
            remove()
        carrier = captured.modulation or DEFAULT_CARRIER_HZ
        source = "measured" if captured.modulation else "assumed"
        return IRSignal([abs(value) for value in captured.timings], carrier), source

    async def stop_capture(self, emitter: dict[str, Any]) -> None:
        """Stop a bridge capture session during cancellation."""
        if emitter.get("transport") != HOME_ASSISTANT_IR:
            await self._zha.stop_capture(emitter)


def discover_home_assistant_emitters(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Describe native HA emitters and a receiver on the same device."""
    registry = er.async_get(hass)
    devices = dr.async_get(hass)
    receivers_by_device: dict[str, list[Any]] = {}
    receivers_by_config: dict[str, list[Any]] = {}
    for entity_id in infrared.async_get_receivers(hass):
        entry = registry.async_get(entity_id)
        if entry is None or entry.platform == DOMAIN:
            continue
        if entry.device_id:
            receivers_by_device.setdefault(entry.device_id, []).append(entry)
        if entry.config_entry_id:
            receivers_by_config.setdefault(entry.config_entry_id, []).append(entry)

    discovered: list[dict[str, Any]] = []
    for entity_id in infrared.async_get_emitters(hass):
        entry = registry.async_get(entity_id)
        if entry is None or entry.platform == DOMAIN:
            continue
        candidates = (
            receivers_by_device.get(entry.device_id, []) if entry.device_id else []
        )
        if not candidates and entry.config_entry_id:
            config_candidates = receivers_by_config.get(entry.config_entry_id, [])
            if len(config_candidates) == 1:
                candidates = config_candidates
        receiver = (
            min(candidates, key=lambda item: item.entity_id) if candidates else None
        )
        device = devices.async_get(entry.device_id) if entry.device_id else None
        state = hass.states.get(entity_id)
        display_name = (
            getattr(device, "name_by_user", None)
            or getattr(device, "name", None)
            or getattr(entry, "name", None)
            or getattr(entry, "original_name", None)
            or (state.name if state is not None else None)
            or entity_id
        )
        discovered.append(
            {
                "key": f"ha_{entry.id.replace('-', '').lower()}",
                "transport": HOME_ASSISTANT_IR,
                # Registry UUIDs survive entity renames and are accepted by the
                # Home Assistant infrared helper API.
                "entity_id": entry.id,
                "receiver_entity_id": receiver.id if receiver else None,
                "name": display_name,
                "name_authoritative": True,
                "manufacturer": getattr(device, "manufacturer", None),
                "model": getattr(device, "model", None),
                "can_capture": receiver is not None,
            }
        )
    return discovered
