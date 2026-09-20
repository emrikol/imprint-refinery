"""Infer useful Home Assistant controls from saved signal roles."""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .product_spec import SIGNAL_ROLES

COMMAND_FEATURE_SET = frozenset(SIGNAL_ROLES)
POWER_FEATURES = frozenset({"power_on", "power_off", "power_toggle"})


class PowerControl(StrEnum):
    """How an appliance's saved signals represent power."""

    ABSENT = "absent"
    DISCRETE = "discrete"
    TOGGLE = "toggle"


@dataclass(frozen=True, slots=True)
class CommandCapabilities:
    """User-facing controls that can be projected from saved signal roles."""

    roles: frozenset[str]
    power_control: PowerControl
    media_controls: frozenset[str]
    source_ids: tuple[str, ...]
    source_labels: dict[str, str]
    power_only: bool


def emitter_capability_attributes(
    entry_data: Mapping[str, Any], driver: Any
) -> dict[str, Any]:
    """Project emitter configuration into diagnostic attributes."""
    return {
        "transport": str(entry_data.get("transport") or "zha_bridge"),
        "driver": str(entry_data["driver"]),
        "capturing": True,
        "sending": True,
        "read_last_captured_code": True,
        "endpoint_id": int(entry_data["endpoint_id"]),
        "ir_control_cluster": f"0x{int(entry_data['cluster_id']):04X}",
        "signal_format": "raw_timings",
        "carrier_frequency_hz": int(driver.carrier_frequency),
        "carrier_source": str(driver.carrier_source),
    }


def _unpack_command(
    item: dict[str, Any] | tuple[str, str | None, str | None],
) -> tuple[str, str | None, str]:
    if isinstance(item, dict):
        signal_id = str(item.get("command_id") or "")
        return (
            signal_id,
            item.get("role") or None,
            str(item.get("name") or signal_id),
        )
    signal_id, role, label = item
    return str(signal_id), role or None, str(label or signal_id)


def _power_control(roles: frozenset[str]) -> PowerControl:
    if {"power_on", "power_off"} <= roles:
        return PowerControl.DISCRETE
    if "power_toggle" in roles:
        return PowerControl.TOGGLE
    return PowerControl.ABSENT


def _media_controls(roles: frozenset[str]) -> frozenset[str]:
    controls = roles & {"play", "stop", "next", "previous"}
    if roles & {"pause", "play_pause_toggle"}:
        controls |= {"pause"}
    if {"volume_up", "volume_down"} <= roles:
        controls |= {"volume_step"}
    if {"mute", "unmute"} <= roles or "mute_toggle" in roles:
        controls |= {"mute"}
    if "source" in roles:
        controls |= {"source"}
    return frozenset(controls)


def infer_capabilities(
    commands: Iterable[dict[str, Any] | tuple[str, str | None, str | None]],
) -> CommandCapabilities:
    """Summarize only explicit, supported command roles."""
    unpacked = tuple(map(_unpack_command, commands))
    valid = tuple(item for item in unpacked if item[1] in COMMAND_FEATURE_SET)
    roles = frozenset(item[1] for item in valid if item[1] is not None)
    sources = tuple(
        sorted(
            (
                (signal_id, label)
                for signal_id, role, label in valid
                if role == "source"
            ),
            key=lambda option: option[1].casefold(),
        )
    )
    return CommandCapabilities(
        roles=roles,
        power_control=_power_control(roles),
        media_controls=_media_controls(roles),
        source_ids=tuple(signal_id for signal_id, _label in sources),
        source_labels=dict(sources),
        power_only=bool(roles & POWER_FEATURES) and roles <= POWER_FEATURES,
    )
