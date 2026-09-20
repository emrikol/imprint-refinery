"""Common built-in IR recognition plus Home Assistant's optional adapters."""

from collections.abc import Callable
import copy
from dataclasses import dataclass
from enum import Enum
from functools import lru_cache
import hashlib
import importlib
from importlib import metadata
import json
from typing import Any

from .model import IRSignal
from .protocols.known import KNOWN_PROTOCOLS, rebuild_known_protocol

RECOGNIZER_VERSION = "common-protocols-4+home-assistant-infrared-protocols-3"

_ABSOLUTE_TOLERANCE_US = 150
_RELATIVE_TOLERANCE = 0.22
_FRAME_GAP_US = 10_000
_MAX_RECOGNITION_TIMINGS = 4096
_CACHE_SIZE = 128
_BUILTIN_PROTOCOLS = KNOWN_PROTOCOLS


@dataclass(frozen=True)
class DecoderSpec:
    """One decoder with an explicit disposition in the recognition corpus."""

    protocol: str
    module: str
    class_name: str
    decode: str = "default"
    stateful: bool = False


_DECODERS = (
    DecoderSpec("NEC", "nec", "NECCommand"),
    DecoderSpec("NEC1-f16", "nec", "NECCommand", decode="nec_subfunction"),
    DecoderSpec("LG AC", "lg_ac", "LgAcCommand", stateful=True),
    DecoderSpec("LG AC fixed", "lg_ac", "LgAcFixedCommand"),
    DecoderSpec(
        "General Electric AC", "general_electric", "GEACCommand", stateful=True
    ),
    DecoderSpec("Proton", "proton", "ProtonCommand"),
    DecoderSpec("Gree AC", "gree_ac", "GreeAcCommand", stateful=True),
    DecoderSpec("Fujitsu AC", "fujitsu_ac", "FujitsuAcCommand", stateful=True),
    DecoderSpec("Samsung AC 0292", "samsung_ac", "SamsungAC0292Command", stateful=True),
)


@lru_cache(maxsize=1)
def recognizer_status() -> dict[str, Any]:
    """Return the compact recognition implementation identity."""
    try:
        version = metadata.version("infrared-protocols")
    except metadata.PackageNotFoundError:
        version = None
    return {
        "recognizer": "Imprint Refinery + Home Assistant infrared-protocols",
        "recognizer_version": RECOGNIZER_VERSION,
        "library_version": version,
        "decoder_count": len(_BUILTIN_PROTOCOLS) + len(_DECODERS),
    }


def recognize_signal(
    signal: IRSignal,
    *,
    carrier_source: str = "assumed",
) -> dict[str, Any]:
    """Return every credible interpretation without exposing cached objects."""
    result = _recognize_cached(
        tuple(signal.timings),
        signal.carrier_frequency,
        carrier_source,
        _DECODERS,
    )
    public = copy.deepcopy(result)
    public.pop("_rebuild_signals", None)
    return public


def rebuild_recognized_signal(
    signal: IRSignal,
    rebuild_id: str,
    *,
    carrier_source: str = "assumed",
) -> tuple[IRSignal, dict[str, Any]]:
    """Return one explicitly selected canonical reconstruction."""
    result = _recognize_cached(
        tuple(signal.timings),
        signal.carrier_frequency,
        carrier_source,
        _DECODERS,
    )
    item = result.get("_rebuild_signals", {}).get(rebuild_id)
    if item is None:
        raise ValueError("the selected protocol reconstruction is unavailable")
    carrier, timings, descriptor = item
    return IRSignal(list(timings), carrier), copy.deepcopy(descriptor)


def clear_recognition_cache() -> None:
    """Clear cached signal results after a decoder environment change."""
    _recognize_cached.cache_clear()


@lru_cache(maxsize=_CACHE_SIZE)
def _recognize_cached(
    timings: tuple[int, ...],
    carrier_frequency: int,
    carrier_source: str,
    decoders: tuple[DecoderSpec, ...],
) -> dict[str, Any]:
    signal = IRSignal(list(timings), carrier_frequency)
    status = recognizer_status()
    if len(timings) > _MAX_RECOGNITION_TIMINGS:
        return {
            **status,
            "confidence": "unknown",
            "evidence_class": "unknown",
            "protocol_candidates": [],
            "protocol_rebuilds": [],
            "_rebuild_signals": {},
            "recognition_skipped": "timing_limit_exceeded",
            "limits": {"maximum_timings": _MAX_RECOGNITION_TIMINGS},
        }

    signed_timings = [
        duration if index % 2 == 0 else -duration
        for index, duration in enumerate(timings)
    ]
    candidates = _builtin_candidates(signal, carrier_source)
    frame_windows = _decoder_windows(list(timings), signed_timings)
    for spec in decoders:
        try:
            decoder = _decoder_callable(spec)
        except ImportError, AttributeError:
            continue
        for window in frame_windows:
            try:
                command = decoder(window["signed_timings"])
            except Exception:  # noqa: BLE001 - isolate third-party decoders
                continue
            if command is None:
                continue
            candidate = _candidate(
                spec,
                command,
                signal,
                carrier_source,
                consumed_ranges=window["ranges"],
                decoder_scope=window["scope"],
            )
            _append_candidate(candidates, candidate)

    for candidate in candidates:
        _finalize_candidate(candidate, list(timings), carrier_source)

    candidates.sort(key=_candidate_rank)
    rebuilds, rebuild_signals = _prepare_protocol_rebuilds(candidates, signal)
    confidence = "unknown"
    evidence_class = "unknown"
    if len(candidates) == 1:
        confidence = candidates[0]["confidence"]
        evidence_class = candidates[0]["evidence_class"]
    elif candidates:
        confidence = "ambiguous"
        evidence_class = "ambiguous"
    return {
        **status,
        "confidence": confidence,
        "evidence_class": evidence_class,
        "protocol_candidates": candidates,
        "protocol_rebuilds": rebuilds,
        "_rebuild_signals": rebuild_signals,
        "limits": {"maximum_timings": _MAX_RECOGNITION_TIMINGS},
    }


