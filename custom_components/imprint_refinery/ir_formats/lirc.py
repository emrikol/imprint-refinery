"""LIRC raw_codes import and export."""

from dataclasses import dataclass
import re

from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal

_NAME_LINE = re.compile(r"^\s*name\s+(\S.*?)\s*$", re.IGNORECASE)
_GAP_LINE = re.compile(r"^\s*gap\s+(\d+)\s*$", re.IGNORECASE)
_FREQUENCY_LINE = re.compile(r"^\s*frequency\s+(\d+)\s*$", re.IGNORECASE)


@dataclass(frozen=True)
class LircCommand:
    """One named raw LIRC command."""

    name: str
    signal: IRSignal


def decode_lirc(text: str) -> list[LircCommand]:
    """Read raw commands from one or more lircd.conf remote blocks."""
    lines = [line.split("#", 1)[0].rstrip() for line in text.splitlines()]
    in_raw = False
    current_name: str | None = None
    current_values: list[int] = []
    frequency = DEFAULT_CARRIER_HZ
    gap: int | None = None
    commands: list[LircCommand] = []

    def finish() -> None:
        nonlocal current_name, current_values
        if current_name is None:
            return
        values = list(current_values)
        if gap is not None and len(values) % 2 == 1:
            values.append(gap)
        if not values:
            raise IRFormatError(f"LIRC command {current_name!r} has no timings")
        commands.append(
            LircCommand(
                name=current_name,
                signal=IRSignal(values, carrier_frequency=frequency),
            )
        )
        current_name = None
        current_values = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if not in_raw:
            if match := _FREQUENCY_LINE.match(line):
                frequency = int(match.group(1))
            elif match := _GAP_LINE.match(line):
                gap = int(match.group(1))
            elif line.lower() == "begin raw_codes":
                in_raw = True
            continue
        if line.lower() == "end raw_codes":
            finish()
            in_raw = False
            continue
        if match := _NAME_LINE.match(raw_line):
            finish()
            current_name = match.group(1).strip()
            continue
        if current_name is None:
            raise IRFormatError("LIRC raw timing data appears before a command name")
        try:
            values = [int(token, 10) for token in line.split()]
        except ValueError as err:
            raise IRFormatError("LIRC raw timings must be decimal integers") from err
        if any(value <= 0 for value in values):
            raise IRFormatError("LIRC raw timings must be positive")
        current_values.extend(values)

    if in_raw:
        raise IRFormatError("LIRC raw_codes section is not terminated")
    if not commands:
        raise IRFormatError("LIRC configuration contains no raw commands")
    return commands


def encode_lirc_command(signal: IRSignal, *, name: str, remote_name: str) -> str:
    """Write one command as a readable LIRC RAW_CODES remote."""
    timings = list(signal.timings)
    gap: int | None = None
    if len(timings) % 2 == 0:
        gap = timings.pop()
    rows = [
        "      " + " ".join(str(value) for value in timings[index : index + 8])
        for index in range(0, len(timings), 8)
    ]
    header = [
        "begin remote",
        f"  name {remote_name}",
        "  flags RAW_CODES",
        f"  frequency {signal.carrier_frequency}",
    ]
    if gap is not None:
        header.append(f"  gap {gap}")
    return "\n".join(
        [
            *header,
            "",
            "  begin raw_codes",
            f"    name {name}",
            *rows,
            "  end raw_codes",
            "end remote",
            "",
        ]
    )


def encode_lirc_profile(
    commands: list[tuple[str, IRSignal]],
    *,
    remote_name: str = "imprint_refinery",
) -> str:
    """Write named signals as exact, carrier-preserving LIRC raw remotes."""
    if not commands:
        raise IRFormatError("LIRC profile must contain at least one command")
    multiple = len(commands) > 1
    blocks = [
        encode_lirc_command(
            signal,
            name=command_name,
            remote_name=f"{remote_name}_{index}" if multiple else remote_name,
        ).rstrip()
        for index, (command_name, signal) in enumerate(commands, start=1)
    ]
    return "\n\n".join(blocks) + "\n"
