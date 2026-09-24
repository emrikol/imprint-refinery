"""Sony SIRC waveform generator."""

from infrared_protocols.commands.sony import SonyCommand

from ..model import IRFormatError, IRSignal

CARRIER_HZ = 40_000
UNIT_US = 600
HEADER_MARK_US = 2_400
FRAME_PERIOD_US = 45_000
DEFAULT_REPEATS = 3
MAX_REPEATS = 20

_DEVICE_BITS = {12: 5, 15: 8, 20: 5}
_EXTENDED_BITS = 8


def _require_unsigned(name: str, value: int, width: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise IRFormatError(f"{name} must be an integer, got {value!r}")
    maximum = (1 << width) - 1
    if not 0 <= value <= maximum:
        raise IRFormatError(f"{name} must be 0..{maximum} ({width} bits)")


def encode_sony_sirc(
    *,
    command: int,
    device: int,
    carrier_frequency: int = CARRIER_HZ,
    repeats: int = DEFAULT_REPEATS,
    frame_period_us: int = FRAME_PERIOD_US,
    bits: int = 12,
    extended: int = 0,
) -> IRSignal:
    """Create one complete SIRC transmission, including required repeats."""
    device_width = _DEVICE_BITS.get(bits)
    if device_width is None:
        supported = "/".join(str(value) for value in sorted(_DEVICE_BITS))
        raise IRFormatError(f"Sony SIRC supports {supported} bits, not {bits}")
    if repeats < 1 or repeats > MAX_REPEATS:
        raise IRFormatError(f"repeat count must fall between 1 and {MAX_REPEATS}")
    _require_unsigned("command", command, 7)
    _require_unsigned("device", device, device_width)
    if bits == 20:
        _require_unsigned("extended", extended, _EXTENDED_BITS)

    address_bits = bits - 7
    address = device | (extended << device_width if bits == 20 else 0)
    try:
        upstream = SonyCommand(
            address=address,
            address_bits=address_bits,
            command=command,
            modulation=carrier_frequency,
        )
    except ValueError as error:
        raise IRFormatError(str(error)) from error
    frame = [abs(value) for value in upstream.get_raw_timings()]
    if frame_period_us != FRAME_PERIOD_US:
        frame[-1] = max(frame_period_us - sum(frame[:-1]), UNIT_US)
    return IRSignal(frame * repeats, carrier_frequency)
