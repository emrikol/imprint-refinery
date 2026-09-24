"""Broadlink timing packet encoding for compatible infrared emitters."""

import base64

from .model import IRFormatError, IRSignal

_TICK_NUMERATOR = 269
_TICK_DENOMINATOR = 8192
_MAX_TICKS = (1 << 16) - 1


def encode(signal: IRSignal) -> str:
    """Encode microsecond timings as a padded Broadlink IR packet."""
    timings = bytearray()
    for duration in signal.timings:
        ticks = max(
            1,
            (duration * _TICK_NUMERATOR + _TICK_DENOMINATOR // 2) // _TICK_DENOMINATOR,
        )
        if ticks > _MAX_TICKS:
            raise IRFormatError(
                f"timing {duration} µs does not fit in a Broadlink packet"
            )
        if ticks < 0x100:
            timings.append(ticks)
        else:
            timings.extend((0, ticks >> 8, ticks & 0xFF))

    if len(timings) > _MAX_TICKS:
        raise IRFormatError("Broadlink timing data exceeds 65535 bytes")

    packet = bytearray(
        (
            0x26,
            0,
            len(timings) & 0xFF,
            len(timings) >> 8,
        )
    )
    packet.extend(timings)
    packet.extend((0x0D, 0x05))
    while (len(packet) + 4) % 16:
        packet.append(0)
    return base64.b64encode(packet).decode("ascii")
