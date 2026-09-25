"""Offline catalog backed by the bundled Flipper-IRDB artifact."""

from collections.abc import Iterable, Mapping
from copy import deepcopy
from functools import lru_cache
import re
from typing import Any

from .catalog_artifact import CatalogArtifactError, bundled_catalog
from .identifiers import normalize_identifier, unique_identifier
from .ir_formats import (
    IRFormatError,
    IRSignal,
    analyze_signal,
    decode_flipper,
    encode_raw,
    signal_document,
)
from .product_spec import SIGNAL_ROLES


class CatalogUnavailableError(RuntimeError):
    """Raised when the bundled offline catalog is unavailable."""


_COMMAND_ROLE_ALIASES = {
    "power": "power_toggle",
    "power_toggle": "power_toggle",
    "on_off": "power_toggle",
    "power_on": "power_on",
    "led_on": "power_on",
    "on": "power_on",
    "power_off": "power_off",
    "led_off": "power_off",
    "off": "power_off",
    "standby": "power_toggle",
    "play_pause": "play_pause_toggle",
    "pause_play": "play_pause_toggle",
    "play_pause_toggle": "play_pause_toggle",
    "play": "play",
    "pause": "pause",
    "stop": "stop",
    "previous": "previous",
    "prev": "previous",
    "skip_back": "previous",
    "skip_backward": "previous",
    "next": "next",
    "skip_forward": "next",
    "skip_fwd": "next",
    "rewind": "rewind",
    "rew": "rewind",
    "rev": "rewind",
    "reverse": "rewind",
    "fast_back": "rewind",
    "fast_backward": "rewind",
    "fast_ba": "rewind",
    "fast_forward": "fast_forward",
    "forward": "fast_forward",
    "fwd": "fast_forward",
    "ff": "fast_forward",
    "fast_fo": "fast_forward",
    "volume_down": "volume_down",
    "vol_down": "volume_down",
    "vol_dn": "volume_down",
    "vol_dwn": "volume_down",
    "volume_up": "volume_up",
    "vol_up": "volume_up",
    "mute": "mute_toggle",
    "muting": "mute_toggle",
    "mute_toggle": "mute_toggle",
    "mute_on": "mute",
    "mute_off": "unmute",
    "unmute": "unmute",
    "source": "source",
    "input": "source",
    "input_select": "source",
}

_CATEGORY_FAMILIES = {
    "tv": {"tv"},
    "audio": {"audio", "receiver"},
    "media": {
        "media_player",
        "multimedia",
        "projector",
        "set_top_box",
        "tv_tuner",
    },
    "fan": {"fan"},
    "climate": {
        "air_purifier",
        "climate",
        "fireplace",
        "heater",
        "humidifier",
    },
    "light": {"light"},
}

_APPLIANCE_TYPE_CATEGORIES = {
    "air_purifier": {"air_purifier"},
    "audio": {"audio"},
    "climate": {"climate"},
    "display": {"display", "picture_frames", "touchscreen_displays", "whiteboards"},
    "fan": {"fan"},
    "fireplace": {"fireplace"},
    "heater": {"heater"},
    "humidifier": {"humidifier"},
    "light": {"light"},
    "media_player": {"consoles", "laserdisc", "media_player", "minidisc", "multimedia"},
    "projector": {"projector"},
    "receiver": {"receiver"},
    "set_top_box": {"dvb_t", "set_top_box", "tv_tuner"},
    "tv": {"tv"},
}

_UNCLASSIFIED_CATALOG_CATEGORIES = {
    "converted",
    "csv",
    "ir_plus",
    "miscellaneous",
    "other",
    "pronto",
}


def canonical_command_role(name: str) -> str:
    """Return a conservative standard role for one catalog command label."""
    raw_name = name.strip().casefold()
    if re.fullmatch(r"vol(?:ume)?[\s._-]*\+", raw_name):
        return "volume_up"
    if re.fullmatch(r"vol(?:ume)?[\s._]*-", raw_name):
        return "volume_down"
    command_id = normalize_identifier(name)
    direct = _COMMAND_ROLE_ALIASES.get(command_id)
    if direct:
        return direct
    if re.fullmatch(r"(?:power_|led_)?off_\d+", command_id):
        return "power_off"
    if re.fullmatch(r"(?:power_|led_)?on_\d+", command_id):
        return "power_on"
    return ""


