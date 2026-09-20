"""Declarative drivers for ZHA devices that lack native infrared entities.

Zigbee endpoints advertise cluster IDs, which is enough to select a known
driver. The meaning of manufacturer-specific commands and attributes is not
advertised, so each supported protocol is described here once.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .const import ERROR_UNKNOWN_DRIVER
from .errors import ImprintRefineryError
from .ir_formats import IRSignal, zosung_decode, zosung_encode


@dataclass(frozen=True, slots=True)
class ZhaDriver:
    """One discoverable vendor protocol exposed through canonical IR signals."""

    id: str
    name: str
    control_cluster: int
    capture_command: int
    capture_on: dict[str, Any]
    capture_off: dict[str, Any]
    send_command: int
    send_parameter: str
    send_completion_cluster: int | None
    send_completion_command: int | None
    send_completion_timeout: float
    capture_attribute: str
    capture_attribute_id: int
    carrier_frequency: int
    carrier_source: str
    encode: Callable[[IRSignal], str]
    decode: Callable[..., IRSignal]

    def matches(self, endpoint: Any) -> bool:
        """Return whether an advertised endpoint has this driver's cluster."""
        clusters = getattr(endpoint, "in_clusters", None) or {}
        if self.control_cluster in clusters:
            return True
        named = getattr(endpoint, "zosung_ircontrol", None)
        return getattr(named, "cluster_id", None) == self.control_cluster

    def decode_capture(self, payload: str) -> IRSignal:
        """Decode a device payload into the product's canonical signal."""
        return self.decode(payload, carrier_frequency=self.carrier_frequency)


DRIVERS: tuple[ZhaDriver, ...] = (
    ZhaDriver(
        id="zosung_ts1201",
        name="Zosung TS1201-compatible IR bridge",
        control_cluster=0xE004,
        capture_command=1,
        capture_on={"on_off": True},
        capture_off={"on_off": False},
        send_command=2,
        send_parameter="code",
        send_completion_cluster=0xED00,
        send_completion_command=0x04,
        send_completion_timeout=10.0,
        capture_attribute="last_learned_ir_code",
        capture_attribute_id=0,
        carrier_frequency=38_000,
        carrier_source="assumed",
        encode=zosung_encode,
        decode=zosung_decode,
    ),
)

DEFAULT_ZHA_DRIVER = DRIVERS[0].id


def get_zha_driver(driver_id: str) -> ZhaDriver:
    """Return a registered ZHA bridge driver."""
    for driver in DRIVERS:
        if driver.id == driver_id:
            return driver
    raise ImprintRefineryError(
        ERROR_UNKNOWN_DRIVER, f"Unknown ZHA IR driver: {driver_id}"
    )


def detect_zha_driver(
    endpoint_maps: list[dict[Any, Any]],
) -> tuple[ZhaDriver, int] | None:
    """Match advertised clusters against every known driver."""
    for driver in DRIVERS:
        for endpoints in endpoint_maps:
            for endpoint_id, endpoint in endpoints.items():
                if driver.matches(endpoint):
                    return driver, int(endpoint_id)
    return None
