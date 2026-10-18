"""Bridge manufacturer-specific ZHA devices to canonical infrared signals."""

import asyncio
from collections.abc import Callable, Iterator, Mapping
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .const import (
    ERROR_CAPTURE_FAILED,
    ERROR_CAPTURE_TIMEOUT,
    ERROR_CAPTURE_UNREACHABLE,
    ERROR_CLUSTER_NOT_FOUND,
    ERROR_SEND_FAILED,
    ERROR_ZHA_DEVICE_NOT_FOUND,
    ERROR_ZHA_UNAVAILABLE,
)
from .errors import ImprintRefineryError
from .ir_formats import IRFormatError, IRSignal
from .zha_drivers import ZhaDriver, detect_zha_driver, get_zha_driver

_LOGGER = logging.getLogger(__name__)


def find_zha_device(hass: HomeAssistant, ieee: str) -> dr.DeviceEntry | None:
    """Return the ZHA registry device for an IEEE address."""
    registry = dr.async_get(hass)
    candidates = {str(ieee).lower(), str(ieee).replace(":", "").lower()}
    for entry in hass.config_entries.async_entries("zha"):
        for address in candidates:
            device = registry.async_get_device_by_identifier(
                ("zha", address), entry.entry_id
            )
            if device is not None:
                return device
    return None


def zha_proxy(hass: HomeAssistant, device_id: str) -> Any:
    """Resolve a registry device through Home Assistant's ZHA helper."""
    try:
        from homeassistant.components.zha.helpers import async_get_zha_device_proxy

        return async_get_zha_device_proxy(hass, device_id)
    except Exception as error:
        raise ImprintRefineryError(
            ERROR_ZHA_UNAVAILABLE,
            f"ZHA device proxy is not available: {error}",
        ) from error


def _device_chain(root: Any) -> Iterator[Any]:
    seen: set[int] = set()
    current = root
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = getattr(current, "device", None)


def endpoint_maps(proxy: Any) -> list[Mapping[Any, Any]]:
    """Return every endpoint mapping exposed by a ZHA proxy wrapper."""
    return [
        endpoints
        for node in _device_chain(proxy)
        if isinstance((endpoints := getattr(node, "endpoints", None)), Mapping)
    ]


def discover_zha_driver(
    proxy: Any,
    *,
    manufacturer: str | None = None,
    model: str | None = None,
) -> tuple[str, int, int] | None:
    """Detect a registered bridge driver from advertised endpoint clusters."""
    maps = endpoint_maps(proxy)
    if not maps:
        raise ImprintRefineryError(
            ERROR_ZHA_UNAVAILABLE,
            "ZHA device proxy does not expose endpoints",
        )
    detected = detect_zha_driver(
        [dict(item) for item in maps],
        manufacturer=manufacturer,
        model=model,
    )
    if detected is None:
        return None
    driver, endpoint_id = detected
    return driver.id, endpoint_id, driver.control_cluster


def cluster_from_proxy(
    proxy: Any,
    endpoint_id: int,
    cluster_id: int,
    *,
    ieee: str | None = None,
) -> Any:
    """Resolve one input cluster from the ZHA proxy/device graph."""
    maps = endpoint_maps(proxy)
    if not maps:
        raise ImprintRefineryError(
            ERROR_ZHA_UNAVAILABLE,
            "ZHA device proxy does not expose endpoints",
        )
    for endpoints in maps:
        endpoint = endpoints.get(endpoint_id)
        if endpoint is None:
            continue
        cluster = (getattr(endpoint, "in_clusters", None) or {}).get(cluster_id)
        if cluster is None:
            named = getattr(endpoint, "zosung_ircontrol", None)
            if getattr(named, "cluster_id", None) == cluster_id:
                cluster = named
        if cluster is not None:
            return cluster
    suffix = f" for {ieee}" if ieee else ""
    raise ImprintRefineryError(
        ERROR_CLUSTER_NOT_FOUND,
        f"Cluster 0x{cluster_id:04X} is absent from endpoint {endpoint_id}{suffix}",
    )


class _ClusterCommandWaiter:
    """Resolve when one cluster command arrives for one protocol sequence."""

    def __init__(self, command_id: int) -> None:
        self._command_id = command_id
        self._sequence: int | None = None
        self._observed_sequences: set[int] = set()
        self.completed = asyncio.get_running_loop().create_future()

    def set_transfer(self, sequence: int) -> None:
        """Bind the waiter after the quirk prepares its transfer."""
        self._sequence = sequence
        if self.completed.done():
            return
        if sequence in self._observed_sequences:
            self.completed.set_result(None)

    def cluster_command(self, tsn: int, command_id: int, args: Any) -> None:
        """Handle zigpy's synchronous legacy cluster-listener callback."""
        del tsn
        if self.completed.done():
            return
        command_id = int(command_id)
        sequence = int(getattr(args, "seq", -1))
        if command_id == self._command_id:
            if self._sequence is None:
                self._observed_sequences.add(sequence)
            elif sequence == self._sequence:
                self.completed.set_result(None)