def _decoder_windows(
    timings: list[int], signed_timings: list[int]
) -> list[dict[str, Any]]:
    """Return the whole capture and de-duplicated likely-frame windows."""
    windows: list[dict[str, Any]] = [
        {
            "scope": "capture",
            "ranges": [[0, len(timings)]],
            "signed_timings": signed_timings,
        }
    ]
    by_shape: dict[tuple[int, ...], dict[str, Any]] = {
        tuple(signed_timings): windows[0]
    }
    for start, _body_end, end in _timing_frames(timings):
        frame = [
            duration if index % 2 == 0 else -duration
            for index, duration in enumerate(timings[start:end])
        ]
        identity = tuple(frame)
        if not frame:
            continue
        existing = by_shape.get(identity)
        if existing is not None:
            if existing["scope"] == "frame":
                existing["ranges"].append([start, end])
            continue
        window = {
            "scope": "frame",
            "ranges": [[start, end]],
            "signed_timings": frame,
        }
        by_shape[identity] = window
        windows.append(window)
    return windows


def _builtin_candidates(
    signal: IRSignal,
    carrier_source: str,
) -> list[dict[str, Any]]:
    """Decode the compact protocol set supported by parsed Flipper imports."""
    candidates: list[dict[str, Any]] = []
    timings = signal.timings

    nec32 = _decode_pulse_distance(timings, 32, 9000, 4500, 560, 560, 1690)
    if nec32 is not None:
        repeat_evidence = _nec_repeat_evidence(
            timings,
            value=nec32,
            bits=32,
            leader_mark=9000,
            leader_space=4500,
            bit_mark=560,
            zero_space=560,
            one_space=1690,
        )
        octets = _little_endian_bytes(nec32, 4)
        if octets[1] == (~octets[0] & 0xFF) and octets[3] == (~octets[2] & 0xFF):
            _append_builtin(
                candidates,
                "NEC",
                octets[0],
                octets[2],
                32,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    nec32,
                    32,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=560,
                    one_us=1690,
                ),
                **repeat_evidence,
            )
        else:
            _append_builtin(
                candidates,
                "NECext",
                nec32 & 0xFFFF,
                nec32 >> 16,
                32,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    nec32,
                    32,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=560,
                    one_us=1690,
                ),
                **repeat_evidence,
            )

    nec42 = _decode_pulse_distance(timings, 42, 9000, 4500, 560, 560, 1690)
    if nec42 is not None:
        repeat_evidence = _nec_repeat_evidence(
            timings,
            value=nec42,
            bits=42,
            leader_mark=9000,
            leader_space=4500,
            bit_mark=560,
            zero_space=560,
            one_space=1690,
        )
        address = nec42 & 0x1FFF
        address_inverse = (nec42 >> 13) & 0x1FFF
        command = (nec42 >> 26) & 0xFF
        command_inverse = (nec42 >> 34) & 0xFF
        if address_inverse == (~address & 0x1FFF) and command_inverse == (
            ~command & 0xFF
        ):
            _append_builtin(
                candidates,
                "NEC42",
                address,
                command,
                42,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    nec42,
                    42,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=560,
                    one_us=1690,
                ),
                **repeat_evidence,
            )
        else:
            _append_builtin(
                candidates,
                "NEC42ext",
                nec42 & 0x3FFFFFF,
                nec42 >> 26,
                42,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    nec42,
                    42,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=560,
                    one_us=1690,
                ),
                **repeat_evidence,
            )

    samsung = _decode_pulse_distance(timings, 32, 4500, 4500, 550, 550, 1650)
    if samsung is not None:
        octets = _little_endian_bytes(samsung, 4)
        if octets[1] == octets[0] and octets[3] == (~octets[2] & 0xFF):
            _append_builtin(
                candidates,
                "Samsung32",
                octets[0],
                octets[2],
                32,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    samsung,
                    32,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=550,
                    one_us=1650,
                ),
                **_full_frame_repeat_evidence(timings),
            )

    rca = _decode_pulse_distance(timings, 24, 4000, 4000, 500, 1000, 2000)
    if rca is not None:
        address = rca & 0xF
        command = (rca >> 4) & 0xFF
        if (rca >> 12) & 0xF == (~address & 0xF) and rca >> 16 == (~command & 0xFF):
            _append_builtin(
                candidates,
                "RCA",
                address,
                command,
                24,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    rca,
                    24,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=1000,
                    one_us=2000,
                ),
                **_full_frame_repeat_evidence(timings),
            )

    kaseikyo = _decode_pulse_distance(timings, 48, 3456, 1728, 432, 432, 1296)
    if kaseikyo is not None:
        octets = _little_endian_bytes(kaseikyo, 6)
        vendor_parity = octets[0] ^ octets[1]
        vendor_parity = (vendor_parity & 0xF) ^ (vendor_parity >> 4)
        if (
            octets[2] & 0xF == vendor_parity
            and octets[5] == octets[2] ^ octets[3] ^ octets[4]
        ):
            vendor = octets[0] | (octets[1] << 8)
            address = (
                ((octets[4] >> 6) << 24)
                | (vendor << 8)
                | ((octets[2] >> 4) << 4)
                | (octets[3] & 0xF)
            )
            command = ((octets[4] & 0x3F) << 4) | (octets[3] >> 4)
            _append_builtin(
                candidates,
                "Kaseikyo",
                address,
                command,
                48,
                38_000,
                signal,
                carrier_source,
                binary_payload=_binary_payload_from_value(
                    kaseikyo,
                    48,
                    encoding="pulse_distance",
                    symbol="space_length",
                    zero_us=432,
                    one_us=1296,
                ),
                **_full_frame_repeat_evidence(timings),
            )

    sirc = _decode_sirc(timings)
    if sirc is not None:
        protocol, address, command, bits, value = sirc
        _append_builtin(
            candidates,
            protocol,
            address,
            command,
            bits,
            40_000,
            signal,
            carrier_source,
            binary_payload=_binary_payload_from_value(
                value,
                bits,
                encoding="pulse_width",
                symbol="mark_length",
                zero_us=600,
                one_us=1200,
            ),
            **_sirc_repeat_evidence(timings, protocol, address, command, bits),
        )

    first_frame = _first_frame_body(timings)
    rc5 = _decode_rc5(first_frame)
    if rc5 is not None:
        protocol, address, command, toggle = rc5
        _append_builtin(
            candidates,
            protocol,
            address,
            command,
            14,
            36_000,
            signal,
            carrier_source,
            toggle=toggle,
            **_full_frame_repeat_evidence(timings),
        )

    rc6 = _decode_rc6(first_frame)
    if rc6 is not None:
        address, command, toggle = rc6
        _append_builtin(
            candidates,
            "RC6",
            address,
            command,
            20,
            36_000,
            signal,
            carrier_source,
            toggle=toggle,
            **_full_frame_repeat_evidence(timings),
        )
    return candidates