def appliance_type_match(category: str, appliance_type: str) -> str:
    """Classify catalog metadata without discarding unclassified profiles."""
    normalized_type = normalize_identifier(appliance_type)
    if not normalized_type or normalized_type == "generic":
        return "all"
    normalized_category = normalize_identifier(category)
    expected = _APPLIANCE_TYPE_CATEGORIES.get(normalized_type, {normalized_type})
    if normalized_category in expected:
        return "selected"
    if normalized_category in _UNCLASSIFIED_CATALOG_CATEGORIES:
        return "unclassified"
    return "other"


def _appliance_type_rank(category: str, appliance_type: str) -> int:
    return {
        "all": 0,
        "selected": 0,
        "unclassified": 1,
        "other": 2,
    }[appliance_type_match(category, appliance_type)]


@lru_cache(maxsize=1)
def catalog_status() -> dict[str, Any]:
    """Return bundled catalog metadata without raising."""
    try:
        artifact = bundled_catalog().status()
    except CatalogArtifactError:
        return {
            "installed": False,
            "version": None,
            "profile_count": 0,
            "counts": {},
            "source": "Flipper-IRDB",
            "license": "CC0-1.0",
        }
    source = artifact["source"]
    return {
        "installed": True,
        "version": artifact["version"],
        "profile_count": artifact["counts"]["profiles"],
        "counts": artifact["counts"],
        "source": source["name"],
        "license": source["license"],
        "revision": source.get("revision"),
    }


def search_profiles(
    *, category: str = "", brand: str = "", model: str = ""
) -> dict[str, Any]:
    """Search profile metadata in the bundled catalog."""
    status = catalog_status()
    if not status["installed"]:
        raise CatalogUnavailableError("bundled offline catalog is not installed")
    category_key = normalize_identifier(category)
    category_family = _CATEGORY_FAMILIES.get(category_key)
    try:
        artifact_results = bundled_catalog().search(
            category="" if category_family else category,
            brand=brand,
            model=model,
            limit=max(status["profile_count"], 50) if category_family else 50,
        )
    except CatalogArtifactError as err:
        raise CatalogUnavailableError(str(err)) from err

    model_key = _normalize(model)
    results = []
    for profile in artifact_results:
        if category_family and profile.get("category") not in category_family:
            continue
        formats = profile.get("formats", {})
        profile_model = _normalize(profile.get("model", ""))
        remote_model = _normalize(profile.get("remote_model", ""))
        aliases = {_normalize(item) for item in profile.get("aliases", [])}
        if model_key and model_key == profile_model:
            match = "exact_model"
        elif model_key and (
            model_key == remote_model
            or model_key in aliases
            or model_key in " ".join((profile_model, remote_model, *aliases))
        ):
            match = "remote_family"
        elif brand:
            match = "brand_candidate"
        else:
            match = "community"
        results.append(
            {
                "profile_id": profile["profile_id"],
                "name": profile["name"],
                "brand": profile["brand"],
                "model": profile["model"],
                "category": profile["category"],
                "match": match,
                "command_count": profile["command_count"],
                "source_name": "Flipper-IRDB",
                "source_license": "CC0-1.0",
                "validation": "unverified",
                "compatible": bool(formats.get("raw") or formats.get("parsed")),
                "remote_model": profile.get("remote_model", ""),
                "aliases": profile.get("aliases", []),
                "formats": formats,
            }
        )
    results.sort(
        key=lambda item: (
            {
                "exact_model": 0,
                "remote_family": 1,
                "brand_candidate": 2,
                "community": 3,
            }.get(item["match"], 4),
            item["brand"].casefold(),
            item["model"].casefold(),
        )
    )
    return {"catalog": status, "profiles": results[:50]}


