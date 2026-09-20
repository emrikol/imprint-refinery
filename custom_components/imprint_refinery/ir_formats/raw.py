"""Plain raw-timing text import and export."""

import json
import re

from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal

_TOKEN_SPLIT = re.compile(r"[\s,;]+")


def decode_raw(
    text: str,
    *,
    carrier_frequency: int = DEFAULT_CARRIER_HZ,
) -> IRSignal:
    """Parse JSON, unsigned, or alternating signed microsecond durations."""
    source = text.strip()
    if not source:
        raise IRFormatError("raw timing input is empty")

    if source.startswith("["):
        try:
            parsed = json.loads(source)
        except json.JSONDecodeError as err:
            raise IRFormatError("raw timing JSON is invalid") from err
        if not isinstance(parsed, list):
            raise IRFormatError("raw timing JSON must be an array")
        values = parsed
        signed = any(isinstance(value, int) and value < 0 for value in values)
    else:
        tokens = [token for token in _TOKEN_SPLIT.split(source) if token]
        if not tokens:
            raise IRFormatError("raw timing input is empty")
        try:
            values = [int(token, 10) for token in tokens]
        except ValueError as err:
            raise IRFormatError("raw timings must contain decimal integers") from err
        signed = any(token.startswith(("+", "-")) for token in tokens)

    if any(isinstance(value, bool) or not isinstance(value, int) for value in values):
        raise IRFormatError("raw timings must contain integers")
    if signed:
        for index, value in enumerate(values):
            expected_positive = index % 2 == 0
            if value == 0 or (value > 0) != expected_positive:
                raise IRFormatError(
                    "signed raw timings must alternate +mark and -space"
                )
        values = [abs(value) for value in values]

    return IRSignal(
        timings=list(values),
        carrier_frequency=carrier_frequency,
    )


def encode_raw(signal: IRSignal, *, signed: bool = True) -> str:
    """Serialize exact microsecond durations as portable plain text."""
    if signed:
        return " ".join(
            f"{value:+d}" if index % 2 == 0 else f"-{value:d}"
            for index, value in enumerate(signal.timings)
        )
    return " ".join(str(value) for value in signal.timings)
