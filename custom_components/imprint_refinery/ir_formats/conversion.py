"""Format-neutral single-signal conversion helpers."""

from dataclasses import dataclass
import re

from .flipper import (
    FlipperCommand,
    decode_flipper,
    decode_flipper_partial,
    encode_flipper_command,
    encode_flipper_profile,
)
from .girr import GirrCommand, decode_girr, encode_girr_command, encode_girr_profile
from .lirc import decode_lirc, encode_lirc_command, encode_lirc_profile
from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal
from .pronto import decode_pronto, encode_pronto
from .raw import decode_raw, encode_raw
from .zosung import decode as decode_zosung, encode as encode_zosung

INPUT_FORMATS = (
    "zosung_base64",
    "raw",
    "raw_signed",
    "raw_unsigned",
    "pronto",
    "girr",
    "lirc",
    "flipper",
)
OUTPUT_FORMATS = (
    "zosung_base64",
    "raw_signed",
    "raw_unsigned",
    "pronto",
    "girr",
    "lirc",
    "flipper",
)
PROFILE_OUTPUT_FORMATS = ("girr", "flipper", "lirc")


@dataclass(frozen=True)
class DecodedSignal:
    """A parsed single signal plus carrier provenance."""

    signal: IRSignal
    carrier_source: str
    name: str | None = None
    metadata: dict[str, object] | None = None


def decode_signal(
    value: str,
    input_format: str,
    *,
    carrier_frequency: int | None = None,
) -> DecodedSignal:
    """Decode one supported representation without silently choosing a command."""
    if input_format not in INPUT_FORMATS:
        raise IRFormatError(f"unsupported input format: {input_format}")
    fallback_carrier = carrier_frequency or DEFAULT_CARRIER_HZ
    fallback_source = "provided" if carrier_frequency else "assumed"
    if input_format == "zosung_base64":
        return DecodedSignal(
            decode_zosung(value, carrier_frequency=fallback_carrier),
            fallback_source,
        )
    if input_format in {"raw", "raw_signed", "raw_unsigned"}:
        return DecodedSignal(
            decode_raw(value, carrier_frequency=fallback_carrier),
            fallback_source,
        )
    if input_format == "pronto":
        return DecodedSignal(decode_pronto(value), "embedded")
    if input_format == "girr":
        commands = decode_girr(value)
        if len(commands) != 1:
            raise IRFormatError(
                "Girr contains multiple commands; use profile import instead"
            )
        command = commands[0]
        return DecodedSignal(
            command.signal,
            "embedded",
            command.name,
            _girr_metadata(command),
        )
    if input_format == "flipper":
        commands = decode_flipper(value)
        if len(commands) != 1:
            raise IRFormatError(
                "Flipper file contains multiple commands; use profile import instead"
            )
        command = commands[0]
        return DecodedSignal(
            command.signal,
            "embedded",
            command.name,
            _flipper_metadata(command),
        )
    commands = decode_lirc(value)
    if len(commands) != 1:
        raise IRFormatError(
            "LIRC configuration contains multiple commands; use profile import instead"
        )
    return DecodedSignal(commands[0].signal, "embedded", commands[0].name)


def decode_profile(
    value: str,
    input_format: str,
    *,
    carrier_frequency: int | None = None,
) -> list[DecodedSignal]:
    """Decode every named signal in a supported import document.

    Single-command formats deliberately use the same decoder as conversion;
    Girr and LIRC retain every command instead of choosing one silently.
    """
    if input_format == "girr":
        return [
            DecodedSignal(
                command.signal,
                "embedded",
                command.name,
                _girr_metadata(command),
            )
            for command in decode_girr(value)
        ]
    if input_format == "lirc":
        return [
            DecodedSignal(command.signal, "embedded", command.name)
            for command in decode_lirc(value)
        ]
    if input_format == "flipper":
        return [
            DecodedSignal(
                command.signal,
                "embedded",
                command.name,
                _flipper_metadata(command),
            )
            for command in decode_flipper(value)
        ]
    return [
        decode_signal(
            value,
            input_format,
            carrier_frequency=carrier_frequency,
        )
    ]


def decode_profile_partial(
    value: str,
    input_format: str,
    *,
    carrier_frequency: int | None = None,
) -> tuple[list[DecodedSignal], list[dict[str, str]]]:
    """Decode a profile without discarding valid Flipper records on one failure."""
    if input_format != "flipper":
        return (
            decode_profile(
                value,
                input_format,
                carrier_frequency=carrier_frequency,
            ),
            [],
        )
    commands, unsupported = decode_flipper_partial(value)
    return (
        [
            DecodedSignal(
                command.signal,
                "embedded",
                command.name,
                _flipper_metadata(command),
            )
            for command in commands
        ],
        [
            {
                "name": record.name,
                "source": record.source,
                "error": record.error,
            }
            for record in unsupported
        ],
    )