def _decode_pulse_distance(
    timings: list[int],
    bits: int,
    leader_mark: int,
    leader_space: int,
    bit_mark: int,
    zero_space: int,
    one_space: int,
) -> int | None:
    expected_count = 3 + bits * 2
    frame = timings[:expected_count]
    if len(frame) != expected_count:
        return None
    if not _matches(frame[0], leader_mark) or not _matches(frame[1], leader_space):
        return None
    value = 0
    for index in range(bits):
        mark = frame[2 + index * 2]
        space = frame[3 + index * 2]
        if not _matches(mark, bit_mark):
            return None
        bit = _binary_duration(space, zero_space, one_space)
        if bit is None:
            return None
        value |= bit << index
    if not _matches(frame[-1], bit_mark):
        return None
    if len(timings) > expected_count and timings[expected_count] < 3_000:
        return None
    return value


def _nec_repeat_evidence(
    timings: list[int],
    *,
    value: int,
    bits: int,
    leader_mark: int,
    leader_space: int,
    bit_mark: int,
    zero_space: int,
    one_space: int,
) -> dict[str, Any]:
    """Describe NEC short and full repeats without rewriting the capture."""
    frames = _timing_frames(timings)
    roles: list[dict[str, Any]] = []
    repeat_kinds: list[str] = []
    consumed: list[list[int]] = []
    residual: list[list[int]] = []
    for index, (start, body_end, end) in enumerate(frames):
        frame = timings[start:end]
        body = timings[start:body_end]
        decoded = _decode_pulse_distance(
            frame,
            bits,
            leader_mark,
            leader_space,
            bit_mark,
            zero_space,
            one_space,
        )
        kind: str | None = None
        if decoded == value:
            role = "intro" if index == 0 else "repeat"
            kind = "full"
        elif index > 0 and _is_nec_abbreviated_repeat(body, leader_mark, bit_mark):
            role = "repeat"
            kind = "abbreviated"
        else:
            role = "unclassified"

        item = _frame_role(index, start, body_end, end, timings, role)
        if kind is not None:
            item["kind"] = kind
            consumed.append([start, end])
            if index > 0:
                repeat_kinds.append(kind)
        else:
            residual.append([start, end])
        roles.append(item)

    repeat_style = "none"
    if repeat_kinds:
        kinds = set(repeat_kinds)
        repeat_style = next(iter(kinds)) if len(kinds) == 1 else "mixed"
    evidence: dict[str, Any] = {
        "frame_roles": roles,
        "captured_frame_count": len(frames),
        "repeat_count": len(repeat_kinds),
        "required_repeats": 0,
        "minimum_frame_count": 1,
        "repeat_style": repeat_style,
        "consumed_timing_ranges": consumed,
        "residual_timing_ranges": residual,
        "frame_structure_complete": not residual,
    }
    if "abbreviated" in repeat_kinds and len(set(repeat_kinds)) == 1:
        evidence["hold_likely"] = True
        evidence["hold_ambiguity"] = "abbreviated_repeats_indicate_hold"
    elif "full" in repeat_kinds and len(set(repeat_kinds)) == 1:
        evidence["hold_likely"] = None
        evidence["hold_ambiguity"] = (
            "full_frame_repeats_may_be_nec2_hold_or_repeated_presses"
        )
    elif repeat_kinds:
        evidence["hold_likely"] = None
        evidence["hold_ambiguity"] = "mixed_repeat_frames_require_review"
    return evidence