@lru_cache(maxsize=64)
def get_profile(profile_id: str) -> dict[str, Any]:
    """Expand one bundled profile into transport-ready commands."""
    try:
        profile = bundled_catalog().get_profile(profile_id)
    except CatalogArtifactError as err:
        raise CatalogUnavailableError(str(err)) from err

    commands: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for document, fallback_name in _split_flipper_records(profile["document"]):
        try:
            decoded = decode_flipper(document)[0]
            signal = decoded.signal
            analysis = analyze_signal(signal, carrier_source="provided")
            code = encode_raw(signal, signed=True)
        except IRFormatError as err:
            unsupported.append(
                {
                    "name": fallback_name,
                    "error": str(err),
                    "original_representation": document,
                    "provenance": {
                        "type": "catalog",
                        "catalog": "Flipper-IRDB",
                        "catalog_version": profile["catalog_version"],
                        "source_path": profile["source_path"],
                        "original_name": fallback_name,
                    },
                }
            )
            continue
        command_id = unique_identifier(decoded.name, used_ids)
        commands.append(
            {
                "command_id": command_id,
                "name": decoded.name,
                "role": canonical_command_role(decoded.name),
                "code": code,
                "format": "raw_signed",
                "signal": signal_document(signal, "provided"),
                "analysis": analysis,
                "source": {
                    "type": "catalog",
                    "catalog": "Flipper-IRDB",
                    "catalog_version": profile["catalog_version"],
                    "source_path": profile["source_path"],
                    "original_name": decoded.name,
                    "original_representation": document,
                    "record_type": decoded.record_type,
                    "protocol": decoded.protocol,
                },
            }
        )
    return {
        "profile_id": profile_id,
        "name": profile["name"],
        "brand": profile["brand"],
        "model": profile["model"],
        "category": profile["category"],
        "match": "community",
        "command_count": len(commands),
        "source_name": "Flipper-IRDB",
        "source_license": "CC0-1.0",
        "validation": "unverified",
        "compatible": bool(commands),
        "commands": commands,
        "unsupported_commands": unsupported,
        "aliases": profile.get("aliases", []),
        "source": {
            "name": profile["source"]["name"],
            "license": profile["source"]["license"],
            "version": profile["catalog_version"],
            "revision": profile["source"].get("revision"),
            "path": profile["source_path"],
        },
    }


def prepare_profile_import(
    profile_id: str,
    *,
    registry_data: Mapping[str, Any] | None = None,
    remote_profile_id: str | None = None,
) -> dict[str, Any]:
    """Return an import preview with starter, conflict, and duplicate metadata."""
    profile = deepcopy(get_profile(profile_id))
    existing_commands = list(_registry_commands(registry_data or {}))
    target_commands = _target_commands(
        registry_data or {},
        remote_profile_id=remote_profile_id,
    )
    starter_ids: list[str] = []
    duplicate_count = 0
    conflict_count = 0
    for command in profile["commands"]:
        command_id = command["command_id"]
        starter = bool(command.get("role"))
        if starter:
            starter_ids.append(command_id)
        duplicates = _command_duplicates(command, existing_commands)
        conflict = target_commands.get(command_id)
        if duplicates:
            duplicate_count += 1
        if conflict is not None:
            conflict_count += 1
        command["import"] = {
            "starter": starter,
            "target_conflict": (
                {
                    "command_id": command_id,
                    "name": conflict.get("name", command_id),
                    "current_revision": conflict.get("current_revision", 0),
                }
                if conflict is not None
                else None
            ),
            "duplicates": duplicates,
            "provenance": deepcopy(command.get("source", {})),
        }

    if profile["commands"] and not starter_ids:
        starter_ids = [profile["commands"][0]["command_id"]]
        profile["commands"][0]["import"]["starter"] = True
    all_ids = [command["command_id"] for command in profile["commands"]]
    profile["import_plan"] = {
        "all_command_ids": all_ids,
        "starter_command_ids": starter_ids,
        "conflict_count": conflict_count,
        "duplicate_count": duplicate_count,
        "unsupported_count": len(profile["unsupported_commands"]),
        "target": (
            {"remote_profile_id": remote_profile_id} if remote_profile_id else None
        ),
        "provenance": deepcopy(profile["source"]),
    }
    return profile


