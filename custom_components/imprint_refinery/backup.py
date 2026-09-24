"""Portable, installation-neutral Imprint Refinery backup documents."""

from copy import deepcopy
import json
from typing import Any

from .revisions import (
    CURRENT_REVISION,
    REVISION_LABELS,
    REVISIONS,
    command_snapshot,
    initialize_history,
)

BACKUP_SCHEMA = "imprint_refinery.backup"
BACKUP_VERSION = 2
LEGACY_BACKUP_VERSION = 1
MAX_BACKUP_COMMANDS = 500
MAX_REVISIONS_PER_COMMAND = 10_000

_COMMAND_FIELDS = (
    "name",
    "code",
    "format",
    "icon",
    "role",
    "source",
    "signal",
    "analysis",
    "updated_at",
)
_SNAPSHOT_FIELDS = tuple(field for field in _COMMAND_FIELDS if field != "updated_at")
_PRIVATE_KEYS = {
    "area_id",
    "cluster_id",
    "device_id",
    "endpoint_id",
    "entity_id",
    "host",
    "hostname",
    "ieee",
    "infrared_emitter_ref",
    "infrared_receiver_ref",
    "source_command",
    "emitter_id",
    "zha_device",
}


class BackupError(ValueError):
    """Raised when a native backup is malformed."""


def export_backup(
    registry: dict[str, Any],
    *,
    remote_profile_id: str | None = None,
    include_history: bool = True,
) -> dict[str, Any]:
    """Export profiles and optional appliance references without installation data."""
    profiles = registry.get("remote_profiles", {})
    appliances = registry.get("appliances", {})
    if remote_profile_id and remote_profile_id not in profiles:
        raise BackupError(f"remote profile {remote_profile_id!r} was not found")
    selected = (
        {remote_profile_id: profiles[remote_profile_id]}
        if remote_profile_id
        else profiles
    )
    output_profiles: dict[str, Any] = {}
    command_count = 0
    for profile_id, profile in selected.items():
        commands = {
            command_id: _export_command(command, include_history=include_history)
            for command_id, command in profile.get("commands", {}).items()
            if command.get("code")
        }
        command_count += len(commands)
        output_profiles[profile_id] = {
            "name": str(profile.get("name") or profile_id),
            "appliance_type": str(profile.get("appliance_type") or "generic"),
            "commands": commands,
        }
    selected_appliances = {
        appliance_id: {
            "name": str(appliance.get("name") or appliance_id),
            "remote_profile_id": appliance.get("remote_profile_id"),
            "preferred_platform": str(appliance.get("preferred_platform") or "auto"),
        }
        for appliance_id, appliance in appliances.items()
        if not remote_profile_id
        and appliance.get("remote_profile_id") in output_profiles
    }
    return {
        "schema": BACKUP_SCHEMA,
        "version": BACKUP_VERSION,
        "scope": "remote_profile" if remote_profile_id else "library",
        "history": "full" if include_history else "current",
        "command_count": command_count,
        "remote_profiles": output_profiles,
        "appliances": selected_appliances,
    }


def inspect_backup(value: str | dict[str, Any]) -> dict[str, Any]:
    """Validate a backup and return canonical profile/appliance records."""
    document = _load_document(value)
    if document.get("schema") != BACKUP_SCHEMA:
        raise BackupError("document is not an Imprint Refinery backup")
    version = document.get("version")
    if version == LEGACY_BACKUP_VERSION:
        document = _convert_v1_backup(document)
    elif version != BACKUP_VERSION:
        raise BackupError(f"unsupported native backup version: {version!r}")
    return _inspect_v2_backup(document)


def normalize_import_command(
    command: dict[str, Any],
    *,
    created_at: str,
) -> dict[str, Any]:
    """Return one validated command ready for library insertion."""
    normalized = _validate_command(command)
    revisions = normalized.get(REVISIONS, [])
    if revisions:
        return normalized
    normalized.pop(CURRENT_REVISION, None)
    normalized.pop(REVISION_LABELS, None)
    return initialize_history(normalized, created_at=created_at, action="imported")