def _is_nec_abbreviated_repeat(
    timings: list[int],
    leader_mark: int,
    bit_mark: int,
) -> bool:
    return (
        len(timings) == 3
        and _matches(timings[0], leader_mark)
        and _matches(timings[1], 2250)
        and _matches(timings[2], bit_mark)
    )


def _sirc_repeat_evidence(
    timings: list[int],
    protocol: str,
    address: int,
    command: int,
    bits: int,
) -> dict[str, Any]:
    """Report Sony's required full-frame repetition and possible long holds."""
    return _full_frame_repeat_evidence(
        timings,
        required_repeats=2,
        matches=lambda start, _body_end, end: (
            (decoded := _decode_sirc(timings[start:end])) is not None
            and decoded[:4] == (protocol, address, command, bits)
        ),
    )


def _full_frame_repeat_evidence(
    timings: list[int],
    *,
    matches: Callable[[int, int, int], bool] | None = None,
    required_repeats: int = 0,
) -> dict[str, Any]:
    """Describe protocol-matching full frames and their repeat evidence."""
    frames = _timing_frames(timings)
    if matches is None:
        first_start, first_body_end, _ = frames[0]
        first_body = timings[first_start:first_body_end]

        def matches(start: int, body_end: int, _end: int) -> bool:
            return _timings_match(first_body, timings[start:body_end])

    roles: list[dict[str, Any]] = []
    consumed: list[list[int]] = []
    residual: list[list[int]] = []
    repeat_count = 0
    for index, (start, body_end, end) in enumerate(frames):
        matched = matches(start, body_end, end)
        role = (
            "intro"
            if matched and index == 0
            else "repeat"
            if matched
            else "unclassified"
        )
        (consumed if matched else residual).append([start, end])
        repeat_count += int(matched and index > 0)
        item = _frame_role(index, start, body_end, end, timings, role)
        if matched:
            item["kind"] = "full"
        roles.append(item)

    minimum_frames = required_repeats + 1
    repeat_requirement_met = 1 + repeat_count >= minimum_frames
    evidence: dict[str, Any] = {
        "frame_roles": roles,
        "captured_frame_count": len(frames),
        "repeat_count": repeat_count,
        "required_repeats": required_repeats,
        "minimum_frame_count": minimum_frames,
        "repeat_style": "full" if repeat_count else "none",
        "consumed_timing_ranges": consumed,
        "residual_timing_ranges": residual,
        "frame_structure_complete": not residual and repeat_requirement_met,
    }
    if required_repeats:
        evidence["repeat_requirement_met"] = repeat_requirement_met
    if repeat_count > required_repeats:
        evidence["hold_likely"] = None
        evidence["hold_ambiguity"] = (
            "extra_full_frames_may_be_hold_or_capture_overshoot"
            if required_repeats
            else "full_frame_repeats_may_be_hold_or_repeated_presses"
        )
    return evidence


def _timing_frames(timings: list[int]) -> list[tuple[int, int, int]]:
    """Return ``(start, body_end, end)`` slices split at long spaces."""
    frames: list[tuple[int, int, int]] = []
    start = 0
    for index in range(1, len(timings), 2):
        if timings[index] < _FRAME_GAP_US or index + 1 >= len(timings):
            continue
        frames.append((start, index, index + 1))
        start = index + 1
    if start < len(timings):
        end = len(timings)
        body_end = (
            end - 1 if (end - start) % 2 == 0 and timings[-1] >= _FRAME_GAP_US else end
        )
        frames.append((start, body_end, end))
    return frames or [(0, len(timings), len(timings))]


def _first_frame_body(timings: list[int]) -> list[int]:
    start, body_end, _ = _timing_frames(timings)[0]
    return timings[start:body_end]


