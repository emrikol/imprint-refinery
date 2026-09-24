"""Canonical encoders for the protocols Imprint can rebuild."""

from typing import Any

from infrared_protocols.commands.rc5 import RC5Command
from infrared_protocols.commands.sony import SonyCommand

from ..model import DEFAULT_CARRIER_HZ, IRSignal

KNOWN_PROTOCOLS = (
    "NEC",
    "NECext",
    "NEC42",
    "NEC42ext",
    "Samsung32",
    "SIRC",
    "SIRC15",
    "SIRC20",
    "RC5",
    "RC5X",
    "RC6",
    "Kaseikyo",
    "RCA",
)

_FRAME_GAP_US = 10_000


def encode_known_protocol(
    protocol: str,
    address: int,
    command: int,
    *,
    toggle: int = 0,
) -> IRSignal:
    """Encode one protocol-defined frame from decoded fields."""
    if protocol == "NEC":
        _require_range(address, 8, "NEC address")
        _require_range(command, 8, "NEC command")
        data = address | ((~address & 0xFF) << 8)
        data |= command << 16 | ((~command & 0xFF) << 24)
        return _pulse_distance_signal(data, 32, 9000, 4500, 560, 560, 1690)
    if protocol == "NECext":
        _require_range(address, 16, "NECext address")
        _require_range(command, 16, "NECext command")
        data = address | (command << 16)
        return _pulse_distance_signal(data, 32, 9000, 4500, 560, 560, 1690)
    if protocol == "NEC42":
        _require_range(address, 13, "NEC42 address")
        _require_range(command, 8, "NEC42 command")
        data = address | ((~address & 0x1FFF) << 13)
        data |= command << 26 | ((~command & 0xFF) << 34)
        return _pulse_distance_signal(data, 42, 9000, 4500, 560, 560, 1690)
    if protocol == "NEC42ext":
        _require_range(address, 26, "NEC42ext address")
        _require_range(command, 16, "NEC42ext command")
        data = address | (command << 26)
        return _pulse_distance_signal(data, 42, 9000, 4500, 560, 560, 1690)
    if protocol == "Samsung32":
        _require_range(address, 8, "Samsung32 address")
        _require_range(command, 8, "Samsung32 command")
        data = address | (address << 8)
        data |= command << 16 | ((~command & 0xFF) << 24)
        return _pulse_distance_signal(data, 32, 4500, 4500, 550, 550, 1650)
    if protocol in {"SIRC", "SIRC15", "SIRC20"}:
        address_bits = {"SIRC": 5, "SIRC15": 8, "SIRC20": 13}[protocol]
        return _signal_from_upstream(
            SonyCommand(
                address=address,
                address_bits=address_bits,
                command=command,
            )
        )
    if protocol in {"RC5", "RC5X"}:
        _require_range(address, 5, "RC5 address")
        _require_range(command, 7 if protocol == "RC5X" else 6, "RC5 command")
        _require_range(toggle, 1, "RC5 toggle")
        return _signal_from_upstream(
            RC5Command(
                address=address,
                command=command | (0x40 if protocol == "RC5X" else 0),
                toggle=toggle,
            )
        )
    if protocol == "RC6":
        return _encode_rc6(address, command, toggle=toggle)
    if protocol == "Kaseikyo":
        return _encode_kaseikyo(address, command)
    if protocol == "RCA":
        _require_range(address, 4, "RCA address")
        _require_range(command, 8, "RCA command")
        data = address | (command << 4)
        data |= ((~address & 0xF) << 12) | ((~command & 0xFF) << 16)
        return _pulse_distance_signal(data, 24, 4000, 4000, 500, 1000, 2000)
    raise ValueError(f"unsupported known protocol {protocol!r}")


