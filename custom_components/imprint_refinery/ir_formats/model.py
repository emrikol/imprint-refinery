"""Transport-independent infrared signal primitives."""

from dataclasses import dataclass

DEFAULT_CARRIER_HZ = 38_000


class IRFormatError(ValueError):
    """The supplied signal or representation is malformed."""


def _positive_integer(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise IRFormatError(f"{label} must be an integer, got {value!r}")
    if value <= 0:
        raise IRFormatError(f"{label} must be positive, got {value}")
    return value


@dataclass(slots=True)
class IRSignal:
    """Alternating mark/space durations with carrier metadata."""

    timings: list[int]
    carrier_frequency: int = DEFAULT_CARRIER_HZ

    def __post_init__(self) -> None:
        self.timings = [_positive_integer(value, "timing") for value in self.timings]
        if not self.timings:
            raise IRFormatError("IR signal must have at least one timing")
        self.carrier_frequency = _positive_integer(
            self.carrier_frequency, "carrier_frequency"
        )


def signal_document(signal: IRSignal, carrier_source: str) -> dict[str, object]:
    """Serialize a signal into the canonical stored and API representation."""
    return {
        "carrier_frequency": signal.carrier_frequency,
        "carrier_source": carrier_source,
        "timings": signal.timings,
    }