def _target_commands(
    registry_data: Mapping[str, Any],
    *,
    remote_profile_id: str | None,
) -> Mapping[str, Any]:
    if not remote_profile_id:
        return {}
    profiles = registry_data.get("remote_profiles", {})
    if not isinstance(profiles, Mapping):
        return {}
    profile = profiles.get(remote_profile_id, {})
    if not isinstance(profile, Mapping):
        return {}
    commands = profile.get("commands", {})
    return commands if isinstance(commands, Mapping) else {}


def _registry_commands(
    registry_data: Mapping[str, Any],
) -> list[tuple[str, str, Mapping[str, Any]]]:
    result = []
    profiles = registry_data.get("remote_profiles", {})
    if not isinstance(profiles, Mapping):
        return result
    for remote_profile_id, profile in profiles.items():
        if not isinstance(profile, Mapping):
            continue
        commands = profile.get("commands", {})
        if not isinstance(commands, Mapping):
            continue
        for command_id, command in commands.items():
            if isinstance(command, Mapping):
                result.append((str(remote_profile_id), str(command_id), command))
    return result


def _command_duplicates(
    candidate: Mapping[str, Any],
    existing_commands: list[tuple[str, str, Mapping[str, Any]]],
) -> list[dict[str, str]]:
    candidate_fingerprint = _normalized_fingerprint(candidate)
    candidate_code = candidate.get("code")
    duplicates = []
    for remote_profile_id, command_id, command in existing_commands:
        match_basis = None
        existing_fingerprint = _normalized_fingerprint(command)
        if candidate_fingerprint and candidate_fingerprint == existing_fingerprint:
            match_basis = "normalized_50us"
        elif candidate_code and candidate_code == command.get("code"):
            match_basis = "transport_code"
        if match_basis:
            duplicates.append(
                {
                    "remote_profile_id": remote_profile_id,
                    "command_id": command_id,
                    "name": str(command.get("name", command_id)),
                    "match_basis": match_basis,
                }
            )
    return duplicates


def _normalized_fingerprint(command: Mapping[str, Any]) -> str | None:
    analysis = command.get("analysis", {})
    if not isinstance(analysis, Mapping):
        return None
    fingerprints = analysis.get("fingerprints", {})
    if not isinstance(fingerprints, Mapping):
        return None
    value = fingerprints.get("normalized_50us")
    return value if isinstance(value, str) and value else None


def _split_flipper_records(document: str) -> list[tuple[str, str]]:
    """Return independently decodable Flipper records with the shared header."""
    header: list[str] = []
    records: list[list[str]] = []
    current: list[str] = []
    for line in document.splitlines():
        if line.strip() == "#":
            if current:
                records.append(current)
            current = ["#"]
        elif current:
            current.append(line)
        elif line.startswith(("Filetype:", "Version:")):
            header.append(line)
    if current:
        records.append(current)
    prefix = "\n".join(header)
    result = []
    for index, record in enumerate(records, start=1):
        name = next(
            (
                line.split(":", 1)[1].strip()
                for line in record
                if line.lower().startswith("name:")
            ),
            f"Command {index}",
        )
        result.append((f"{prefix}\n{'\n'.join(record)}\n", name))
    return result


