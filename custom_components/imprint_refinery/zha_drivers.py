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
from .ir_formats import (
    IRSignal,
    broadlink_decode,
    broadlink_encode,
    zosung_decode,
    zosung_encode,
)


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
    manufacturers: tuple[str, ...] = ()
    models: tuple[str, ...] = ()
    send_completion_on_end_request: bool = False

    def matches_device(self, manufacturer: str | None, model: str | None) -> bool:
        """Return whether optional identity constraints match a device."""
        manufacturer_key = (manufacturer or "").strip().casefold()
        model_key = (model or "").strip().casefold()
        return (
            not self.manufacturers
            or manufacturer_key in {value.casefold() for value in self.manufacturers}
        ) and (
            not self.models or model_key in {value.casefold() for value in self.models}
        )

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
        id="hobeian_zg_ir01",
        name="HOBEIAN ZG-IR01 IR bridge",
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
        encode=broadlink_encode,
        decode=broadlink_decode,
        manufacturers=("HOBEIAN",),
        models=("ZG-IR01",),
        send_completion_on_end_request=True,
    ),
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

DEFAULT_ZHA_DRIVER = "zosung_ts1201"


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
    *,
    manufacturer: str | None = None,
    model: str | None = None,
) -> tuple[ZhaDriver, int] | None:
    """Match advertised clusters against every known driver."""
    for driver in DRIVERS:
        if not driver.matches_device(manufacturer, model):
            continue
        for endpoints in endpoint_maps:
            for endpoint_id, endpoint in endpoints.items():
                if driver.matches(endpoint):
                    return driver, int(endpoint_id)
    return None


def driver_for_device(
    driver_id: str,
    *,
    manufacturer: str | None,
    model: str | None,
) -> ZhaDriver:
    """Upgrade a generic stored driver to a model-specific variant."""
    configured = get_zha_driver(driver_id)
    for candidate in DRIVERS:
        if (
            candidate.control_cluster == configured.control_cluster
            and (candidate.manufacturers or candidate.models)
            and candidate.matches_device(manufacturer, model)
        ):
            return candidate
    return configured