class ZhaBridge:
    """Expose one registered ZHA driver through canonical signal operations."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._send_locks: dict[str, asyncio.Lock] = {}
        self._background_tasks: set[asyncio.Task[None]] = set()

    @staticmethod
    def driver(emitter: dict[str, Any]) -> ZhaDriver:
        return get_zha_driver(str(emitter["driver"]))

    async def start_capture(self, emitter: dict[str, Any]) -> None:
        driver = self.driver(emitter)
        await self._command(
            emitter,
            driver.capture_command,
            driver.capture_on,
            ERROR_CAPTURE_FAILED,
        )

    async def stop_capture(self, emitter: dict[str, Any]) -> None:
        driver = self.driver(emitter)
        await self._command(
            emitter,
            driver.capture_command,
            driver.capture_off,
            ERROR_CAPTURE_FAILED,
        )

    async def send(self, emitter: dict[str, Any], signal: IRSignal) -> None:
        """Send through the driver, serializing only legacy Zosung exchanges."""
        driver = self.driver(emitter)
        if driver.send_completion_cluster is None:
            await self._send_locked(emitter, signal, driver)
            return
        key = str(emitter["ieee"]).strip().casefold()
        async with self._send_locks.setdefault(key, asyncio.Lock()):
            await self._send_locked(emitter, signal, driver)

    async def _send_locked(
        self,
        emitter: dict[str, Any],
        signal: IRSignal,
        driver: ZhaDriver,
    ) -> None:
        params = {driver.send_parameter: driver.encode(signal)}
        if (
            driver.send_completion_cluster is not None
            and driver.send_completion_command is not None
        ):
            await self._send_with_completion(emitter, driver, params)
            return
        await self._command(
            emitter,
            driver.send_command,
            params,
            ERROR_SEND_FAILED,
        )

    async def _send_with_completion(
        self,
        emitter: dict[str, Any],
        driver: ZhaDriver,
        params: dict[str, Any],
    ) -> None:
        """Wait for a driver-defined device completion frame."""
        device = find_zha_device(self._hass, emitter["ieee"])
        if device is None:
            raise ImprintRefineryError(
                ERROR_ZHA_DEVICE_NOT_FOUND,
                f"ZHA device {emitter['ieee']} was not found",
            )
        config = emitter["config"]
        proxy = zha_proxy(self._hass, device.id)
        control = cluster_from_proxy(
            proxy,
            config["endpoint_id"],
            config["control_cluster"],
            ieee=emitter["ieee"],
        )
        completion = cluster_from_proxy(
            proxy,
            config["endpoint_id"],
            int(driver.send_completion_cluster),
            ieee=emitter["ieee"],
        )
        protocol_device = getattr(getattr(control, "endpoint", None), "device", None)
        waiter = _ClusterCommandWaiter(int(driver.send_completion_command))
        completion.add_listener(waiter)
        try:
            try:
                await control.command(driver.send_command, **params)
            except Exception as error:
                raise ImprintRefineryError(
                    ERROR_SEND_FAILED,
                    f"ZHA cluster command {driver.send_command} failed: {error}",
                ) from error
            try:
                expected_sequence = int(protocol_device.seq)
            except (AttributeError, TypeError, ValueError) as error:
                raise ImprintRefineryError(
                    ERROR_SEND_FAILED,
                    "ZHA IR driver does not expose a transmission sequence",
                ) from error
            waiter.set_transfer(expected_sequence)
            try:
                await asyncio.wait_for(
                    waiter.completed,
                    timeout=driver.send_completion_timeout,
                )
            except TimeoutError as error:
                raise ImprintRefineryError(
                    ERROR_SEND_FAILED,
                    "ZHA IR emitter did not confirm transmission completion",
                ) from error
        finally:
            completion.remove_listener(waiter)

    async def _read_last_payload(self, emitter: dict[str, Any]) -> str | None:
        driver = self.driver(emitter)
        ieee = emitter["ieee"]
        device = find_zha_device(self._hass, ieee)
        if device is None:
            raise ImprintRefineryError(
                ERROR_ZHA_DEVICE_NOT_FOUND,
                f"ZHA device {ieee} was not found",
            )
        config = emitter["config"]
        cluster = cluster_from_proxy(
            zha_proxy(self._hass, device.id),
            config["endpoint_id"],
            config["control_cluster"],
            ieee=ieee,
        )
        values, failed = await cluster.read_attributes([driver.capture_attribute_id])
        if failed:
            values, failed = await cluster.read_attributes([driver.capture_attribute])
        if failed:
            raise ImprintRefineryError(
                ERROR_CLUSTER_NOT_FOUND,
                f"Could not read ZHA attribute 0x{driver.capture_attribute_id:04X}: {failed}",
            )
        value = values.get(
            driver.capture_attribute_id,
            values.get(driver.capture_attribute),
        )
        return None if value in (None, "") else str(value)

    async def read_last_signal(self, emitter: dict[str, Any]) -> IRSignal | None:
        """Read and decode the most recently learned vendor payload."""
        payload = await self._read_last_payload(emitter)
        return None if payload is None else self.driver(emitter).decode_capture(payload)

    async def capture(
        self,
        emitter: dict[str, Any],
        *,
        timeout: int,
        poll_interval: int,
        armed_callback: Callable[[], None] | None = None,
        command_attempt_timeout: float = 10,
        arming_timeout: float = 45,
    ) -> IRSignal:
        """Capture one changed signal and always leave learning mode."""
        previous: str | None = None
        baseline_known = False
        try:
            previous = await self._read_last_payload(emitter)
            baseline_known = True
        except Exception as error:  # noqa: BLE001 - listening must survive it.
            _LOGGER.warning(
                "Could not read the prior infrared capture from %s: %s",
                emitter["ieee"],
                error,
            )
        captured: IRSignal | None = None
        started = False
        elapsed = 0.0
        arming_elapsed = 0.0
        reassert = int(emitter["config"].get("capture_reassert_interval", 8))
        next_reassert = float(reassert)
        try:
            while captured is None:
                if not started:
                    if arming_elapsed >= arming_timeout:
                        raise ImprintRefineryError(
                            ERROR_CAPTURE_UNREACHABLE,
                            "The infrared receiver did not answer. "
                            "Wake the device and try again.",
                        )
                    try:
                        # One unbounded attempt lets the parent router queue
                        # the command until a sleepy device polls for it.
                        await self.start_capture(emitter)
                        started = True
                        _LOGGER.info("Infrared capture armed for %s", emitter["ieee"])
                        if armed_callback is not None:
                            armed_callback()
                    except Exception as error:  # noqa: BLE001 - retried below.
                        _LOGGER.warning(
                            "Could not start infrared capture on %s: %s",
                            emitter["ieee"],
                            error,
                        )
                await asyncio.sleep(poll_interval)
                if started:
                    elapsed += poll_interval
                else:
                    arming_elapsed += poll_interval
                try:
                    payload = await self._read_last_payload(emitter)
                except Exception as error:  # noqa: BLE001 - keep listening.
                    _LOGGER.warning(
                        "Could not read infrared capture from %s: %s",
                        emitter["ieee"],
                        error,
                    )
                else:
                    if not baseline_known:
                        previous = payload
                        baseline_known = True
                    elif payload is not None and payload != previous:
                        previous = payload
                        try:
                            captured = self.driver(emitter).decode_capture(payload)
                        except IRFormatError as error:
                            _LOGGER.warning(
                                "Ignoring malformed infrared capture from %s: %s",
                                emitter["ieee"],
                                error,
                            )
                        else:
                            break
                if (
                    started
                    and self.driver(emitter).reassert_capture
                    and elapsed >= next_reassert
                ):
                    try:
                        await asyncio.wait_for(
                            self.start_capture(emitter),
                            timeout=command_attempt_timeout,
                        )
                    except Exception as error:  # noqa: BLE001 - keep listening.
                        _LOGGER.warning(
                            "Could not reassert infrared capture on %s: %s",
                            emitter["ieee"],
                            error,
                        )
                    next_reassert += reassert
                if started and elapsed >= timeout:
                    raise ImprintRefineryError(
                        ERROR_CAPTURE_TIMEOUT,
                        f"No new IR signal was captured within {timeout} seconds",
                    )
        finally:
            if captured is None:
                await self._async_stop_capture_quietly(emitter)
        # Deliver the signal first. A slow stop command must not delay or
        # outlive the caller's own capture deadline.
        stop_task = asyncio.create_task(self._async_stop_capture_quietly(emitter))
        self._background_tasks.add(stop_task)
        stop_task.add_done_callback(self._background_tasks.discard)
        return captured

    async def _async_stop_capture_quietly(self, emitter: dict[str, Any]) -> None:
        """Leave learning mode without masking a capture result or timeout."""
        try:
            await asyncio.wait_for(self.stop_capture(emitter), timeout=10)
        except Exception as error:  # noqa: BLE001 - never mask the result.
            _LOGGER.warning(
                "Could not stop infrared capture on %s: %s",
                emitter["ieee"],
                error,
            )

    async def _command(
        self,
        emitter: dict[str, Any],
        command_id: int,
        params: dict[str, Any],
        error_code: str,
    ) -> None:
        config = emitter["config"]
        call = {
            "ieee": emitter["ieee"],
            "endpoint_id": config["endpoint_id"],
            "cluster_id": config["control_cluster"],
            "cluster_type": "in",
            "command": command_id,
            "command_type": "server",
            "params": params,
        }
        try:
            await self._hass.services.async_call(
                "zha", "issue_zigbee_cluster_command", call, blocking=True
            )
        except Exception as error:
            raise ImprintRefineryError(
                error_code,
                f"ZHA cluster command {command_id} failed: "
                f"{type(error).__name__}: {error!r}",
            ) from error