def guided_candidates(*, category: str, brand: str) -> dict[str, Any]:
    """Return de-duplicated Power candidates for explicit one-at-a-time tests."""
    search = search_profiles(category=category, brand=brand)
    candidates: dict[str, dict[str, Any]] = {}
    for summary in search["profiles"]:
        profile = get_profile(summary["profile_id"])
        powers = [
            command
            for command in profile["commands"]
            if command["command_id"]
            in {"power", "power_toggle", "power_on", "power_off"}
        ]
        command = next(
            (
                item
                for item in powers
                if item["command_id"] in {"power", "power_toggle"}
            ),
            powers[0] if powers else None,
        )
        if command is None:
            continue
        fingerprint = command["analysis"]["fingerprints"]["normalized_50us"]
        candidate = candidates.setdefault(
            fingerprint,
            {
                "candidate_id": fingerprint[:16],
                "command": command,
                "profile_ids": [],
                "profile_names": [],
            },
        )
        candidate["profile_ids"].append(profile["profile_id"])
        candidate["profile_names"].append(profile["name"])
    return {"catalog": search["catalog"], "candidates": list(candidates.values())}


def match_signal(
    candidate: IRSignal | Mapping[str, Any],
    *,
    limit: int | None = 25,
    expected_role: str = "",
    appliance_type: str = "generic",
) -> dict[str, Any]:
    """Match exact artifact fingerprints or parsed protocol fields."""
    status = catalog_status()
    if not status["installed"]:
        raise CatalogUnavailableError("bundled offline catalog is not installed")
    if limit is not None and (
        isinstance(limit, bool) or not isinstance(limit, int) or limit < 1
    ):
        raise ValueError("limit must be a positive integer")
    if expected_role and expected_role not in SIGNAL_ROLES:
        raise ValueError(f"unsupported command role: {expected_role}")
    analysis = _candidate_analysis(candidate)
    fingerprints = _analysis_fingerprints(analysis)
    parsed = []
    for protocol_candidate in analysis.get("protocol_candidates", []):
        if not isinstance(protocol_candidate, Mapping):
            continue
        protocol = protocol_candidate.get("protocol")
        address = protocol_candidate.get("address")
        command = protocol_candidate.get("command")
        if (
            isinstance(protocol, str)
            and protocol
            and isinstance(address, int)
            and not isinstance(address, bool)
            and isinstance(command, int)
            and not isinstance(command, bool)
        ):
            parsed.append((protocol, address, command))
    try:
        result = bundled_catalog().match(
            normalized_50us=fingerprints["normalized_50us"],
            parsed=parsed,
            limit=None,
        )
    except CatalogArtifactError as err:
        raise CatalogUnavailableError(str(err)) from err

    source = {
        "catalog": status["source"],
        "license": status["license"],
        "version": status["version"],
        "revision": status.get("revision"),
    }
    matches = []
    for item in result["matches"]:
        profile = item["profile"]
        basis = item["match_basis"]
        command = item["command"]
        command_name = command["name"]
        role = canonical_command_role(command_name)
        if expected_role and role != expected_role:
            continue
        matches.append(
            {
                "match_quality": basis["type"],
                "match_method": _match_method(basis),
                "match_basis": basis,
                "profile": {
                    key: profile[key]
                    for key in (
                        "profile_id",
                        "name",
                        "brand",
                        "model",
                        "category",
                        "command_count",
                    )
                },
                "command": {
                    "command_id": normalize_identifier(command_name),
                    "name": command_name,
                    "role": role,
                    "record_index": command["record_index"],
                    "record_type": command["record_type"],
                },
                "fingerprints": (
                    {"normalized_50us": fingerprints["normalized_50us"]}
                    if basis["type"] == "normalized_50us"
                    else {}
                ),
                "source": {**source, "path": profile["source_path"]},
                "appliance_type_match": appliance_type_match(
                    profile["category"], appliance_type
                ),
            }
        )
    matches.sort(
        key=lambda match: _appliance_type_rank(
            match["profile"]["category"], appliance_type
        )
    )
    for rank, match in enumerate(matches, start=1):
        match["rank"] = rank
    profile_ids = list(
        dict.fromkeys(match["profile"]["profile_id"] for match in matches)
    )
    visible = matches if limit is None else matches[:limit]
    return {
        "catalog": status,
        "fingerprints": fingerprints,
        "match_count": len(matches),
        "profile_count": len(profile_ids),
        "profile_ids": profile_ids,
        "truncated": limit is not None and len(matches) > len(visible),
        "matches": visible,
    }


