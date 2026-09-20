"""Flipper Zero infrared remote-file import and raw export."""

from dataclasses import dataclass

from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal
from .protocols.known import KNOWN_PROTOCOLS, encode_known_protocol

_MAX_TIMINGS = 1024
_SUPPORTED_FILETYPES = {"IR signals file", "IR library file"}


@dataclass(frozen=True)
class FlipperCommand:
    """One named signal from a Flipper ``.ir`` file."""

    name: str
    signal: IRSignal
    duty_cycle: float
    record_type: str = "raw"
    protocol: str | None = None
    address: int | None = None
    command: int | None = None


@dataclass(frozen=True)
class UnsupportedFlipperCommand:
    """One preserved Flipper record that could not be decoded."""

    name: str
    source: str
    error: str


def decode_flipper(text: str) -> list[FlipperCommand]:
    """Decode every raw or parsed command in a Flipper infrared file."""
    fields: dict[str, str] = {}
    records: list[dict[str, str]] = []
    filetype: str | None = None
    version: str | None = None

    def finish() -> None:
        nonlocal fields
        if fields:
            records.append(fields)
            fields = {}

    for source_line in text.splitlines():
        line = source_line.strip()
        if not line:
            continue
        if line == "#":
            finish()
            continue
        if line.startswith("#"):
            continue
        if ":" not in line:
            raise IRFormatError("Flipper IR lines must use 'key: value'")
        key, value = (part.strip() for part in line.split(":", 1))
        if not key:
            raise IRFormatError("Flipper IR field name is empty")
        if key == "Filetype":
            filetype = value
        elif key == "Version":
            version = value
        else:
            fields[key.lower()] = value
    finish()

    if filetype not in _SUPPORTED_FILETYPES:
        raise IRFormatError("not a supported Flipper infrared remote file")
    if version != "1":
        raise IRFormatError(f"unsupported Flipper IR version: {version or 'missing'}")

    commands: list[FlipperCommand] = []
    for index, record in enumerate(records, start=1):
        name = record.get("name") or f"command_{index}"
        record_type = record.get("type", "").lower()
        if record_type == "parsed":
            commands.append(_decode_parsed_command(record, name))
        elif record_type == "raw":
            commands.append(_decode_raw_command(record, name))
        else:
            raise IRFormatError(f"Flipper command {name!r} has an unsupported type")

    if not commands:
        raise IRFormatError("Flipper IR file contains no commands")
    return commands


def decode_flipper_partial(
    text: str,
) -> tuple[list[FlipperCommand], list[UnsupportedFlipperCommand]]:
    """Decode supported records while preserving each unsupported record."""
    documents = _split_flipper_documents(text)
    commands: list[FlipperCommand] = []
    unsupported: list[UnsupportedFlipperCommand] = []
    for index, document in enumerate(documents, start=1):
        name = _record_name(document, index)
        try:
            commands.extend(decode_flipper(document))
        except IRFormatError as err:
            unsupported.append(
                UnsupportedFlipperCommand(
                    name=name,
                    source=document,
                    error=str(err),
                )
            )
    return commands, unsupported


def _split_flipper_documents(text: str) -> list[str]:
    """Split a Flipper file into independently decodable exact-source records."""
    lines = text.splitlines(keepends=True)
    header: list[str] = []
    records: list[list[str]] = []
    current: list[str] | None = None
    filetype: str | None = None
    version: str | None = None

    for source_line in lines:
        line = source_line.strip()
        if line == "#":
            if current is not None:
                records.append(current)
            current = [source_line]
            continue
        if current is not None:
            current.append(source_line)
            continue
        header.append(source_line)
        if not line or line.startswith("#"):
            continue
        if ":" not in line:
            raise IRFormatError("Flipper IR lines must use 'key: value'")
        key, value = (part.strip() for part in line.split(":", 1))
        if key == "Filetype":
            filetype = value
        elif key == "Version":
            version = value
    if current is not None:
        records.append(current)

    if filetype not in _SUPPORTED_FILETYPES:
        raise IRFormatError("not a supported Flipper infrared remote file")
    if version != "1":
        raise IRFormatError(f"unsupported Flipper IR version: {version or 'missing'}")
    if not records:
        raise IRFormatError("Flipper IR file contains no commands")

    prefix = "".join(header)
    if prefix and not prefix.endswith(("\n", "\r")):
        prefix += "\n"
    return [prefix + "".join(record) for record in records]


def _record_name(document: str, index: int) -> str:
    for source_line in document.splitlines():
        if source_line.strip().lower().startswith("name:"):
            return source_line.split(":", 1)[1].strip() or f"command_{index}"
    return f"command_{index}"