def rebuild_known_protocol(
    candidate: dict[str, Any],
    source_timings: list[int],
) -> IRSignal:
    """Rebuild a decoded capture while retaining its recognized repeat shape."""
    protocol = str(candidate["protocol"])
    base = encode_known_protocol(
        protocol,
        int(candidate["address"]),
        int(candidate["command"]),
        toggle=int(candidate.get("toggle", 0)),
    )
    if candidate.get("residual_timing_ranges"):
        raise ValueError("unclassified timings cannot be discarded")

    roles = candidate.get("frame_roles")
    if not isinstance(roles, list):
        roles = []
    rebuilt: list[int] = []
    for role in roles:
        if not isinstance(role, dict) or role.get("role") == "unclassified":
            raise ValueError("frame structure is incomplete")
        if role.get("kind") == "abbreviated":
            if not protocol.startswith("NEC"):
                raise ValueError("abbreviated repeat is not defined for this protocol")
            frame = [9000, 2250, 560]
        else:
            frame = list(base.timings)
        trailing_gap = role.get("trailing_gap_us")
        if (
            isinstance(trailing_gap, int)
            and trailing_gap > 0
            and not (len(frame) % 2 == 0 and frame[-1] >= _FRAME_GAP_US)
        ):
            frame.append(trailing_gap)
        rebuilt.extend(frame)

    minimum_frames = max(1, int(candidate.get("minimum_frame_count", 1)))
    if not rebuilt:
        rebuilt.extend(base.timings)
    represented_frames = max(1, len(roles))
    for _ in range(represented_frames, minimum_frames):
        if len(base.timings) % 2:
            raise ValueError("required repeats need a defined interframe gap")
        rebuilt.extend(base.timings)

    return IRSignal(rebuilt, base.carrier_frequency)


def _pulse_distance_signal(
    data: int,
    bits: int,
    leader_mark: int,
    leader_space: int,
    bit_mark: int,
    zero_space: int,
    one_space: int,
) -> IRSignal:
    timings = [leader_mark, leader_space]
    for index in range(bits):
        timings.extend([bit_mark, one_space if data & (1 << index) else zero_space])
    timings.append(bit_mark)
    return IRSignal(timings=timings, carrier_frequency=DEFAULT_CARRIER_HZ)


def _signal_from_upstream(command: Any) -> IRSignal:
    """Convert one upstream protocol command into Imprint's lossless model."""
    return IRSignal(
        timings=[abs(value) for value in command.get_raw_timings()],
        carrier_frequency=command.modulation,
    )


def _encode_rc6(address: int, command: int, *, toggle: int) -> IRSignal:
    _require_range(address, 8, "RC6 address")
    _require_range(command, 8, "RC6 command")
    _require_range(toggle, 1, "RC6 toggle")
    signed = [2664, -888]
    for bit, half_bit in [
        (1, 444),
        (0, 444),
        (0, 444),
        (0, 444),
        (toggle, 888),
    ]:
        _append_signed(signed, half_bit if bit else -half_bit)
        _append_signed(signed, -half_bit if bit else half_bit)
    for value in (address, command):
        for index in range(7, -1, -1):
            bit = (value >> index) & 1
            _append_signed(signed, 444 if bit else -444)
            _append_signed(signed, -444 if bit else 444)
    if signed[-1] < 0:
        signed.pop()
    return IRSignal(timings=[abs(value) for value in signed], carrier_frequency=36000)


def _encode_kaseikyo(address: int, command: int) -> IRSignal:
    _require_range(address, 26, "Kaseikyo address")
    _require_range(command, 10, "Kaseikyo command")
    device_id = (address >> 24) & 0x3
    vendor_id = (address >> 8) & 0xFFFF
    genre_1 = (address >> 4) & 0xF
    genre_2 = address & 0xF
    data = [vendor_id & 0xFF, vendor_id >> 8]
    vendor_parity = data[0] ^ data[1]
    vendor_parity = (vendor_parity & 0xF) ^ (vendor_parity >> 4)
    data.extend(
        [
            vendor_parity | (genre_1 << 4),
            genre_2 | ((command & 0xF) << 4),
            (device_id << 6) | (command >> 4),
        ]
    )
    data.append(data[2] ^ data[3] ^ data[4])
    payload = sum(byte << (8 * index) for index, byte in enumerate(data))
    return _pulse_distance_signal(payload, 48, 3456, 1728, 432, 432, 1296)


def _append_signed(timings: list[int], value: int) -> None:
    if timings and (timings[-1] > 0) == (value > 0):
        timings[-1] += value
    else:
        timings.append(value)


def _require_range(value: int, bits: int, label: str) -> None:
    if not 0 <= value < (1 << bits):
        raise ValueError(f"{label} must fit in {bits} bits")