def encode_signal_format(
    signal: IRSignal,
    output_format: str,
    *,
    name: str = "Command",
) -> str:
    """Encode one signal in a supported portable representation."""
    if output_format not in OUTPUT_FORMATS:
        raise IRFormatError(f"unsupported output format: {output_format}")
    if output_format == "zosung_base64":
        return encode_zosung(signal)
    if output_format == "raw_signed":
        return encode_raw(signal, signed=True)
    if output_format == "raw_unsigned":
        return encode_raw(signal, signed=False)
    if output_format == "pronto":
        return encode_pronto(signal)
    if output_format == "girr":
        return encode_girr_command(signal, name=name)
    if output_format == "flipper":
        return encode_flipper_command(signal, name=name)
    safe_name = _safe_lirc_name(name)
    return encode_lirc_command(
        signal,
        name=safe_name,
        remote_name="imprint_refinery",
    )


def encode_profile_format(
    commands: list[tuple[str, IRSignal]],
    output_format: str,
    *,
    profile_name: str = "Imprint Refinery",
) -> str:
    """Encode named signals in a portable multi-command representation."""
    if output_format not in PROFILE_OUTPUT_FORMATS:
        raise IRFormatError(f"unsupported profile output format: {output_format}")
    if output_format == "girr":
        return encode_girr_profile(commands, name=profile_name)
    if output_format == "flipper":
        return encode_flipper_profile(commands)
    safe_profile_name = _safe_lirc_name(profile_name).lower()
    safe_commands = [(_safe_lirc_name(name), signal) for name, signal in commands]
    return encode_lirc_profile(safe_commands, remote_name=safe_profile_name)


def convert_signal(
    value: str,
    input_format: str,
    output_format: str,
    *,
    carrier_frequency: int | None = None,
    name: str = "Command",
) -> tuple[DecodedSignal, str]:
    """Decode and re-encode one signal, returning both canonical and text forms."""
    decoded = decode_signal(
        value,
        input_format,
        carrier_frequency=carrier_frequency,
    )
    return decoded, encode_signal_format(
        decoded.signal,
        output_format,
        name=name or decoded.name or "Command",
    )


def conversion_loss_report(
    signal: IRSignal,
    output_format: str,
    *,
    name: str = "Command",
) -> dict[str, object]:
    """Describe timing/carrier loss introduced by one portable representation."""
    encoded = encode_signal_format(signal, output_format, name=name)
    carrier_embedded = output_format in {"pronto", "girr", "lirc", "flipper"}
    decoded = decode_signal(
        encoded,
        output_format,
        carrier_frequency=None if carrier_embedded else signal.carrier_frequency,
    ).signal
    timing_errors = [
        abs(expected - actual)
        for expected, actual in zip(signal.timings, decoded.timings, strict=False)
    ]
    timings_exact = signal.timings == decoded.timings
    carrier_delta = abs(signal.carrier_frequency - decoded.carrier_frequency)
    losses: list[str] = []
    trailing_space_added_us: int | None = None
    if (
        len(signal.timings) % 2
        and len(decoded.timings) == len(signal.timings) + 1
        and output_format in {"pronto", "girr"}
    ):
        trailing_space_added_us = decoded.timings[-1]
        losses.append("trailing_space_added")
    elif len(signal.timings) != len(decoded.timings):
        losses.append("timing_count_changed")
    elif not timings_exact:
        losses.append("timings_rounded")
    if not carrier_embedded:
        losses.append("carrier_requires_external_metadata")
    elif carrier_delta:
        losses.append("carrier_rounded")
    return {
        "lossless": not losses,
        "losses": losses,
        "timings_exact": timings_exact,
        "timing_count_before": len(signal.timings),
        "timing_count_after": len(decoded.timings),
        "trailing_space_added_us": trailing_space_added_us,
        "trailing_space_source": (
            "matched_final_mark" if trailing_space_added_us is not None else None
        ),
        "maximum_timing_error_us": max(timing_errors, default=0),
        "carrier_embedded": carrier_embedded,
        "carrier_frequency_before": signal.carrier_frequency,
        "carrier_frequency_after": decoded.carrier_frequency,
        "carrier_error_hz": carrier_delta,
    }


def _safe_lirc_name(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_]+", "_", value.strip()).strip("_")
    return normalized or "COMMAND"


def _flipper_metadata(command: FlipperCommand) -> dict[str, object]:
    """Retain Flipper record semantics without coupling the canonical signal."""
    return {
        "record_type": command.record_type,
        "protocol": command.protocol,
        "address": command.address,
        "command": command.command,
        "duty_cycle": command.duty_cycle,
    }


def _girr_metadata(command: GirrCommand) -> dict[str, object]:
    """Retain Girr intro/repeat/ending boundaries on the import source."""
    return {
        "intro_timing_count": command.intro_timing_count,
        "repeat_timing_count": command.repeat_timing_count,
        "ending_timing_count": command.ending_timing_count,
    }