def _load_document(value: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            document = json.loads(value)
        except json.JSONDecodeError as err:
            raise BackupError(f"invalid native backup JSON: {err.msg}") from err
    else:
        document = deepcopy(value)
    if not isinstance(document, dict):
        raise BackupError("native backup root must be an object")
    return document


def _convert_v1_backup(document: dict[str, Any]) -> dict[str, Any]:
    """Convert each legacy appliance into its own profile and appliance."""
    locations = document.get("locations")
    if not isinstance(locations, dict):
        raise BackupError("native backup locations must be an object")
    profiles: dict[str, Any] = {}
    appliances: dict[str, Any] = {}
    for location_id, location in locations.items():
        if not isinstance(location, dict):
            raise BackupError(f"location {location_id!r} must be an object")
        legacy_appliances = location.get("appliances", {})
        if not isinstance(legacy_appliances, dict):
            raise BackupError(f"location {location_id!r} appliances must be an object")
        for appliance_id, appliance in legacy_appliances.items():
            if not isinstance(appliance, dict):
                raise BackupError(f"appliance {appliance_id!r} must be an object")
            global_id = f"{location_id}__{appliance_id}"
            if global_id in appliances:
                raise BackupError("legacy appliance IDs collide after import")
            profiles[global_id] = {
                "name": str(appliance.get("name") or appliance_id),
                "appliance_type": str(appliance.get("appliance_type") or "generic"),
                "commands": deepcopy(appliance.get("commands", {})),
            }
            appliances[global_id] = {
                "name": str(appliance.get("name") or appliance_id),
                "remote_profile_id": global_id,
                "preferred_platform": str(
                    appliance.get("preferred_platform") or "auto"
                ),
                "area_name": str(location.get("name") or location_id),
            }
    return {
        "schema": BACKUP_SCHEMA,
        "version": BACKUP_VERSION,
        "scope": document.get("scope", "library"),
        "history": document.get("history"),
        "command_count": document.get("command_count"),
        "remote_profiles": profiles,
        "appliances": appliances,
    }


def _inspect_v2_backup(document: dict[str, Any]) -> dict[str, Any]:
    history = document.get("history")
    if history not in {"current", "full"}:
        raise BackupError("native backup history must be 'current' or 'full'")
    profiles = document.get("remote_profiles")
    appliances = document.get("appliances", {})
    if not isinstance(profiles, dict):
        raise BackupError("native backup remote_profiles must be an object")
    if not isinstance(appliances, dict):
        raise BackupError("native backup appliances must be an object")

    normalized_profiles: dict[str, Any] = {}
    commands: list[dict[str, Any]] = []
    for profile_id, profile in profiles.items():
        if not isinstance(profile, dict):
            raise BackupError(f"remote profile {profile_id!r} must be an object")
        source_commands = profile.get("commands", {})
        if not isinstance(source_commands, dict):
            raise BackupError(
                f"remote profile {profile_id!r} commands must be an object"
            )
        normalized_commands: dict[str, Any] = {}
        for command_id, command in source_commands.items():
            if not isinstance(command, dict):
                raise BackupError(f"command {command_id!r} must be an object")
            normalized = _validate_command(command)
            normalized_commands[str(command_id)] = normalized
            commands.append(
                {
                    "remote_profile_id": str(profile_id),
                    "command_id": str(command_id),
                    "command": normalized,
                }
            )
            if len(commands) > MAX_BACKUP_COMMANDS:
                raise BackupError(
                    f"native backup contains more than {MAX_BACKUP_COMMANDS} commands"
                )
        normalized_profiles[str(profile_id)] = {
            "name": str(profile.get("name") or profile_id),
            "appliance_type": str(profile.get("appliance_type") or "generic"),
            "commands": normalized_commands,
        }
    if not commands:
        raise BackupError("native backup contains no commands")
    declared_count = document.get("command_count")
    if declared_count is not None and declared_count != len(commands):
        raise BackupError("native backup command count does not match its contents")

    normalized_appliances: dict[str, Any] = {}
    for appliance_id, appliance in appliances.items():
        if not isinstance(appliance, dict):
            raise BackupError(f"appliance {appliance_id!r} must be an object")
        profile_id = appliance.get("remote_profile_id")
        if profile_id not in normalized_profiles:
            raise BackupError(
                f"appliance {appliance_id!r} references an unknown remote profile"
            )
        normalized_appliances[str(appliance_id)] = _sanitize(
            {
                "name": str(appliance.get("name") or appliance_id),
                "remote_profile_id": str(profile_id),
                "preferred_platform": str(
                    appliance.get("preferred_platform") or "auto"
                ),
                "area_name": appliance.get("area_name"),
            }
        )
    return {
        "schema": BACKUP_SCHEMA,
        "version": BACKUP_VERSION,
        "scope": document.get("scope", "library"),
        "history": history,
        "remote_profiles": normalized_profiles,
        "appliances": normalized_appliances,
        "commands": commands,
    }


def _export_command(
    command: dict[str, Any], *, include_history: bool
) -> dict[str, Any]:
    exported = {
        field: _sanitize(deepcopy(command[field]))
        for field in _COMMAND_FIELDS
        if field in command
    }
    if include_history:
        revisions = []
        for revision in command.get(REVISIONS, []):
            snapshot = {
                field: _sanitize(deepcopy(revision.get("snapshot", {})[field]))
                for field in _SNAPSHOT_FIELDS
                if field in revision.get("snapshot", {})
            }
            item = {
                "revision": revision.get("revision"),
                "created_at": revision.get("created_at"),
                "action": revision.get("action"),
                "parent_revision": revision.get("parent_revision"),
                "snapshot": snapshot,
            }
            details = _sanitize(deepcopy(revision.get("details")))
            if details:
                item["details"] = details
            revisions.append(item)
        exported[CURRENT_REVISION] = command.get(CURRENT_REVISION, 0)
        exported[REVISIONS] = revisions
        labels = command.get(REVISION_LABELS)
        if isinstance(labels, dict) and labels:
            exported[REVISION_LABELS] = {
                str(key): str(value)
                for key, value in labels.items()
                if str(value).strip()
            }
    return exported


def _validate_command(command: dict[str, Any]) -> dict[str, Any]:
    normalized = {
        field: deepcopy(command[field]) for field in _COMMAND_FIELDS if field in command
    }
    code = normalized.get("code")
    if not isinstance(code, str) or not code.strip():
        raise BackupError("native backup command code must be a non-empty string")
    normalized["name"] = str(normalized.get("name") or "Imported command")
    normalized["format"] = str(normalized.get("format") or "raw_signed")
    normalized = _sanitize(normalized)

    revisions = command.get(REVISIONS, [])
    if not isinstance(revisions, list):
        raise BackupError("native backup command revisions must be a list")
    if len(revisions) > MAX_REVISIONS_PER_COMMAND:
        raise BackupError(
            f"native backup command exceeds {MAX_REVISIONS_PER_COMMAND} revisions"
        )
    if revisions:
        normalized[REVISIONS] = _validate_revisions(revisions)
        current = command.get(CURRENT_REVISION)
        revision_ids = {item["revision"] for item in normalized[REVISIONS]}
        if current not in revision_ids:
            raise BackupError("current revision is missing from command history")
        normalized[CURRENT_REVISION] = current
        current_snapshot = next(
            item["snapshot"]
            for item in normalized[REVISIONS]
            if item["revision"] == current
        )
        if command_snapshot(normalized) != current_snapshot:
            raise BackupError("current command does not match its current revision")
        labels = command.get(REVISION_LABELS, {})
        if not isinstance(labels, dict):
            raise BackupError("revision labels must be an object")
        unknown_labels = set(labels) - {str(value) for value in revision_ids}
        if unknown_labels:
            raise BackupError("revision label refers to an unknown revision")
        if labels:
            normalized[REVISION_LABELS] = {
                str(key): str(value)
                for key, value in labels.items()
                if str(value).strip()
            }
    return normalized


def _validate_revisions(revisions: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    seen: set[int] = set()
    for revision in revisions:
        if not isinstance(revision, dict):
            raise BackupError("native backup revision must be an object")
        revision_id = revision.get("revision")
        if not isinstance(revision_id, int) or revision_id < 1 or revision_id in seen:
            raise BackupError(
                "native backup revision IDs must be unique positive integers"
            )
        seen.add(revision_id)
        snapshot = revision.get("snapshot")
        if not isinstance(snapshot, dict) or not snapshot.get("code"):
            raise BackupError("native backup revision snapshot is incomplete")
        item = {
            "revision": revision_id,
            "created_at": revision.get("created_at"),
            "action": str(revision.get("action") or "imported"),
            "parent_revision": revision.get("parent_revision"),
            "snapshot": _sanitize(
                {
                    field: deepcopy(snapshot[field])
                    for field in _SNAPSHOT_FIELDS
                    if field in snapshot
                }
            ),
        }
        if revision.get("details"):
            item["details"] = _sanitize(deepcopy(revision["details"]))
        normalized.append(item)
    for item in normalized:
        parent = item["parent_revision"]
        if parent is not None and parent not in seen:
            raise BackupError("native backup revision parent is missing")
    return normalized


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _sanitize(item)
            for key, item in value.items()
            if str(key).lower() not in _PRIVATE_KEYS
        }
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