def _decode_raw_command(record: dict[str, str], name: str) -> FlipperCommand:
    try:
        frequency = int(record.get("frequency", str(DEFAULT_CARRIER_HZ)))
        duty_cycle = float(record.get("duty_cycle", "0.33"))
        timings = [int(value) for value in record.get("data", "").split()]
    except ValueError as err:
        raise IRFormatError(
            f"Flipper command {name!r} has invalid numeric data"
        ) from err
    if not timings:
        raise IRFormatError(f"Flipper command {name!r} has no raw timings")
    if len(timings) > _MAX_TIMINGS:
        raise IRFormatError(f"Flipper command {name!r} exceeds {_MAX_TIMINGS} timings")
    if not 0 < duty_cycle <= 1:
        raise IRFormatError(f"Flipper command {name!r} has an invalid duty cycle")
    return FlipperCommand(
        name=name,
        signal=IRSignal(timings=timings, carrier_frequency=frequency),
        duty_cycle=duty_cycle,
    )


def _decode_parsed_command(record: dict[str, str], name: str) -> FlipperCommand:
    protocol = record.get("protocol", "")
    if protocol not in KNOWN_PROTOCOLS:
        supported = ", ".join(sorted(KNOWN_PROTOCOLS))
        raise IRFormatError(
            f"Flipper command {name!r} uses unsupported parsed protocol "
            f"{protocol or 'missing'!r}; supported protocols: {supported}"
        )
    address = _parse_hex_bytes(record.get("address", ""), "address", name)
    command = _parse_hex_bytes(record.get("command", ""), "command", name)
    try:
        signal = encode_known_protocol(protocol, address, command)
    except ValueError as err:
        raise IRFormatError(f"Flipper command {name!r}: {err}") from err
    return FlipperCommand(
        name=name,
        signal=signal,
        duty_cycle=0.33,
        record_type="parsed",
        protocol=protocol,
        address=address,
        command=command,
    )


def _parse_hex_bytes(value: str, field: str, name: str) -> int:
    parts = value.split()
    if len(parts) != 4:
        raise IRFormatError(
            f"Flipper command {name!r} {field} must contain exactly four bytes"
        )
    try:
        raw = bytes(int(part, 16) for part in parts)
    except ValueError as err:
        raise IRFormatError(
            f"Flipper command {name!r} has an invalid hexadecimal {field}"
        ) from err
    if any(len(part) != 2 for part in parts):
        raise IRFormatError(
            f"Flipper command {name!r} {field} bytes must use two hex digits"
        )
    return int.from_bytes(raw, "little")


def encode_flipper_command(
    signal: IRSignal,
    *,
    name: str,
    duty_cycle: float = 0.33,
) -> str:
    """Encode one canonical signal as a Flipper raw infrared file."""
    return _encode_flipper_profile([(name, signal)], duty_cycle=duty_cycle)


def encode_flipper_profile(
    commands: list[tuple[str, IRSignal]],
    *,
    duty_cycle: float = 0.33,
) -> str:
    """Encode named signals as one multi-button Flipper raw ``.ir`` file."""
    if not commands:
        raise IRFormatError("Flipper profile must contain at least one command")
    return _encode_flipper_profile(commands, duty_cycle=duty_cycle)


def _encode_flipper_profile(
    commands: list[tuple[str, IRSignal]],
    *,
    duty_cycle: float,
) -> str:
    """Build a Flipper file after validating every raw record."""
    if not 0 < duty_cycle <= 1:
        raise IRFormatError("Flipper duty cycle must be greater than 0 and at most 1")
    records: list[str] = []
    for name, signal in commands:
        records.append(_encode_flipper_record(signal, name, duty_cycle))
    return "\n".join(
        [
            "Filetype: IR signals file",
            "Version: 1",
            *records,
            "",
        ]
    )


def _encode_flipper_record(signal: IRSignal, name: str, duty_cycle: float) -> str:
    """Encode one validated raw record without a file header."""
    if len(signal.timings) > _MAX_TIMINGS:
        raise IRFormatError(
            f"Flipper raw signals support at most {_MAX_TIMINGS} timings"
        )
    safe_name = "".join(character for character in name if 32 <= ord(character) <= 126)
    safe_name = safe_name.strip() or "Command"
    return "\n".join(
        [
            "#",
            f"name: {safe_name}",
            "type: raw",
            f"frequency: {signal.carrier_frequency}",
            f"duty_cycle: {duty_cycle:.6f}",
            "data: " + " ".join(str(value) for value in signal.timings),
        ]
    )
