"""Bridge manufacturer-specific ZHA devices to canonical infrared signals."""

import asyncio
from collections.abc import Iterator, Mapping
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr

from .const import (
    ERROR_CAPTURE_FAILED,
    ERROR_CAPTURE_TIMEOUT,
    ERROR_CLUSTER_NOT_FOUND,
    ERROR_SEND_FAILED,
    ERROR_ZHA_DEVICE_NOT_FOUND,
    ERROR_ZHA_UNAVAILABLE,
)
from .errors import ImprintRefineryError
from .ir_formats import IRSignal
from .zha_drivers import ZhaDriver, detect_zha_driver, get_zha_driver


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


def discover_zha_driver(proxy: Any) -> tuple[str, int, int] | None:
    """Detect a registered bridge driver from advertised endpoint clusters."""
    maps = endpoint_maps(proxy)
    if not maps:
        raise ImprintRefineryError(
            ERROR_ZHA_UNAVAILABLE,
            "ZHA device proxy does not expose endpoints",
        )
    detected = detect_zha_driver([dict(item) for item in maps])
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

    def __init__(self, command_id: int, sequence: int) -> None:
        self._command_id = command_id
        self._sequence = sequence
        self.completed = asyncio.get_running_loop().create_future()

    def cluster_command(self, tsn: int, command_id: int, args: Any) -> None:
        """Handle zigpy's synchronous legacy cluster-listener callback."""
        del tsn
        if (
            int(command_id) == self._command_id
            and int(getattr(args, "seq", -1)) == self._sequence
            and not self.completed.done()
        ):
            self.completed.set_result(None)


class ZhaBridge:
    """Expose one registered ZHA driver through canonical signal operations."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

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
        driver = self.driver(emitter)
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
        try:
            expected_sequence = (int(protocol_device.seq) + 1) % 0x10000
        except (AttributeError, TypeError, ValueError) as error:
            raise ImprintRefineryError(
                ERROR_SEND_FAILED,
                "ZHA IR driver does not expose a transmission sequence",
            ) from error

        waiter = _ClusterCommandWaiter(
            int(driver.send_completion_command),
            expected_sequence,
        )
        completion.add_listener(waiter)
        try:
            try:
                await control.command(driver.send_command, **params)
            except Exception as error:
                raise ImprintRefineryError(
                    ERROR_SEND_FAILED,
                    f"ZHA cluster command {driver.send_command} failed: {error}",
                ) from error
            if int(protocol_device.seq) != expected_sequence:
                raise ImprintRefineryError(
                    ERROR_SEND_FAILED,
                    "ZHA IR transmission sequence changed unexpectedly",
                )
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

    async def read_last_signal(self, emitter: dict[str, Any]) -> IRSignal | None:
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
        return None if value in (None, "") else driver.decode_capture(str(value))

    async def capture(
        self,
        emitter: dict[str, Any],
        *,
        timeout: int,
        poll_interval: int,
    ) -> IRSignal:
        """Capture one changed signal and always leave learning mode."""
        previous = await self.read_last_signal(emitter)
        await self.start_capture(emitter)
        elapsed = 0.0
        reassert = int(emitter["config"].get("capture_reassert_interval", 8))
        next_reassert = float(reassert)
        try:
            while elapsed < timeout:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
                signal = await self.read_last_signal(emitter)
                if signal is not None and signal != previous:
                    return signal
                if elapsed >= next_reassert:
                    await self.start_capture(emitter)
                    next_reassert += reassert
            raise ImprintRefineryError(
                ERROR_CAPTURE_TIMEOUT,
                f"No new IR signal was captured within {timeout} seconds",
            )
        finally:
            await self.stop_capture(emitter)

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
                f"ZHA cluster command {command_id} failed: {error}",
            ) from error
