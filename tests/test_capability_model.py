"""Behavioral checks for translating saved roles into entity controls."""

import pytest

from custom_components.imprint_refinery.capabilities import (
    PowerControl,
    emitter_capability_attributes,
    infer_capabilities,
)
from custom_components.imprint_refinery.zha_drivers import get_zha_driver


def signal(signal_id: str, role: str | None, label: str) -> dict[str, str | None]:
    return {"command_id": signal_id, "role": role, "name": label}


@pytest.mark.parametrize(
    ("roles", "mode"),
    [
        (("power_on", "power_off"), PowerControl.DISCRETE),
        (("power_toggle",), PowerControl.TOGGLE),
        (("play",), PowerControl.ABSENT),
    ],
)
def test_power_model_requires_explicit_roles(roles, mode) -> None:
    abilities = infer_capabilities(
        signal(f"key-{index}", role, role) for index, role in enumerate(roles)
    )

    assert abilities.power_control is mode


def test_media_controls_are_exposed_only_when_their_inputs_are_complete() -> None:
    abilities = infer_capabilities(
        [
            signal("go", "play", "Go"),
            signal("halt", "stop", "Halt"),
            signal("louder", "volume_up", "Louder"),
            signal("mute", "mute", "Mute"),
            signal("mystery", "not_a_role", "Mystery"),
        ]
    )

    assert abilities.media_controls == frozenset({"play", "stop"})
    assert "not_a_role" not in abilities.roles


def test_toggle_and_complete_pairs_unlock_compound_media_controls() -> None:
    abilities = infer_capabilities(
        [
            ("pause-key", "play_pause_toggle", "Play / pause"),
            ("up", "volume_up", "Volume up"),
            ("down", "volume_down", "Volume down"),
            ("mute-key", "mute_toggle", "Mute"),
        ]
    )

    assert abilities.media_controls == frozenset({"pause", "volume_step", "mute"})


def test_sources_are_stably_sorted_by_label() -> None:
    abilities = infer_capabilities(
        [
            signal("hdmi", "source", "Video"),
            signal("aux", "source", "Aux"),
            signal("power", "power_toggle", "Power"),
        ]
    )

    assert abilities.source_ids == ("aux", "hdmi")
    assert abilities.source_labels == {"aux": "Aux", "hdmi": "Video"}


@pytest.mark.parametrize(
    ("roles", "expected"),
    [
        (("power_toggle",), True),
        (("power_on", "power_off"), True),
        (("power_on",), True),
        (("power_toggle", "play"), False),
        ((), False),
    ],
)
def test_power_only_classification(roles, expected) -> None:
    abilities = infer_capabilities(
        (f"signal-{index}", role, role) for index, role in enumerate(roles)
    )
    assert abilities.power_only is expected


def test_emitter_diagnostics_label_assumptions_and_transport_shape() -> None:
    attributes = emitter_capability_attributes(
        {
            "driver": "zosung_ts1201",
            "transport": "zha_bridge",
            "endpoint_id": 1,
            "cluster_id": 0xE004,
        },
        get_zha_driver("zosung_ts1201"),
    )

    assert attributes == {
        "transport": "zha_bridge",
        "driver": "zosung_ts1201",
        "capturing": True,
        "sending": True,
        "read_last_captured_code": True,
        "endpoint_id": 1,
        "ir_control_cluster": "0xE004",
        "signal_format": "raw_timings",
        "carrier_frequency_hz": 38_000,
        "carrier_source": "assumed",
    }
