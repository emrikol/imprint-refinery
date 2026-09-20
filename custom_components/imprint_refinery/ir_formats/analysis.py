"""Protocol-neutral analysis for normalized IR timing signals."""

import hashlib
import json
from statistics import median
from typing import Any

from .model import IRSignal
from .recognition import recognize_signal

ANALYZER_VERSION = "generic-6"
DEFAULT_FRAME_GAP_US = 10_000
_ABSOLUTE_MATCH_TOLERANCE_US = 120
_RELATIVE_MATCH_TOLERANCE = 0.20
_FINGERPRINT_QUANTUM_US = 50


def analyze_signal(
    signal: IRSignal,
    *,
    carrier_source: str = "assumed",
) -> dict[str, Any]:
    """Return lossless timings plus conservative structural evidence."""
    timings = list(signal.timings)
    frame_ranges = _frame_ranges(timings)
    frames = [timings[start:end] for start, end in frame_ranges]
    groups = _group_equivalent_frames(frames)
    repeated = len(frames) > 1 and len(groups) < len(frames)
    all_same = len(frames) > 1 and len(groups) == 1
    warnings: list[str] = []
    if repeated:
        warnings.append("repeated_pattern_unknown_protocol")
    if frames and len(frames[-1]) < max(2, len(frames[0]) // 2):
        warnings.append("possible_incomplete_tail")

    analysis: dict[str, Any] = {
        "analyzer": "generic_structure",
        "analyzer_version": ANALYZER_VERSION,
        "confidence": "pattern_only" if repeated else "unknown",
        "evidence_class": "pattern_only" if repeated else "unknown",
        "carrier_frequency": signal.carrier_frequency,
        "carrier_source": carrier_source,
        "pulse_count": len(timings),
        "total_duration_us": sum(timings),
        "frame_gap_us": DEFAULT_FRAME_GAP_US,
        "frames": [
            {
                "index": index,
                "start_timing": start,
                "end_timing": end,
                "pulse_count": end - start,
                "duration_us": sum(timings[start:end]),
                "group": _group_index(groups, index),
            }
            for index, (start, end) in enumerate(frame_ranges)
        ],
        "frame_count": len(frames),
        "unique_frame_count": len(groups),
        "repeated_pattern": repeated,
        "all_frames_equivalent": all_same,
        "duration_clusters": {
            "marks": _duration_clusters(timings[0::2]),
            "spaces": _duration_clusters(timings[1::2]),
        },
        "fingerprints": {
            "exact": _fingerprint(signal.carrier_frequency, timings),
            "normalized_50us": _fingerprint(
                signal.carrier_frequency,
                [_quantize(value, _FINGERPRINT_QUANTUM_US) for value in timings],
            ),
        },
        "protocol_candidates": [],
        "warnings": warnings,
    }

    if len(frames) == 1:
        analysis["repeated_frame_count"] = 0
    elif all_same:
        analysis["repeated_frame_count"] = len(frames) - 1

    if all_same:
        analysis["single_press_candidate"] = {
            "timings": _frame_body(frames[0]),
            "kept_frames": 1,
            "removed_frames": len(frames) - 1,
            "requires_confirmation": True,
            "warning": "repeated_pattern_unknown_protocol",
        }
    recognition = recognize_signal(signal, carrier_source=carrier_source)
    analysis["recognition"] = {
        key: recognition[key]
        for key in (
            "recognizer",
            "recognizer_version",
            "library_version",
            "decoder_count",
            "limits",
        )
    }
    if "recognition_skipped" in recognition:
        analysis["recognition"]["skipped"] = recognition["recognition_skipped"]
        warnings.append("recognition_timing_limit_exceeded")
    candidates = recognition["protocol_candidates"]
    analysis["protocol_rebuilds"] = recognition.get("protocol_rebuilds", [])
    if candidates:
        analysis["protocol_candidates"] = candidates
        analysis["protocol"] = candidates[0]["protocol"]
        analysis["confidence"] = recognition["confidence"]
        analysis["evidence_class"] = recognition["evidence_class"]
        if "repeated_pattern_unknown_protocol" in warnings:
            warnings.remove("repeated_pattern_unknown_protocol")
        if len(candidates) > 1:
            warnings.append("ambiguous_protocol_candidates")
        if any(candidate["carrier_mismatch"] for candidate in candidates):
            warnings.append("provided_carrier_mismatch")
        repeat_candidate = _compatible_repeat_candidate(candidates)
        if repeat_candidate is not None:
            _apply_repeat_semantics(analysis, repeat_candidate, frames)
        elif len(candidates) > 1:
            # No arbitrary candidate may silently decide how much of an
            # ambiguous capture is safe to remove.
            analysis.pop("single_press_candidate", None)
            warnings.append("ambiguous_repeat_semantics")
    binary_decoders = _run_binary_decoders(timings)
    binary_payload = _apply_binary_consensus(binary_decoders, candidates)
    analysis["binary_decoders"] = binary_decoders
    if binary_payload is not None:
        analysis["binary_payload"] = binary_payload
    analysis["warnings"] = list(dict.fromkeys(warnings))
    return analysis


def _compatible_repeat_candidate(
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Return the most specific repeat interpretation when none contradict it."""
    if not candidates:
        return None
    reference = max(
        candidates,
        key=lambda item: sum(
            role.get("role") != "unclassified" for role in item.get("frame_roles", [])
        ),
    )
    roles = reference.get("frame_roles", [])
    if not roles:
        return None
    if len(candidates) == 1:
        return reference
    repeat_count = reference.get("repeat_count", 0)
    minimum_frames = reference.get("minimum_frame_count", 1)
    required_repeats = reference.get("required_repeats", 0)
    for candidate in candidates:
        if candidate.get("repeat_count", 0) != repeat_count:
            return None
        if candidate.get("minimum_frame_count", 1) != minimum_frames:
            return None
        if candidate.get("required_repeats", 0) != required_repeats:
            return None
        candidate_roles = candidate.get("frame_roles", [])
        if len(candidate_roles) != len(roles):
            return None
        for expected, observed in zip(roles, candidate_roles, strict=True):
            compatible_roles = {expected.get("role")}
            if repeat_count > 0:
                compatible_roles.add("unclassified")
            if observed.get("role") not in compatible_roles:
                return None
    return reference


def _apply_repeat_semantics(
    analysis: dict[str, Any],
    candidate: dict[str, Any],
    frames: list[list[int]],
) -> None:
    """Lift recognized repeat evidence into the protocol-neutral result."""
    for field in (
        "frame_roles",
        "repeat_count",
        "required_repeats",
        "minimum_frame_count",
        "repeat_style",
        "repeat_requirement_met",
        "hold_likely",
        "hold_ambiguity",
    ):
        if field in candidate:
            analysis[field] = candidate[field]

    repeat_count = candidate.get("repeat_count", 0)
    analysis["repeated_frame_count"] = repeat_count
    if repeat_count:
        analysis["repeated_pattern"] = True
        if "possible_incomplete_tail" in analysis["warnings"]:
            last_role = candidate["frame_roles"][-1]["role"]
            if last_role == "repeat":
                analysis["warnings"].remove("possible_incomplete_tail")

    minimum_frames = candidate.get("minimum_frame_count", 1)
    roles = candidate.get("frame_roles", [])
    can_optimize = (
        repeat_count > 0
        and len(frames) > minimum_frames
        and len(roles) == len(frames)
        and all(item["role"] != "unclassified" for item in roles)
    )
    if can_optimize:
        kept = frames[:minimum_frames]
        timings = [value for frame in kept for value in frame]
        if minimum_frames == 1:
            timings = _frame_body(kept[0])
        analysis["single_press_candidate"] = {
            "timings": timings,
            "kept_frames": minimum_frames,
            "removed_frames": len(frames) - minimum_frames,
            "requires_confirmation": True,
            "warning": "recognized_protocol_repeat_requires_review",
            "protocol": candidate["protocol"],
        }
    elif minimum_frames > 1 and len(frames) <= minimum_frames:
        # A generic identical-frame collapse would violate protocols such as
        # Sony SIRC that require several full transmissions for one press.
        analysis.pop("single_press_candidate", None)
    elif "single_press_candidate" in analysis:
        analysis["single_press_candidate"]["warning"] = (
            "recognized_protocol_repeat_requires_review"
        )


def _frame_ranges(timings: list[int]) -> list[tuple[int, int]]:
    """Split frames at long spaces while preserving every duration."""
    ranges: list[tuple[int, int]] = []
    start = 0
    for index in range(1, len(timings), 2):
        if timings[index] < DEFAULT_FRAME_GAP_US or index + 1 >= len(timings):
            continue
        ranges.append((start, index + 1))
        start = index + 1
    if start < len(timings):
        ranges.append((start, len(timings)))
    return ranges or [(0, len(timings))]


def _group_equivalent_frames(frames: list[list[int]]) -> list[list[int]]:
    """Group frame indexes with timing-equivalent bodies."""
    groups: list[list[int]] = []
    representatives: list[list[int]] = []
    for index, frame in enumerate(frames):
        body = _frame_body(frame)
        for group_index, representative in enumerate(representatives):
            if _timings_match(body, representative):
                groups[group_index].append(index)
                break
        else:
            representatives.append(body)
            groups.append([index])
    return groups


def _frame_body(frame: list[int]) -> list[int]:
    """Exclude a long trailing inter-frame gap from shape comparison."""
    if len(frame) % 2 == 0 and frame[-1] >= DEFAULT_FRAME_GAP_US:
        return frame[:-1]
    return list(frame)


def _timings_match(left: list[int], right: list[int]) -> bool:
    if len(left) != len(right):
        return False
    return all(
        abs(a - b)
        <= max(
            _ABSOLUTE_MATCH_TOLERANCE_US,
            int(max(a, b) * _RELATIVE_MATCH_TOLERANCE),
        )
        for a, b in zip(left, right, strict=True)
    )


def _group_index(groups: list[list[int]], frame_index: int) -> int:
    for group_index, members in enumerate(groups):
        if frame_index in members:
            return group_index
    raise ValueError(frame_index)


def _duration_clusters(values: list[int]) -> list[dict[str, int]]:
    """Cluster similar durations for display without changing raw values."""
    clusters: list[list[int]] = []
    for value in sorted(values):
        for cluster in clusters:
            center = int(median(cluster))
            if abs(value - center) <= max(
                _ABSOLUTE_MATCH_TOLERANCE_US,
                int(center * _RELATIVE_MATCH_TOLERANCE),
            ):
                cluster.append(value)
                break
        else:
            clusters.append([value])
    return [
        {
            "nominal_us": int(median(cluster)),
            "minimum_us": min(cluster),
            "maximum_us": max(cluster),
            "count": len(cluster),
        }
        for cluster in clusters
    ]


def _run_binary_decoders(timings: list[int]) -> dict[str, Any]:
    """Run established pulse-distance/width models over the first frame.

    This follows the universal distance/width decoder pattern used by mature
    signal receivers: group mark and space durations independently, reject an
    axis with more than two classes, select the variable axis, then classify
    each symbol at the midpoint between its short and long nominal durations.
    The named-protocol recognizer is deliberately not consulted here.
    """
    modes = ("pulse_distance", "pulse_width")
    if len(timings) < 16:
        return {
            "strategy": "duration_bin_template_match",
            "selected_mode": None,
            "results": [
                {"mode": mode, "status": "rejected", "reason": "not_enough_symbols"}
                for mode in modes
            ],
        }

    start, end = _frame_ranges(timings)[0]
    frame = _frame_body(timings[start:end])
    attempts: dict[str, list[dict[str, Any]]] = {mode: [] for mode in modes}
    rejection_reasons: dict[str, set[str]] = {mode: set() for mode in modes}

    # Offset 0 handles streams without a header. Offset 2 handles the common
    # leading mark/space header. A skipped pair must be outside the data bins.
    for offset in (0, 2):
        payload = frame[offset:]
        if len(payload) < 14:
            for mode in modes:
                rejection_reasons[mode].add("not_enough_symbols")
            continue
        marks = payload[0::2]
        spaces = payload[1::2]
        mark_clusters = sorted(
            _duration_clusters(marks), key=lambda item: item["nominal_us"]
        )
        space_clusters = sorted(
            _duration_clusters(spaces), key=lambda item: item["nominal_us"]
        )
        if not 1 <= len(mark_clusters) <= 2:
            rejection_reasons["pulse_distance"].add("mark_axis_has_too_many_classes")
            rejection_reasons["pulse_width"].add("mark_axis_is_not_binary")
        if not 1 <= len(space_clusters) <= 2:
            rejection_reasons["pulse_distance"].add("space_axis_is_not_binary")
            rejection_reasons["pulse_width"].add("space_axis_has_too_many_classes")
        if offset and not _leading_pair_is_header(frame, mark_clusters, space_clusters):
            for mode in modes:
                rejection_reasons[mode].add("leading_pair_matches_data")
            continue

        # Pulse-distance and combined distance/width encodings carry the bit
        # value in the space duration. As in Arduino-IRremote's universal
        # decoder, a two-class space axis takes precedence when both vary.
        if len(spaces) >= 7 and len(space_clusters) == 2 and len(mark_clusters) <= 2:
            attempts["pulse_distance"].append(
                _decoder_attempt(
                    spaces,
                    space_clusters,
                    encoding=(
                        "pulse_distance_width"
                        if len(mark_clusters) == 2
                        else "pulse_distance"
                    ),
                    symbol="space_length",
                    header=frame[:offset],
                )
            )
        else:
            rejection_reasons["pulse_distance"].add(
                "space_axis_does_not_have_two_classes"
            )

        # Pulse-width requires a stable space axis and two mark classes.
        if len(marks) >= 7 and len(mark_clusters) == 2 and len(space_clusters) == 1:
            attempts["pulse_width"].append(
                _decoder_attempt(
                    marks,
                    mark_clusters,
                    encoding="pulse_width",
                    symbol="mark_length",
                    header=frame[:offset],
                )
            )
        else:
            rejection_reasons["pulse_width"].add(
                "requires_two_mark_classes_and_one_space_class"
            )

    results: list[dict[str, Any]] = []
    for mode in modes:
        if attempts[mode]:
            best = max(
                attempts[mode],
                key=lambda item: (item["fit"], item["payload"]["bit_count"]),
            )
            results.append({"mode": mode, "status": "matched", **best})
        else:
            results.append(
                {
                    "mode": mode,
                    "status": "rejected",
                    "reason": min(rejection_reasons[mode])
                    if rejection_reasons[mode]
                    else "timing_pattern_does_not_fit",
                }
            )

    matches = [result for result in results if result["status"] == "matched"]
    selected = max(matches, key=lambda item: item["fit"]) if matches else None
    return {
        "strategy": "duration_bin_template_match",
        "selected_mode": selected["mode"] if selected else None,
        "results": results,
    }


def _apply_binary_consensus(
    decoders: dict[str, Any],
    protocol_candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Accept Auto only when every applicable decoder yields identical bits."""
    structural_results = [
        result
        for result in decoders["results"]
        if result.get("status") == "matched"
        and isinstance(result.get("payload"), dict)
        and result["payload"].get("value")
    ]
    structural = next(
        (
            result
            for result in structural_results
            if result["mode"] == decoders.get("selected_mode")
        ),
        structural_results[0] if structural_results else None,
    )
    protocol_results = [
        {
            "protocol": candidate.get("protocol", "Unknown"),
            "payload": candidate["binary_payload"],
        }
        for candidate in protocol_candidates
        if isinstance(candidate.get("binary_payload"), dict)
    ]
    decoders["protocol_results"] = protocol_results

    votes: list[dict[str, Any]] = [
        {
            "method": result["mode"],
            "family": "waveform_model",
            "value": result["payload"]["value"],
            "fit": result["fit"],
        }
        for result in structural_results
    ]
    for index, result in enumerate(protocol_results):
        votes.append(
            {
                "method": f"protocol:{result['protocol']}",
                "result_index": index,
                "family": "named_protocol",
                "value": result["payload"]["value"],
            }
        )
    decoders["votes"] = votes

    values = {vote["value"] for vote in votes}
    if not votes:
        decoders["auto"] = {
            "status": "no_match",
            "confidence_score": 0,
            "agreement_count": 0,
            "method_count": 0,
        }
        return None
    if len(values) != 1:
        decoders["auto"] = {
            "status": "ambiguous",
            "confidence_score": 0,
            "agreement_count": 0,
            "method_count": len(votes),
            "competing_values": sorted(values),
        }
        return None

    protocol_payload = protocol_results[0]["payload"] if protocol_results else None
    fit = float(structural["fit"]) if structural is not None else 0.0
    if structural is not None and protocol_payload is not None:
        score = round((0.70 * fit + 0.30) * 100)
        payload = {
            **structural["payload"],
            "bit_order": protocol_payload.get("bit_order", "unknown"),
            "evidence": "distance_width_model_and_recognized_protocol",
        }
    elif structural is not None:
        score = round(0.70 * fit * 100)
        payload = dict(structural["payload"])
    else:
        score = 75
        payload = dict(protocol_payload)

    auto = {
        "status": "matched",
        "confidence_score": score,
        "agreement_count": len(votes),
        "method_count": len(votes),
        "evidence_family_count": len({vote["family"] for vote in votes}),
        "selected_value": next(iter(values)),
    }
    decoders["auto"] = auto
    return {**payload, **auto}


def _decoder_attempt(
    values: list[int],
    clusters: list[dict[str, int]],
    *,
    encoding: str,
    symbol: str,
    header: list[int],
) -> dict[str, Any]:
    zero, one = clusters
    threshold = (zero["nominal_us"] + one["nominal_us"]) / 2
    bits = "".join("0" if value < threshold else "1" for value in values)
    residual = sum(
        abs(
            value
            - min((zero, one), key=lambda item: abs(value - item["nominal_us"]))[
                "nominal_us"
            ]
        )
        / max(1, value)
        for value in values
    ) / len(values)
    return {
        "fit": round(max(0.0, 1.0 - residual), 4),
        "payload": _inferred_payload(
            bits,
            encoding=encoding,
            symbol=symbol,
            zero=zero,
            one=one,
            header=header,
            threshold=threshold,
        ),
    }


def _leading_pair_is_header(
    frame: list[int],
    mark_clusters: list[dict[str, int]],
    space_clusters: list[dict[str, int]],
) -> bool:
    return not (
        any(_cluster_contains(frame[0], cluster) for cluster in mark_clusters)
        and any(_cluster_contains(frame[1], cluster) for cluster in space_clusters)
    )


def _cluster_contains(value: int, cluster: dict[str, int]) -> bool:
    nominal = cluster["nominal_us"]
    return abs(value - nominal) <= max(
        _ABSOLUTE_MATCH_TOLERANCE_US,
        int(nominal * _RELATIVE_MATCH_TOLERANCE),
    )


def _inferred_payload(
    bits: str,
    *,
    encoding: str,
    symbol: str,
    zero: dict[str, int],
    one: dict[str, int],
    header: list[int],
    threshold: float,
) -> dict[str, Any]:
    return {
        "value": bits,
        "bit_count": len(bits),
        "display_order": "transmission",
        "bit_order": "unknown",
        "encoding": encoding,
        "symbol": symbol,
        "zero_us": zero["nominal_us"],
        "one_us": one["nominal_us"],
        "threshold_us": round(threshold),
        "header_timings": header,
        "evidence": "distance_width_model",
    }


def _quantize(value: int, quantum: int) -> int:
    return max(quantum, round(value / quantum) * quantum)


def _fingerprint(carrier_frequency: int, timings: list[int]) -> str:
    serialized = json.dumps(
        [carrier_frequency, timings],
        separators=(",", ":"),
    ).encode()
    return hashlib.sha256(serialized).hexdigest()