def _frame_role(
    index: int,
    start: int,
    body_end: int,
    end: int,
    timings: list[int],
    role: str,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "index": index,
        "role": role,
        "start_timing": start,
        "end_timing": end,
        "body_end_timing": body_end,
    }
    if body_end < end:
        item["trailing_gap_us"] = timings[body_end]
    return item


def _timings_match(left: list[int], right: list[int]) -> bool:
    return len(left) == len(right) and all(
        _matches(left_value, right_value)
        for left_value, right_value in zip(left, right, strict=True)
    )


def _decode_sirc(timings: list[int]) -> tuple[str, int, int, int, int] | None:
    for protocol, bits, address_bits in (
        ("SIRC", 12, 5),
        ("SIRC15", 15, 8),
        ("SIRC20", 20, 13),
    ):
        count = 2 + bits * 2
        frame = timings[:count]
        if len(frame) != count or not _matches(frame[0], 2400):
            continue
        if not all(_matches(frame[index], 600) for index in range(1, count - 1, 2)):
            continue
        if frame[-1] < 3_000:
            continue
        value = 0
        valid = True
        for index, mark in enumerate(frame[2:-1:2]):
            bit = _binary_duration(mark, 600, 1200)
            if bit is None:
                valid = False
                break
            value |= bit << index
        if valid:
            command = value & 0x7F
            address = (value >> 7) & ((1 << address_bits) - 1)
            return protocol, address, command, bits, value
    return None


def _decode_rc5(timings: list[int]) -> tuple[str, int, int, int] | None:
    levels = _expand_biphase(timings, 889)
    if levels is None:
        return None
    # RC5 starts with a space half-bit which a mark-first timing list omits.
    levels.insert(0, 0)
    if len(levels) == 27:
        levels.append(0)
    if len(levels) != 28:
        return None
    bits = _decode_pairs(levels, one=(0, 1))
    if bits is None or bits[0] != 1:
        return None
    start_2, toggle = bits[1], bits[2]
    address = _msb_value(bits[3:8])
    low_command = _msb_value(bits[8:14])
    if start_2:
        return "RC5", address, low_command, toggle
    return "RC5X", address, low_command | 0x40, toggle


def _decode_rc6(timings: list[int]) -> tuple[int, int, int] | None:
    if (
        len(timings) < 3
        or not _matches(timings[0], 2664)
        or not _matches(timings[1], 888)
    ):
        return None
    levels = _expand_biphase(timings[2:], 444, start_index=2)
    if levels is None or len(levels) != 44:
        return None
    mode_bits = _decode_pairs(levels[:8], one=(1, 0))
    if mode_bits != [1, 0, 0, 0]:
        return None
    toggle_levels = levels[8:12]
    if toggle_levels == [1, 1, 0, 0]:
        toggle = 1
    elif toggle_levels == [0, 0, 1, 1]:
        toggle = 0
    else:
        return None
    data = _decode_pairs(levels[12:], one=(1, 0))
    if data is None or len(data) != 16:
        return None
    return _msb_value(data[:8]), _msb_value(data[8:]), toggle


def _expand_biphase(
    timings: list[int],
    unit: int,
    *,
    start_index: int = 0,
) -> list[int] | None:
    levels: list[int] = []
    for index, duration in enumerate(timings, start=start_index):
        units = round(duration / unit)
        if units < 1 or units > 4 or not _matches(duration, units * unit):
            return None
        levels.extend([1 if index % 2 == 0 else 0] * units)
    return levels


def _decode_pairs(levels: list[int], *, one: tuple[int, int]) -> list[int] | None:
    zero = (one[1], one[0])
    bits: list[int] = []
    for index in range(0, len(levels), 2):
        pair = tuple(levels[index : index + 2])
        if pair == one:
            bits.append(1)
        elif pair == zero:
            bits.append(0)
        else:
            return None
    return bits


def _append_builtin(
    candidates: list[dict[str, Any]],
    protocol: str,
    address: int,
    command: int,
    bits: int,
    expected_carrier: int,
    signal: IRSignal,
    carrier_source: str,
    **fields: Any,
) -> None:
    mismatch = _carrier_mismatch(signal, expected_carrier, carrier_source)
    incomplete_structure = bool(fields.get("residual_timing_ranges")) or (
        fields.get("repeat_requirement_met") is False
    )
    _append_candidate(
        candidates,
        {
            "protocol": protocol,
            "confidence": (
                "medium"
                if mismatch or carrier_source != "provided" or incomplete_structure
                else "high"
            ),
            "carrier_frequency": expected_carrier,
            "carrier_evidence": carrier_source,
            "carrier_mismatch": mismatch,
            "stateful": False,
            "address": address,
            "command": command,
            "bits": bits,
            "recognizer_sources": ["builtin_adapter"],
            "decoder_evidence": [
                {
                    "source": "builtin_adapter",
                    "adapter_version": RECOGNIZER_VERSION,
                    "invariants": _builtin_invariants(protocol),
                }
            ],
            **fields,
        },
    )


