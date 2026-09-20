"""Unit tests for canonical Home Assistant infrared commands."""

from infrared_protocols.commands import Command as InfraredCommand

from custom_components.imprint_refinery.ir_formats import IRSignal
from custom_components.imprint_refinery.signal_command import (
    LibraryPath,
    RawSignalCommand,
    signal_from_command,
    signal_from_infrared_command,
)


def test_raw_command_preserves_signal_repeats_and_library_path() -> None:
    path = LibraryPath("living", "amp", "power")
    command = RawSignalCommand(
        IRSignal([9000, 4500, 560, 560], 38_000), repeats=2, path=path
    )

    assert command.modulation == 38_000
    assert command.repeat_count == 2
    assert command.path == path
    assert command.get_raw_timings() == [9000, -4500, 560, -560]


def test_stored_signal_is_the_canonical_source() -> None:
    signal = signal_from_command(
        {
            "code": "ignored",
            "format": "raw_signed",
            "signal": {"carrier_frequency": 40_000, "timings": [100, 200]},
        }
    )
    assert signal == IRSignal([100, 200], 40_000)


def test_raw_code_is_accepted_when_signal_metadata_is_absent() -> None:
    assert signal_from_command(
        {"code": "+100 -200 +300", "format": "raw_signed"}
    ) == IRSignal([100, 200, 300], 38_000)


def test_any_home_assistant_command_normalizes_to_raw_signal() -> None:
    class CompatibleCommand(InfraredCommand):
        def __init__(self) -> None:
            super().__init__(modulation=56_000)

        def get_raw_timings(self) -> list[int]:
            return [100, -200, 300]

    assert signal_from_infrared_command(CompatibleCommand()) == IRSignal(
        [100, 200, 300], 56_000
    )
