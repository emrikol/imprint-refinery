"""Transport-neutral infrared commands carried through Home Assistant."""

from dataclasses import dataclass
from typing import Any

from infrared_protocols.commands import Command as InfraredCommand

from .ir_formats import IRFormatError, IRSignal, decode_signal
from .ir_formats.conversion import DecodedSignal


@dataclass(frozen=True, slots=True)
class LibraryPath:
    remote_profile_id: str | None = None
    appliance_id: str | None = None
    command_id: str | None = None


class RawSignalCommand(InfraredCommand):
    """A canonical timing sequence accepted by Home Assistant IR emitters."""

    def __init__(
        self,
        signal: IRSignal,
        *,
        repeats: int = 0,
        path: LibraryPath | None = None,
    ) -> None:
        super().__init__(
            modulation=signal.carrier_frequency,
            repeat_count=repeats,
        )
        self._timings = tuple(
            duration if index % 2 == 0 else -duration
            for index, duration in enumerate(signal.timings)
        )
        self.path = path or LibraryPath()

    def get_raw_timings(self) -> list[int]:
        """Return signed mark/space durations as required by Home Assistant."""
        return list(self._timings)


def decoded_signal_from_command(command: dict[str, Any]) -> DecodedSignal:
    """Decode a stored command while preserving carrier provenance."""
    value = command.get("signal")
    if isinstance(value, dict) and isinstance(value.get("timings"), list):
        return DecodedSignal(
            IRSignal(
                [abs(int(duration)) for duration in value["timings"]],
                int(value.get("carrier_frequency") or 38_000),
            ),
            str(value.get("carrier_source") or "assumed"),
        )
    code = command.get("code")
    if not isinstance(code, str) or not code:
        raise IRFormatError("Stored command does not contain a signal")
    carrier = command.get("carrier_frequency")
    return decode_signal(
        code,
        str(command.get("format") or "raw_signed"),
        carrier_frequency=int(carrier) if carrier else None,
    )


def signal_from_command(command: dict[str, Any]) -> IRSignal:
    """Return the canonical signal stored in a library command."""
    return decoded_signal_from_command(command).signal


def signal_from_infrared_command(command: InfraredCommand) -> IRSignal:
    """Normalize any Home Assistant infrared command into canonical timings."""
    return IRSignal(
        [abs(int(duration)) for duration in command.get_raw_timings()],
        int(command.modulation),
    )