def _builtin_invariants(protocol: str) -> list[str]:
    invariants = {
        "NEC": ["leader", "bit_timings", "address_complement", "command_complement"],
        "NECext": ["leader", "bit_timings"],
        "NEC42": ["leader", "bit_timings", "address_complement", "command_complement"],
        "NEC42ext": ["leader", "bit_timings"],
        "Samsung32": ["leader", "bit_timings", "address_repeat", "command_complement"],
        "RCA": ["leader", "bit_timings", "address_complement", "command_complement"],
        "Kaseikyo": ["leader", "bit_timings", "vendor_parity", "checksum"],
        "SIRC": ["leader", "bit_timings", "frame_width"],
        "SIRC15": ["leader", "bit_timings", "frame_width"],
        "SIRC20": ["leader", "bit_timings", "frame_width"],
        "RC5": ["biphase_timings", "start_bits", "frame_width"],
        "RC5X": ["biphase_timings", "start_bits", "frame_width"],
        "RC6": ["leader", "biphase_timings", "mode", "toggle_width"],
    }
    return invariants.get(protocol, ["timing_shape"])


def _append_candidate(
    candidates: list[dict[str, Any]],
    candidate: dict[str, Any],
) -> None:
    identity = _candidate_identity(candidate)
    existing = next(
        (item for item in candidates if _candidate_identity(item) == identity),
        None,
    )
    if existing is None:
        candidates.append(candidate)
        return

    for source in candidate.get("recognizer_sources", []):
        if source not in existing.setdefault("recognizer_sources", []):
            existing["recognizer_sources"].append(source)
    for evidence in candidate.get("decoder_evidence", []):
        if evidence not in existing.setdefault("decoder_evidence", []):
            existing["decoder_evidence"].append(evidence)
    for timing_range in candidate.get("_decoded_ranges", []):
        if timing_range not in existing.setdefault("_decoded_ranges", []):
            existing["_decoded_ranges"].append(timing_range)
    existing["_capture_decoded"] = bool(
        existing.get("_capture_decoded") or candidate.get("_capture_decoded")
    )
    existing["_frame_decoded"] = bool(
        existing.get("_frame_decoded") or candidate.get("_frame_decoded")
    )
    if "_canonical_signal" not in existing and "_canonical_signal" in candidate:
        existing["_canonical_signal"] = candidate["_canonical_signal"]


_IDENTITY_FIELDS = (
    "address",
    "command",
    "data",
    "device",
    "function",
    "subdevice",
    "subfunction",
    "toggle",
    "bits",
)


def _candidate_identity(candidate: dict[str, Any]) -> tuple[str, str]:
    fields = {
        name: candidate[name]
        for name in _IDENTITY_FIELDS
        if name in candidate and name != "bits"
    }
    if not fields and "bits" in candidate:
        fields["bits"] = candidate["bits"]
    if not fields:
        fields = {
            name: value
            for name, value in candidate.items()
            if name
            not in {
                "aliases",
                "carrier_evidence",
                "carrier_frequency",
                "carrier_mismatch",
                "confidence",
                "decoder_evidence",
                "evidence",
                "evidence_class",
                "frame_roles",
                "recognizer_sources",
                "stateful",
                "warnings",
            }
            and not name.startswith("_")
        }
    return candidate["protocol"], json.dumps(fields, sort_keys=True, default=str)


def _carrier_mismatch(
    signal: IRSignal,
    expected_carrier: int,
    carrier_source: str,
) -> bool:
    return carrier_source == "provided" and abs(
        expected_carrier - signal.carrier_frequency
    ) > max(2_000, int(expected_carrier * 0.15))


def _matches(actual: int, expected: int) -> bool:
    return abs(actual - expected) <= max(
        _ABSOLUTE_TOLERANCE_US,
        int(expected * _RELATIVE_TOLERANCE),
    )


def _binary_duration(actual: int, zero: int, one: int) -> int | None:
    matches = [
        bit for bit, expected in enumerate((zero, one)) if _matches(actual, expected)
    ]
    if not matches:
        return None
    return min(matches, key=lambda bit: abs(actual - (zero, one)[bit]))


def _binary_payload_from_value(
    value: int,
    bit_count: int,
    *,
    encoding: str,
    symbol: str,
    zero_us: int,
    one_us: int,
) -> dict[str, Any]:
    """Describe the decoded symbols in the order they crossed the receiver."""
    bits = "".join(str((value >> index) & 1) for index in range(bit_count))
    return {
        "value": bits,
        "bit_count": bit_count,
        "display_order": "transmission",
        "bit_order": "lsb_first",
        "encoding": encoding,
        "symbol": symbol,
        "zero_us": zero_us,
        "one_us": one_us,
        "evidence": "recognized_protocol",
    }


def _little_endian_bytes(value: int, count: int) -> list[int]:
    return [(value >> (index * 8)) & 0xFF for index in range(count)]


def _msb_value(bits: list[int]) -> int:
    value = 0
    for bit in bits:
        value = (value << 1) | bit
    return value


def _decoder_class(spec: DecoderSpec) -> type[Any]:
    module = importlib.import_module(f"infrared_protocols.commands.{spec.module}")
    return getattr(module, spec.class_name)