def identify_signals(
    captures: Iterable[tuple[IRSignal | Mapping[str, Any], str]],
    *,
    limit: int = 25,
    appliance_type: str = "generic",
) -> dict[str, Any]:
    """Intersect complete catalog profile matches across captured buttons."""
    capture_list = list(captures)
    if not capture_list:
        raise ValueError("at least one captured signal is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ValueError("limit must be a positive integer")

    capture_maps: list[dict[str, dict[str, Any]]] = []
    capture_summaries: list[dict[str, Any]] = []
    seen_signatures: dict[tuple[str, str], int] = {}
    catalog = catalog_status()
    for index, (candidate, expected_role) in enumerate(capture_list, start=1):
        result = match_signal(
            candidate,
            limit=None,
            expected_role=expected_role,
            appliance_type=appliance_type,
        )
        by_profile: dict[str, dict[str, Any]] = {}
        for match in result["matches"]:
            profile_id = match["profile"]["profile_id"]
            by_profile.setdefault(profile_id, match)
        capture_maps.append(by_profile)
        signature = (result["fingerprints"]["normalized_50us"], expected_role)
        duplicate_of = seen_signatures.get(signature)
        seen_signatures.setdefault(signature, index)
        capture_summaries.append(
            {
                "index": index,
                "role": expected_role,
                "profile_count": len(by_profile),
                "duplicate_of": duplicate_of,
            }
        )

    common_ids = set(capture_maps[0])
    for by_profile in capture_maps[1:]:
        common_ids.intersection_update(by_profile)
    ordered_ids = [
        profile_id for profile_id in capture_maps[0] if profile_id in common_ids
    ]

    matches = []
    for rank, profile_id in enumerate(ordered_ids, start=1):
        evidence = [by_profile[profile_id] for by_profile in capture_maps]
        matches.append(
            {
                "rank": rank,
                "profile": evidence[0]["profile"],
                "appliance_type_match": evidence[0].get("appliance_type_match", "all"),
                "matched_capture_count": len(evidence),
                "evidence": [
                    {
                        "capture_index": capture_index,
                        "command": item["command"],
                        "match_basis": item["match_basis"],
                        "match_method": item["match_method"],
                    }
                    for capture_index, item in enumerate(evidence, start=1)
                ],
            }
        )

    return {
        "catalog": catalog,
        "appliance_type": appliance_type,
        "captures": capture_summaries,
        "match_count": len(matches),
        "truncated": len(matches) > limit,
        "matches": matches[:limit],
    }


def _match_method(basis: Mapping[str, Any]) -> str:
    """Describe a catalog match without exposing internal enum names."""
    if basis.get("type") == "normalized_50us":
        return "Timing fingerprint match"
    protocol = str(basis.get("protocol") or "decoded").upper()
    return f"Decoded {protocol} command match"


def _candidate_analysis(
    candidate: IRSignal | Mapping[str, Any],
) -> Mapping[str, Any]:
    if isinstance(candidate, IRSignal):
        return analyze_signal(candidate)
    if isinstance(candidate, Mapping):
        nested = candidate.get("analysis")
        return nested if isinstance(nested, Mapping) else candidate
    raise TypeError("candidate must be an IRSignal or analysis mapping")


def _analysis_fingerprints(analysis: Mapping[str, Any]) -> dict[str, str]:
    raw = analysis.get("fingerprints")
    if not isinstance(raw, Mapping):
        raise IRFormatError("analysis is missing signal fingerprints")
    normalized = _validate_fingerprint(raw.get("normalized_50us"), "normalized_50us")
    exact_value = raw.get("exact")
    fingerprints = {"normalized_50us": normalized}
    if exact_value is not None:
        fingerprints["exact"] = _validate_fingerprint(exact_value, "exact")
    return fingerprints


def _validate_fingerprint(value: Any, name: str) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-fA-F]{64}", value) is None:
        raise IRFormatError(f"{name} must be a SHA-256 fingerprint")
    return value.lower()


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
