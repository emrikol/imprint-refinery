"""Broadlink timing packet encoding for compatible infrared emitters."""

import base64
import binascii

from .model import IRFormatError, IRSignal

_TICK_NUMERATOR = 269
_TICK_DENOMINATOR = 8192
_MAX_TICKS = (1 << 16) - 1


def decode(code: str, carrier_frequency: int = 38_000) -> IRSignal:
    """Decode a base64 Broadlink IR packet into canonical microsecond timings."""
    try:
        packet = base64.b64decode(code, validate=True)
    except (ValueError, binascii.Error) as error:
        raise IRFormatError("code is not valid base64") from error
    if len(packet) < 4 or packet[0] != 0x26:
        raise IRFormatError("code is not a Broadlink IR packet")

    payload_length = int.from_bytes(packet[2:4], "little")
    payload_end = 4 + payload_length
    payload = packet[4 : min(payload_end, len(packet))]
    if payload_end > len(packet):
        # ZG-IR01 firmware can include omitted transport padding in the length
        # field. Bound parsing to the complete outer transfer, matching the
        # reference Broadlink parser. Remove the optional packet terminator only
        # when that vendor-specific overcount is present.
        unpadded = payload.rstrip(b"\x00")
        if unpadded.endswith(b"\x0d\x05"):
            payload = unpadded[:-2]
    if not payload:
        raise IRFormatError("Broadlink packet contains no timing data")
    timings: list[int] = []
    cursor = 0
    while cursor < len(payload):
        ticks = payload[cursor]
        cursor += 1
        if ticks == 0:
            if cursor + 2 > len(payload):
                raise IRFormatError("Broadlink extended timing is truncated")
            ticks = int.from_bytes(payload[cursor : cursor + 2], "big")
            cursor += 2
        if ticks == 0:
            raise IRFormatError("Broadlink timings must be positive")
        timings.append(
            max(
                1,
                (ticks * _TICK_DENOMINATOR + _TICK_NUMERATOR // 2) // _TICK_NUMERATOR,
            )
        )
    return IRSignal(timings, carrier_frequency)


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