def _decoder_callable(spec: DecoderSpec) -> Callable[[list[int]], Any]:
    decoder_class = _decoder_class(spec)
    if spec.decode == "nec_subfunction":
        return lambda timings: decoder_class.from_raw_timings(
            timings,
            decode_subfunction=True,
        )
    return decoder_class.from_raw_timings


def _candidate(
    spec: DecoderSpec,
    command: Any,
    signal: IRSignal,
    carrier_source: str,
    *,
    consumed_ranges: list[list[int]],
    decoder_scope: str,
) -> dict[str, Any]:
    expected_carrier = int(getattr(command, "modulation", signal.carrier_frequency))
    mismatch = carrier_source == "provided" and abs(
        expected_carrier - signal.carrier_frequency
    ) > max(2_000, int(expected_carrier * 0.15))
    fields = _command_fields(command)
    canonical_signal = _command_signal(command)
    return {
        "protocol": spec.protocol,
        "confidence": "medium" if mismatch or carrier_source != "provided" else "high",
        "carrier_frequency": expected_carrier,
        "carrier_evidence": carrier_source,
        "carrier_mismatch": mismatch,
        "stateful": spec.stateful,
        "recognizer_sources": ["infrared_protocols"],
        "decoder_evidence": [
            {
                "source": "infrared_protocols",
                "decoder": f"{spec.module}.{spec.class_name}",
                "scope": decoder_scope,
            }
        ],
        "_decoded_ranges": [list(item) for item in consumed_ranges],
        "_capture_decoded": decoder_scope == "capture",
        "_frame_decoded": decoder_scope == "frame",
        **(
            {"_canonical_signal": canonical_signal}
            if canonical_signal is not None
            else {}
        ),
        **fields,
    }


def _command_signal(command: Any) -> IRSignal | None:
    """Read a canonical waveform from an optional decoder command."""
    getter = getattr(command, "get_raw_timings", None)
    if not callable(getter):
        return None
    try:
        signed = list(getter())
        carrier = int(command.modulation)
    except AttributeError, TypeError, ValueError:
        return None
    if (
        not signed
        or carrier < 1
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value == 0
            for value in signed
        )
        or signed[0] < 0
        or any(
            (value > 0) == (signed[index - 1] > 0)
            for index, value in enumerate(signed[1:], start=1)
        )
    ):
        return None
    try:
        return IRSignal([abs(value) for value in signed], carrier)
    except ValueError:
        return None


def _command_fields(command: Any) -> dict[str, Any]:
    """Extract public decoder fields, including common slotted properties."""
    try:
        attributes = vars(command)
    except TypeError:
        attributes = {}
    fields = {
        key: _json_value(value)
        for key, value in attributes.items()
        if not key.startswith("_") and key != "modulation"
    }
    for name in (*_IDENTITY_FIELDS, "checksum", "repeat_count"):
        if name in fields or not hasattr(command, name):
            continue
        try:
            fields[name] = _json_value(getattr(command, name))
        except Exception:  # noqa: BLE001 - third-party descriptor isolation
            continue
    return fields


def _finalize_candidate(
    candidate: dict[str, Any], timings: list[int], carrier_source: str
) -> None:
    """Apply one evidence/frame contract to built-in and library candidates."""
    if "frame_roles" not in candidate:
        _apply_decoder_frame_evidence(candidate, timings)

    sources = candidate.setdefault("recognizer_sources", [])
    sources.sort()
    mismatch = bool(candidate.get("carrier_mismatch"))
    complete = bool(candidate.get("frame_structure_complete", True))
    confidence_level = candidate.get("confidence", "medium")
    if mismatch or carrier_source != "provided" or not complete:
        confidence_level = "medium"
    elif confidence_level not in {"high", "medium", "low"}:
        confidence_level = "high"
    evidence_class = {
        "high": "verified",
        "medium": "likely",
        "low": "likely",
    }.get(confidence_level, "likely")
    candidate["confidence_level"] = confidence_level
    candidate["confidence"] = evidence_class
    candidate["evidence_class"] = evidence_class
    candidate.setdefault("aliases", [])

    carrier_status = "assumed"
    if carrier_source == "provided":
        carrier_status = "mismatch" if mismatch else "provided_match"
    evidence = list(candidate.pop("decoder_evidence", []))
    evidence.extend(
        (
            {
                "source": "carrier",
                "status": carrier_status,
                "expected_hz": candidate.get("carrier_frequency"),
            },
            {
                "source": "frame_structure",
                "status": "complete" if complete else "residual",
                "consumed_timing_ranges": candidate.get("consumed_timing_ranges", []),
                "residual_timing_ranges": candidate.get("residual_timing_ranges", []),
            },
        )
    )
    candidate["evidence"] = evidence
    warnings = candidate.setdefault("warnings", [])
    if carrier_status == "assumed":
        warnings.append("carrier_assumed")
    elif carrier_status == "mismatch":
        warnings.append("provided_carrier_mismatch")
    if not complete:
        warnings.append("unclassified_timing_residual")
    candidate.pop("_decoded_ranges", None)
    candidate.pop("_capture_decoded", None)
    candidate.pop("_frame_decoded", None)


