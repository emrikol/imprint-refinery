"""Pure append-only command revision helpers."""

from copy import deepcopy
from typing import Any

CURRENT_REVISION = "current_revision"
REVISIONS = "revisions"
REVISION_LABELS = "revision_labels"

_SNAPSHOT_FIELDS = (
    "name",
    "code",
    "format",
    "icon",
    "role",
    "source",
    "signal",
    "analysis",
)


def command_snapshot(command: dict[str, Any]) -> dict[str, Any]:
    """Return the immutable user-visible state stored in one revision."""
    return {
        field: deepcopy(command[field])
        for field in _SNAPSHOT_FIELDS
        if field in command
    }


def initialize_history(
    command: dict[str, Any],
    *,
    created_at: str | None,
    action: str = "migrated",
) -> dict[str, Any]:
    """Add revision 1 to a legacy command without mutating the input."""
    migrated = deepcopy(command)
    revisions = migrated.get(REVISIONS, [])
    if revisions:
        snapshot = command_snapshot(migrated)
        matching = [
            revision["revision"]
            for revision in revisions
            if isinstance(revision.get("revision"), int)
            and revision.get("snapshot") == snapshot
        ]
        if matching:
            migrated[CURRENT_REVISION] = max(matching)
            _normalize_revision_labels(migrated)
            return migrated

        latest = _latest_revision_id(migrated)
        current = migrated.get(CURRENT_REVISION)
        valid_ids = {
            revision.get("revision")
            for revision in revisions
            if isinstance(revision.get("revision"), int)
        }
        migrated[CURRENT_REVISION] = current if current in valid_ids else latest
        if migrated.get("code"):
            append_revision(
                migrated,
                created_at=created_at,
                action=action,
                force=True,
            )
        else:
            selected = find_revision(migrated, migrated[CURRENT_REVISION])
            for field in _SNAPSHOT_FIELDS:
                if field in selected["snapshot"]:
                    migrated[field] = deepcopy(selected["snapshot"][field])
                else:
                    migrated.pop(field, None)
        _normalize_revision_labels(migrated)
        return migrated

    if not migrated.get("code"):
        migrated[CURRENT_REVISION] = 0
        migrated[REVISIONS] = []
        migrated.pop(REVISION_LABELS, None)
        return migrated

    migrated[CURRENT_REVISION] = 1
    migrated[REVISIONS] = [
        {
            "revision": 1,
            "created_at": created_at,
            "action": action,
            "parent_revision": None,
            "snapshot": command_snapshot(migrated),
        }
    ]
    _normalize_revision_labels(migrated)
    return migrated


def append_revision(
    command: dict[str, Any],
    *,
    created_at: str | None,
    action: str,
    details: dict[str, Any] | None = None,
    force: bool = False,
) -> bool:
    """Append the current command state and return whether history changed."""
    revisions = command.setdefault(REVISIONS, [])
    latest_revision = _latest_revision_id(command)
    valid_ids = {
        revision.get("revision")
        for revision in revisions
        if isinstance(revision.get("revision"), int)
    }
    current_revision = command.get(CURRENT_REVISION)
    if current_revision not in valid_ids:
        current_revision = latest_revision
        command[CURRENT_REVISION] = current_revision
    if not command.get("code"):
        return False

    snapshot = command_snapshot(command)
    if current_revision and not force:
        current = find_revision(command, current_revision)
        if current.get("snapshot") == snapshot:
            return False

    parent_revision = current_revision or None
    revision_id = max(latest_revision + 1, 1)
    revision = {
        "revision": revision_id,
        "created_at": created_at,
        "action": action,
        "parent_revision": parent_revision,
        "snapshot": snapshot,
    }
    if details:
        revision["details"] = deepcopy(details)
    revisions.append(revision)
    command[CURRENT_REVISION] = revision_id
    return True


