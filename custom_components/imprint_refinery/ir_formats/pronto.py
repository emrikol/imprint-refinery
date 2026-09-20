"""Learned Pronto Hex (type 0000) import and export."""

from .model import IRFormatError, IRSignal

_PRONTO_CLOCK_US = 0.241246
_WORD_MAX = 0xFFFF


def decode_pronto(text: str) -> IRSignal:
    """Decode a learned raw Pronto Hex signal into microsecond timings."""
    tokens = text.replace(",", " ").split()
    try:
        words = [int(token, 16) for token in tokens]
    except ValueError as err:
        raise IRFormatError("Pronto Hex contains a non-hexadecimal word") from err
    if len(words) < 6:
        raise IRFormatError("Pronto Hex is too short")
    if any(word < 0 or word > _WORD_MAX for word in words):
        raise IRFormatError("Pronto Hex words must fit in 16 bits")
    if words[0] != 0x0000:
        raise IRFormatError("only learned raw Pronto Hex type 0000 is supported")
    frequency_word = words[1]
    if frequency_word == 0:
        raise IRFormatError("Pronto Hex frequency word must not be zero")
    intro_pairs = words[2]
    repeat_pairs = words[3]
    expected = 4 + 2 * (intro_pairs + repeat_pairs)
    if len(words) != expected:
        raise IRFormatError(
            f"Pronto Hex declares {expected} words but contains {len(words)}"
        )
    period_us = frequency_word * _PRONTO_CLOCK_US
    carrier_frequency = round(1_000_000 / period_us)
    timings = [max(1, round(word * period_us)) for word in words[4:]]
    return IRSignal(timings=timings, carrier_frequency=carrier_frequency)


def encode_pronto(
    signal: IRSignal,
    *,
    intro_timing_count: int | None = None,
) -> str:
    """Encode a signal as learned raw Pronto Hex type 0000.

    Without explicit segmentation the full signal is encoded as the intro and
    the repeat section is empty. An open-ended signal that stops after a mark
    receives a synthetic trailing space equal to that final mark; this only
    gives Pronto's required burst pair a finite off duration and does not alter
    the source signal. Durations that cannot fit in one Pronto word are
    rejected.
    """
    timings = list(signal.timings)
    original_timing_count = len(timings)
    if original_timing_count % 2:
        timings.append(timings[-1])
        if intro_timing_count == original_timing_count:
            intro_timing_count += 1
    if intro_timing_count is None:
        intro_timing_count = len(timings)
    if (
        intro_timing_count < 0
        or intro_timing_count > len(timings)
        or intro_timing_count % 2
    ):
        raise IRFormatError("Pronto intro length must contain complete pairs")

    frequency_word = round(1_000_000 / (signal.carrier_frequency * _PRONTO_CLOCK_US))
    if not 1 <= frequency_word <= _WORD_MAX:
        raise IRFormatError("carrier frequency cannot be represented as Pronto Hex")
    period_us = frequency_word * _PRONTO_CLOCK_US
    duration_words = [max(1, round(value / period_us)) for value in timings]
    oversized = next((word for word in duration_words if word > _WORD_MAX), None)
    if oversized is not None:
        raise IRFormatError("a duration cannot be represented in one Pronto Hex word")
    intro_pairs = intro_timing_count // 2
    repeat_pairs = (len(timings) - intro_timing_count) // 2
    words = [0x0000, frequency_word, intro_pairs, repeat_pairs, *duration_words]
    return " ".join(f"{word:04X}" for word in words)