def _prepare_protocol_rebuilds(
    candidates: list[dict[str, Any]],
    source: IRSignal,
) -> tuple[
    list[dict[str, Any]], dict[str, tuple[int, tuple[int, ...], dict[str, Any]]]
]:
    """Expose compact capabilities while retaining waveforms only in cache."""
    descriptors: list[dict[str, Any]] = []
    signals: dict[str, tuple[int, tuple[int, ...], dict[str, Any]]] = {}
    for candidate in candidates:
        identity = _candidate_identity(candidate)
        candidate_id = hashlib.sha256(
            f"{identity[0]}\0{identity[1]}".encode()
        ).hexdigest()[:16]
        candidate["candidate_id"] = candidate_id
        rebuilt: IRSignal | None = None
        try:
            canonical_signal = candidate.get("_canonical_signal")
            if candidate[
                "protocol"
            ] in KNOWN_PROTOCOLS and "builtin_adapter" in candidate.get(
                "recognizer_sources", []
            ):
                rebuilt = rebuild_known_protocol(candidate, source.timings)
            elif not candidate.get("residual_timing_ranges") and canonical_signal:
                rebuilt = canonical_signal
            elif candidate["protocol"] in KNOWN_PROTOCOLS:
                rebuilt = rebuild_known_protocol(candidate, source.timings)
        except KeyError, TypeError, ValueError:
            rebuilt = None
        candidate.pop("_canonical_signal", None)
        candidate["reconstructable"] = rebuilt is not None
        if rebuilt is None:
            continue

        rebuild_id = hashlib.sha256(
            (
                f"{candidate_id}\0{rebuilt.carrier_frequency}\0"
                + ",".join(str(value) for value in rebuilt.timings)
            ).encode()
        ).hexdigest()[:16]
        changed = sum(
            left != right
            for left, right in zip(source.timings, rebuilt.timings, strict=False)
        ) + abs(len(source.timings) - len(rebuilt.timings))
        descriptor = {
            "id": rebuild_id,
            "candidate_id": candidate_id,
            "protocol": candidate["protocol"],
            "evidence_class": candidate.get("evidence_class", "likely"),
            "carrier_frequency": rebuilt.carrier_frequency,
            "carrier_changed": rebuilt.carrier_frequency != source.carrier_frequency,
            "timing_count": len(rebuilt.timings),
            "changed_timings": changed,
            "duration_delta_us": sum(rebuilt.timings) - sum(source.timings),
            **{
                field: candidate[field]
                for field in ("address", "command", "toggle", "bits")
                if field in candidate
            },
        }
        candidate["rebuild_id"] = rebuild_id
        descriptors.append(descriptor)
        signals[rebuild_id] = (
            rebuilt.carrier_frequency,
            tuple(rebuilt.timings),
            descriptor,
        )
    return descriptors, signals


def _apply_decoder_frame_evidence(
    candidate: dict[str, Any], timings: list[int]
) -> None:
    frames = _timing_frames(timings)
    decoded = {tuple(item) for item in candidate.get("_decoded_ranges", [])}
    capture_decoded = bool(candidate.get("_capture_decoded")) and not candidate.get(
        "_frame_decoded"
    )
    roles: list[dict[str, Any]] = []
    consumed: list[list[int]] = []
    residual: list[list[int]] = []
    first_body: list[int] | None = None
    repeat_count = 0
    for index, (start, body_end, end) in enumerate(frames):
        is_decoded = (
            capture_decoded or (start, body_end) in decoded or (start, end) in decoded
        )
        body = timings[start:body_end]
        if not is_decoded:
            role = "unclassified"
            residual.append([start, end])
        elif first_body is None:
            role = "intro"
            first_body = body
            consumed.append([start, end])
        elif _timings_match(first_body, body):
            role = "repeat"
            repeat_count += 1
            consumed.append([start, end])
        else:
            role = "continuation"
            consumed.append([start, end])
        item = _frame_role(index, start, body_end, end, timings, role)
        if role == "repeat":
            item["kind"] = "full"
        roles.append(item)
    candidate.update(
        {
            "frame_roles": roles,
            "captured_frame_count": len(frames),
            "repeat_count": max(candidate.get("repeat_count", 0), repeat_count),
            "required_repeats": 0,
            "minimum_frame_count": 1,
            "repeat_style": "full" if repeat_count else "none",
            "consumed_timing_ranges": consumed,
            "residual_timing_ranges": residual,
            "frame_structure_complete": not residual,
        }
    )
    if repeat_count:
        candidate["hold_likely"] = None
        candidate["hold_ambiguity"] = (
            "full_frame_repeats_may_be_hold_or_repeated_presses"
        )


def _json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return {"name": value.name, "value": _json_value(value.value)}
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    return str(value)


def _candidate_rank(candidate: dict[str, Any]) -> tuple[int, str]:
    rank = {"high": 0, "medium": 1, "low": 2}.get(candidate.get("confidence_level"), 3)
    return rank, candidate["protocol"]