def restore_revision(
    command: dict[str, Any],
    revision_id: int,
    *,
    created_at: str,
) -> None:
    """Restore a snapshot and append the restored state as a new revision."""
    revision = find_revision(command, revision_id)
    snapshot = deepcopy(revision["snapshot"])
    for field in _SNAPSHOT_FIELDS:
        if field in snapshot:
            command[field] = snapshot[field]
        else:
            command.pop(field, None)
    command["updated_at"] = created_at
    append_revision(
        command,
        created_at=created_at,
        action="restored",
        details={"restored_from_revision": revision_id},
        force=True,
    )
    set_revision_label(
        command,
        command[CURRENT_REVISION],
        f"Restored from revision {revision_id}",
    )


def find_revision(command: dict[str, Any], revision_id: int) -> dict[str, Any]:
    """Return a revision by numeric id."""
    for revision in command.get(REVISIONS, []):
        if revision.get("revision") == revision_id:
            return revision
    raise KeyError(revision_id)


def set_revision_label(command: dict[str, Any], revision_id: int, label: str) -> None:
    """Set mutable display metadata without altering an immutable revision."""
    find_revision(command, revision_id)
    labels = command.setdefault(REVISION_LABELS, {})
    normalized = label.strip()
    if normalized:
        labels[str(revision_id)] = normalized
    else:
        labels.pop(str(revision_id), None)
    if not labels:
        command.pop(REVISION_LABELS, None)


def command_history(command: dict[str, Any]) -> list[dict[str, Any]]:
    """Return immutable revisions with display metadata and explicit lineage."""
    labels = command.get(REVISION_LABELS, {})
    revisions = deepcopy(command.get(REVISIONS, []))
    current_revision = command.get(CURRENT_REVISION, 0)
    revisions_by_id = {
        revision.get("revision"): revision
        for revision in revisions
        if isinstance(revision.get("revision"), int)
    }
    for revision in revisions:
        label = labels.get(str(revision.get("revision")))
        if label:
            revision["label"] = label
        revision["is_current"] = revision.get("revision") == current_revision
        revision["lineage"] = _revision_lineage(revision, revisions_by_id)
    return revisions


def _revision_lineage(
    revision: dict[str, Any],
    revisions_by_id: dict[int, dict[str, Any]],
) -> list[int]:
    """Return root-to-revision ancestry without trusting malformed cycles."""
    lineage: list[int] = []
    seen: set[int] = set()
    current: dict[str, Any] | None = revision
    while current is not None:
        revision_id = current.get("revision")
        if not isinstance(revision_id, int) or revision_id in seen:
            break
        seen.add(revision_id)
        lineage.append(revision_id)
        parent_id = current.get("parent_revision")
        current = revisions_by_id.get(parent_id) if isinstance(parent_id, int) else None
    lineage.reverse()
    return lineage


def command_without_history(command: dict[str, Any]) -> dict[str, Any]:
    """Return current state plus compact history metadata for list responses."""
    public = deepcopy(command)
    revisions = public.pop(REVISIONS, [])
    public.pop(REVISION_LABELS, None)
    public["revision_count"] = len(revisions)
    public.setdefault(CURRENT_REVISION, revisions[-1]["revision"] if revisions else 0)
    return public


def _latest_revision_id(command: dict[str, Any]) -> int:
    """Return the largest valid revision id in a command."""
    return max(
        (
            revision.get("revision", 0)
            for revision in command.get(REVISIONS, [])
            if isinstance(revision.get("revision"), int)
        ),
        default=0,
    )


def _normalize_revision_labels(command: dict[str, Any]) -> None:
    """Keep mutable labels limited to revisions that still exist."""
    labels = command.get(REVISION_LABELS)
    if not isinstance(labels, dict):
        command.pop(REVISION_LABELS, None)
        return
    valid_ids = {
        str(revision.get("revision")) for revision in command.get(REVISIONS, [])
    }
    normalized = {
        str(revision_id): str(label).strip()
        for revision_id, label in labels.items()
        if str(revision_id) in valid_ids and str(label).strip()
    }
    if normalized:
        command[REVISION_LABELS] = normalized
    else:
        command.pop(REVISION_LABELS, None)
