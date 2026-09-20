"""Codec for the FastLZ-wrapped timing payload used by Zosung emitters."""

import base64
import binascii
import struct

from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal

_LITERAL_LIMIT = 32
_TIMING_LIMIT = (1 << 16) - 1


def _decompress(data: bytes) -> bytes:
    """Decode the level-one FastLZ subset emitted by Zosung devices."""
    output = bytearray()
    cursor = 0
    while cursor < len(data):
        control = data[cursor]
        cursor += 1
        match_length = control >> 5
        distance_high = control & 0x1F
        if match_length == 0:
            literal_length = distance_high + 1
            end = cursor + literal_length
            if end > len(data):
                raise IRFormatError("truncated literal run in Zosung payload")
            output.extend(data[cursor:end])
            cursor = end
            continue

        if match_length == 7:
            if cursor >= len(data):
                raise IRFormatError("truncated match length in Zosung payload")
            match_length += data[cursor]
            cursor += 1
        if cursor >= len(data):
            raise IRFormatError("truncated match distance in Zosung payload")

        distance = ((distance_high << 8) | data[cursor]) + 1
        cursor += 1
        source = len(output) - distance
        if source < 0:
            raise IRFormatError("invalid back-reference in Zosung payload")
        for offset in range(match_length + 2):
            output.append(output[source + offset])
    return bytes(output)


def _compress(data: bytes) -> bytes:
    """Encode bytes as valid literal FastLZ blocks."""
    encoded = bytearray()
    for start in range(0, len(data), _LITERAL_LIMIT):
        block = data[start : start + _LITERAL_LIMIT]
        encoded.append(len(block) - 1)
        encoded.extend(block)
    return bytes(encoded)


def decode(code: str, carrier_frequency: int = DEFAULT_CARRIER_HZ) -> IRSignal:
    """Decode a base64 Zosung transport payload into a signal."""
    try:
        compressed = base64.b64decode(code, validate=True)
    except (ValueError, binascii.Error) as error:
        raise IRFormatError("code is not valid base64") from error
    payload = _decompress(compressed)
    if len(payload) % 2:
        raise IRFormatError("decoded Zosung payload has an odd byte length")
    return IRSignal(
        [value for (value,) in struct.iter_unpack("<H", payload)],
        carrier_frequency,
    )


def encode(signal: IRSignal) -> str:
    """Encode a signal into the Zosung base64 transport representation."""
    overflow = next((value for value in signal.timings if value > _TIMING_LIMIT), None)
    if overflow is not None:
        raise IRFormatError(
            f"timing {overflow} µs does not fit in the 16-bit Zosung payload "
            f"(max {_TIMING_LIMIT})"
        )
    payload = struct.pack(f"<{len(signal.timings)}H", *signal.timings)
    return base64.b64encode(_compress(payload)).decode("ascii")
