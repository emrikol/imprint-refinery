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
BACKUP_VERSION = 1
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
    "cluster_id",
    "endpoint_id",
    "entity_id",
    "host",
    "hostname",
    "ieee",
    "source_command",
    "emitter_id",
    "zha_device",
}


class BackupError(ValueError):
    """Raised when a native backup is malformed."""


def export_backup(
    registry: dict[str, Any],
    *,
    location_id: str | None = None,
    appliance_id: str | None = None,
    include_history: bool = True,
) -> dict[str, Any]:
    """Export a library, location, or appliance without installation data."""
    locations = registry.get("locations", {})
    if appliance_id and not location_id:
        raise BackupError("appliance_id requires location_id")
    if location_id and location_id not in locations:
        raise BackupError(f"location {location_id!r} was not found")

    selected_locations = (
        {location_id: locations[location_id]} if location_id else locations
    )
    output_locations: dict[str, Any] = {}
    command_count = 0
    for current_location_id, location in selected_locations.items():
        appliances = location.get("appliances", {})
        if appliance_id:
            if appliance_id not in appliances:
                raise BackupError(f"appliance {appliance_id!r} was not found")
            appliances = {appliance_id: appliances[appliance_id]}
        output_appliances: dict[str, Any] = {}
        for current_appliance_id, appliance in appliances.items():
            commands = {
                command_id: _export_command(command, include_history=include_history)
                for command_id, command in appliance.get("commands", {}).items()
                if command.get("code")
            }
            command_count += len(commands)
            output_appliances[current_appliance_id] = {
                "name": str(appliance.get("name") or current_appliance_id),
                "appliance_type": str(appliance.get("appliance_type") or "generic"),
                "preferred_platform": str(
                    appliance.get("preferred_platform") or "auto"
                ),
                "commands": commands,
            }
        output_locations[current_location_id] = {
            "name": str(location.get("name") or current_location_id),
            "appliances": output_appliances,
        }

    scope = "appliance" if appliance_id else "location" if location_id else "library"
    return {
        "schema": BACKUP_SCHEMA,
        "version": BACKUP_VERSION,
        "scope": scope,
        "history": "full" if include_history else "current",
        "command_count": command_count,
        "locations": output_locations,
    }


def inspect_backup(value: str | dict[str, Any]) -> dict[str, Any]:
    """Validate a native backup and flatten its commands for an import preview."""
    document = _load_document(value)
    if document.get("schema") != BACKUP_SCHEMA:
        raise BackupError("document is not an Imprint Refinery backup")
    return _inspect_versioned_backup(document)


def normalize_import_command(
    command: dict[str, Any],
    *,
    created_at: str,
) -> dict[str, Any]:
    """Return one validated command ready for registry insertion."""
    normalized = _validate_command(command)
    revisions = normalized.get(REVISIONS, [])
    if revisions:
        return normalized

    normalized.pop(CURRENT_REVISION, None)
    normalized.pop(REVISION_LABELS, None)
    return initialize_history(
        normalized,
        created_at=created_at,
        action="imported",
    )


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


def _inspect_versioned_backup(document: dict[str, Any]) -> dict[str, Any]:
    if document.get("version") != BACKUP_VERSION:
        raise BackupError(
            f"unsupported native backup version: {document.get('version')!r}"
        )
    history = document.get("history")
    if history not in {"current", "full"}:
        raise BackupError("native backup history must be 'current' or 'full'")
    locations = document.get("locations")
    if not isinstance(locations, dict):
        raise BackupError("native backup locations must be an object")

    commands: list[dict[str, Any]] = []
    for location_id, location in locations.items():
        if not isinstance(location, dict):
            raise BackupError(f"location {location_id!r} must be an object")
        appliances = location.get("appliances", {})
        if not isinstance(appliances, dict):
            raise BackupError(f"location {location_id!r} appliances must be an object")
        for appliance_id, appliance in appliances.items():
            if not isinstance(appliance, dict):
                raise BackupError(f"appliance {appliance_id!r} must be an object")
            device_commands = appliance.get("commands", {})
            if not isinstance(device_commands, dict):
                raise BackupError(
                    f"appliance {appliance_id!r} commands must be an object"
                )
            for command_id, command in device_commands.items():
                if not isinstance(command, dict):
                    raise BackupError(f"command {command_id!r} must be an object")
                normalized = _validate_command(command)
                commands.append(
                    {
                        "location_id": str(location_id),
                        "location_name": str(location.get("name") or location_id),
                        "appliance_id": str(appliance_id),
                        "appliance_name": str(appliance.get("name") or appliance_id),
                        "appliance_type": str(
                            appliance.get("appliance_type") or "generic"
                        ),
                        "preferred_platform": str(
                            appliance.get("preferred_platform") or "auto"
                        ),
                        "command_id": str(command_id),
                        "command": normalized,
                    }
                )
                if len(commands) > MAX_BACKUP_COMMANDS:
                    raise BackupError(
                        f"native backup contains more than {MAX_BACKUP_COMMANDS} commands"
                    )
    if not commands:
        raise BackupError("native backup contains no commands")
    declared_count = document.get("command_count")
    if declared_count is not None and declared_count != len(commands):
        raise BackupError("native backup command count does not match its contents")
    return {
        "schema": BACKUP_SCHEMA,
        "version": BACKUP_VERSION,
        "scope": document.get("scope", "library"),
        "history": history,
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
