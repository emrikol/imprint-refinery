"""Pure domain model for the Imprint Refinery command library."""

from copy import deepcopy
import re
from typing import Any

from .const import ERROR_COMMAND_NOT_FOUND, ERROR_STORAGE_ERROR
from .errors import ImprintRefineryError
from .ir_formats import encode_raw, signal_document
from .product_spec import AUTOMATIC_PLATFORM, PLATFORM_PREFERENCES, SIGNAL_ROLES
from .revisions import (
    CURRENT_REVISION,
    REVISION_LABELS,
    REVISIONS,
    append_revision,
    command_history,
    command_without_history,
    initialize_history,
    restore_revision,
    set_revision_label,
)
from .signal_command import decoded_signal_from_command

LIBRARY_SCHEMA = "imprint_refinery.library"
LIBRARY_VERSION = 3
LEGACY_LIBRARY_VERSION = 2
_SLUG = re.compile(r"[a-z0-9_]+")
_MISSING = object()


def empty_library() -> dict[str, Any]:
    """Create a new canonical v3 library document."""
    return {
        "schema": LIBRARY_SCHEMA,
        "version": LIBRARY_VERSION,
        "remote_profiles": {},
        "appliances": {},
    }


def load_library(value: Any) -> dict[str, Any]:
    """Validate and detach a persisted v3 library document."""
    return _validate_v3(value)


def migrate_v2_to_v3(
    value: Any,
    *,
    emitter_refs: dict[str, str] | None = None,
    sole_emitter_ref: str | None = None,
) -> dict[str, Any]:
    """Convert a v2 location library into independent profiles and appliances."""
    if not isinstance(value, dict):
        _fail("Stored library root must be an object")
    if value.get("schema") != LIBRARY_SCHEMA:
        _fail("Stored library does not use the Imprint Refinery schema")
    if value.get("version") == LIBRARY_VERSION:
        return _validate_v3(value)
    if value.get("version") != LEGACY_LIBRARY_VERSION:
        _fail(f"Unsupported stored library version: {value.get('version')!r}")
    if not isinstance(value.get("emitters"), dict):
        _fail("Stored library emitters must be an object")
    if not isinstance(value.get("locations"), dict):
        _fail("Stored library locations must be an object")

    references = emitter_refs or {}
    remote_profiles: dict[str, dict[str, Any]] = {}
    appliances: dict[str, dict[str, Any]] = {}
    for location_id, location in value["locations"].items():
        if not isinstance(location, dict) or not isinstance(
            location.get("appliances", {}), dict
        ):
            _fail(f"Stored location {location_id} is invalid")
        for appliance_id, legacy in location.get("appliances", {}).items():
            if not isinstance(legacy, dict):
                _fail(f"Stored appliance {location_id}/{appliance_id} is invalid")
            global_id = f"{location_id}__{appliance_id}"
            if global_id in appliances:
                _fail(
                    "Legacy appliance IDs collide after migration: "
                    f"{location_id}/{appliance_id}"
                )
            legacy_emitter = legacy.get("emitter_id")
            emitter_ref = (
                references.get(str(legacy_emitter))
                if legacy_emitter
                else sole_emitter_ref
            )
            remote_profiles[global_id] = {
                "name": str(legacy.get("name") or appliance_id),
                "appliance_type": str(legacy.get("appliance_type") or "generic"),
                "commands": deepcopy(legacy.get("commands") or {}),
            }
            appliances[global_id] = {
                "name": str(legacy.get("name") or appliance_id),
                "remote_profile_id": global_id,
                "infrared_emitter_ref": emitter_ref,
                "preferred_platform": str(
                    legacy.get("preferred_platform") or AUTOMATIC_PLATFORM
                ),
            }

    return _validate_v3(
        {
            "schema": LIBRARY_SCHEMA,
            "version": LIBRARY_VERSION,
            "remote_profiles": remote_profiles,
            "appliances": appliances,
        }
    )


def _validate_v3(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail("Stored library root must be an object")
    if value.get("schema") != LIBRARY_SCHEMA:
        _fail("Stored library does not use the Imprint Refinery schema")
    if value.get("version") != LIBRARY_VERSION:
        _fail(f"Unsupported stored library version: {value.get('version')!r}")
    profiles = value.get("remote_profiles")
    appliances = value.get("appliances")
    if not isinstance(profiles, dict):
        _fail("Stored library remote_profiles must be an object")
    if not isinstance(appliances, dict):
        _fail("Stored library appliances must be an object")
    for profile_id, profile in profiles.items():
        _require_slug(str(profile_id), "remote_profile_id")
        if not isinstance(profile, dict) or not isinstance(
            profile.get("commands", {}), dict
        ):
            _fail(f"Stored remote profile {profile_id} is invalid")
    for appliance_id, appliance in appliances.items():
        _require_slug(str(appliance_id), "appliance_id")
        if not isinstance(appliance, dict):
            _fail(f"Stored appliance {appliance_id} is invalid")
        profile_id = appliance.get("remote_profile_id")
        if profile_id is not None and profile_id not in profiles:
            _fail(
                f"Appliance {appliance_id} references missing remote profile "
                f"{profile_id}"
            )
        preference = str(appliance.get("preferred_platform") or AUTOMATIC_PLATFORM)
        _require_member(preference, PLATFORM_PREFERENCES, "preferred_platform")
    return deepcopy(value)


def _canonicalize_command(command: dict[str, Any]) -> None:
    if not command.get("signal") and not command.get("code"):
        return
    decoded = decoded_signal_from_command(command)
    signal = decoded.signal
    command["code"] = encode_raw(signal, signed=True)
    command["format"] = "raw_signed"
    command["signal"] = signal_document(signal, decoded.carrier_source)


def _canonicalize_command_history(command: dict[str, Any]) -> None:
    _canonicalize_command(command)
    for revision in command.get(REVISIONS, []):
        snapshot = revision.get("snapshot")
        if isinstance(snapshot, dict):
            _canonicalize_command(snapshot)


def _fail(message: str, code: str = ERROR_STORAGE_ERROR) -> None:
    raise ImprintRefineryError(code, message)


def _require_slug(value: str, field: str) -> None:
    if _SLUG.fullmatch(value) is None:
        _fail(f"{field} must match [a-z0-9_]+")


def _require_member(value: str, allowed: tuple[str, ...], field: str) -> None:
    if value not in allowed:
        _fail(f"{field} must be one of: {', '.join(allowed)}")


def _put_optional(target: dict[str, Any], field: str, value: Any) -> None:
    if value:
        target[field] = value
    else:
        target.pop(field, None)


class SignalLibrary:
    """Mutable v3 domain object with no Home Assistant dependency."""

    def __init__(self, document: dict[str, Any] | None = None) -> None:
        self.document = empty_library() if document is None else load_library(document)

    def put_remote_profile(
        self,
        remote_profile_id: str,
        name: str,
        appliance_type: str = "generic",
    ) -> None:
        _require_slug(remote_profile_id, "remote_profile_id")
        profile = self.document["remote_profiles"].setdefault(
            remote_profile_id,
            {"name": name, "appliance_type": appliance_type, "commands": {}},
        )
        profile["name"] = name
        profile["appliance_type"] = appliance_type
        profile.setdefault("commands", {})

    def patch_remote_profile(
        self,
        remote_profile_id: str,
        *,
        name: Any = _MISSING,
        appliance_type: Any = _MISSING,
    ) -> None:
        profile = self.remote_profile(remote_profile_id)
        if name is not _MISSING:
            profile["name"] = name
        if appliance_type is not _MISSING:
            profile["appliance_type"] = appliance_type

    def duplicate_remote_profile(
        self, source_id: str, target_id: str, name: str
    ) -> None:
        _require_slug(target_id, "remote_profile_id")
        if target_id in self.document["remote_profiles"]:
            _fail(f"Remote profile {target_id} already exists")
        duplicate = deepcopy(self.remote_profile(source_id))
        duplicate["name"] = name
        self.document["remote_profiles"][target_id] = duplicate

    def profile_dependents(self, remote_profile_id: str) -> list[str]:
        self.remote_profile(remote_profile_id)
        return sorted(
            appliance_id
            for appliance_id, appliance in self.document["appliances"].items()
            if appliance.get("remote_profile_id") == remote_profile_id
        )

    def remove_remote_profile(self, remote_profile_id: str, *, confirmed: bool) -> None:
        if not confirmed:
            _fail("delete_remote_profile requires confirm: true")
        dependents = self.profile_dependents(remote_profile_id)
        if dependents:
            _fail(
                f"Remote profile {remote_profile_id} is used by: "
                + ", ".join(dependents)
            )
        del self.document["remote_profiles"][remote_profile_id]

    def put_appliance(
        self,
        appliance_id: str,
        name: str,
        *,
        remote_profile_id: str | None = None,
        infrared_emitter_ref: str | None = None,
        preferred_platform: str = AUTOMATIC_PLATFORM,
    ) -> None:
        _require_slug(appliance_id, "appliance_id")
        _require_member(preferred_platform, PLATFORM_PREFERENCES, "preferred_platform")
        if remote_profile_id is not None:
            self.remote_profile(remote_profile_id)
        self.document["appliances"][appliance_id] = {
            "name": name,
            "remote_profile_id": remote_profile_id,
            "infrared_emitter_ref": infrared_emitter_ref,
            "preferred_platform": preferred_platform,
        }

    def patch_appliance(
        self,
        appliance_id: str,
        *,
        name: Any = _MISSING,
        remote_profile_id: Any = _MISSING,
        infrared_emitter_ref: Any = _MISSING,
        preferred_platform: Any = _MISSING,
    ) -> None:
        appliance = self.appliance(appliance_id)
        if remote_profile_id not in (_MISSING, None, ""):
            self.remote_profile(str(remote_profile_id))
        if preferred_platform is not _MISSING:
            _require_member(
                str(preferred_platform),
                PLATFORM_PREFERENCES,
                "preferred_platform",
            )
        changes = {
            "name": name,
            "remote_profile_id": (
                None if remote_profile_id == "" else remote_profile_id
            ),
            "infrared_emitter_ref": (
                None if infrared_emitter_ref == "" else infrared_emitter_ref
            ),
            "preferred_platform": preferred_platform,
        }
        for field, field_value in changes.items():
            if field_value is not _MISSING:
                appliance[field] = field_value

    def remove_appliance(self, appliance_id: str, *, confirmed: bool) -> None:
        if not confirmed:
            _fail("delete_appliance requires confirm: true")
        self.appliance(appliance_id)
        del self.document["appliances"][appliance_id]

    def put_command_placeholder(
        self,
        remote_profile_id: str,
        command_id: str,
        name: str,
        role: str | None,
        *,
        timestamp: str,
    ) -> None:
        _require_slug(command_id, "command_id")
        if role:
            _require_member(role, SIGNAL_ROLES, "role")
        commands = self.remote_profile(remote_profile_id).setdefault("commands", {})
        command = commands.setdefault(command_id, {})
        for field, value in {
            "code": "",
            "format": "raw_signed",
            CURRENT_REVISION: 0,
            REVISIONS: [],
        }.items():
            command.setdefault(field, value)
        command["name"] = name
        if role is not None:
            _put_optional(command, "role", role)
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="metadata_updated")

    def set_command_name(
        self,
        remote_profile_id: str,
        command_id: str,
        name: str,
        *,
        timestamp: str,
    ) -> None:
        command = self.command(remote_profile_id, command_id)
        if command.get("name") == name:
            return
        command["name"] = name
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="renamed")

    def remove_command(self, remote_profile_id: str, command_id: str) -> None:
        self.command(remote_profile_id, command_id)
        del self.remote_profile(remote_profile_id)["commands"][command_id]

    def move_command(
        self,
        remote_profile_id: str,
        command_id: str,
        target_remote_profile_id: str,
    ) -> None:
        if remote_profile_id == target_remote_profile_id:
            return
        source = self.remote_profile(remote_profile_id)["commands"]
        item = self.command(remote_profile_id, command_id)
        target = self.remote_profile(target_remote_profile_id).setdefault(
            "commands", {}
        )
        if command_id in target:
            _fail(f"Command {command_id} already exists in the destination profile")
        target[command_id] = item
        del source[command_id]

    def duplicate_command(
        self,
        remote_profile_id: str,
        command_id: str,
        target_remote_profile_id: str,
        target_command_id: str,
        name: str,
        *,
        timestamp: str,
    ) -> None:
        """Copy the current command into an independent revision history."""
        _require_slug(target_command_id, "target_command_id")
        source = self.command(remote_profile_id, command_id)
        target = self.remote_profile(target_remote_profile_id).setdefault(
            "commands", {}
        )
        if target_command_id in target:
            _fail(
                f"Command {target_command_id} already exists in the destination profile"
            )
        duplicate = {
            field: deepcopy(source[field])
            for field in (
                "code",
                "format",
                "icon",
                "role",
                "source",
                "signal",
                "analysis",
            )
            if field in source
        }
        duplicate.update(
            {
                "name": name,
                "updated_at": timestamp,
                CURRENT_REVISION: 0,
                REVISIONS: [],
            }
        )
        _canonicalize_command(duplicate)
        append_revision(
            duplicate,
            created_at=timestamp,
            action="duplicated",
            details={
                "source_remote_profile_id": remote_profile_id,
                "source_command_id": command_id,
            },
            force=True,
        )
        target[target_command_id] = duplicate

    def store_command(
        self,
        remote_profile_id: str,
        command_id: str,
        *,
        name: str,
        code: str,
        code_format: str,
        source: dict[str, Any] | None,
        role: str | None,
        signal: dict[str, Any] | None,
        analysis: dict[str, Any] | None,
        timestamp: str,
    ) -> None:
        if not code:
            _fail("code must not be empty")
        _require_slug(remote_profile_id, "remote_profile_id")
        _require_slug(command_id, "command_id")
        if role:
            _require_member(role, SIGNAL_ROLES, "role")
        commands = self.remote_profile(remote_profile_id).setdefault("commands", {})
        previous = commands.get(command_id, {})
        history = (
            initialize_history(
                previous,
                created_at=previous.get("updated_at"),
                action="recovered",
            )
            if previous.get("code")
            else previous
        )
        command = {
            "name": name,
            "code": code,
            "format": code_format,
            "updated_at": timestamp,
            CURRENT_REVISION: history.get(CURRENT_REVISION, 0),
            REVISIONS: deepcopy(history.get(REVISIONS, [])),
        }
        for preserved in (REVISION_LABELS, "icon"):
            if history.get(preserved):
                command[preserved] = deepcopy(history[preserved])
        selected_role = history.get("role") if role is None else role
        if selected_role:
            command["role"] = selected_role
        for field, field_value in (
            ("source", source),
            ("signal", signal),
            ("analysis", analysis),
        ):
            if field_value is not None:
                command[field] = deepcopy(field_value)
        _canonicalize_command(command)
        origin = (source or {}).get("type")
        action = {
            "catalog": "imported",
            "import": "imported",
            "protocol": "generated",
            "signal_lab": "signal_lab_saved",
            "duplicate": "duplicated",
        }.get(origin, "replaced" if history.get("code") else "captured")
        append_revision(command, created_at=timestamp, action=action, force=True)
        commands[command_id] = command

    def patch_command(
        self,
        remote_profile_id: str,
        command_id: str,
        *,
        name: Any = _MISSING,
        icon: Any = _MISSING,
        role: Any = _MISSING,
        timestamp: str,
    ) -> None:
        if role not in (_MISSING, None, ""):
            _require_member(role, SIGNAL_ROLES, "role")
        command = self.command(remote_profile_id, command_id)
        desired_name = command.get("name") if name is _MISSING else name
        desired_icon = command.get("icon") if icon is _MISSING else icon or None
        desired_role = command.get("role") if role is _MISSING else role or None
        if (
            desired_name == command.get("name")
            and desired_icon == command.get("icon")
            and desired_role == command.get("role")
        ):
            return
        command["name"] = desired_name
        _put_optional(command, "icon", desired_icon)
        _put_optional(command, "role", desired_role)
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="metadata_updated")

    def restore_command(
        self,
        remote_profile_id: str,
        command_id: str,
        revision_id: int,
        *,
        timestamp: str,
    ) -> int:
        command = self.command(remote_profile_id, command_id)
        try:
            restore_revision(command, revision_id, created_at=timestamp)
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Revision {revision_id} was not found"
            ) from error
        return int(command[CURRENT_REVISION])

    def label_revision(
        self,
        remote_profile_id: str,
        command_id: str,
        revision_id: int,
        label: str,
    ) -> None:
        try:
            set_revision_label(
                self.command(remote_profile_id, command_id), revision_id, label
            )
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Revision {revision_id} was not found"
            ) from error

    def insert_imported_command(
        self,
        remote_profile_id: str,
        command_id: str,
        command: dict[str, Any],
    ) -> None:
        _require_slug(command_id, "command_id")
        commands = self.remote_profile(remote_profile_id).setdefault("commands", {})
        if command_id in commands:
            _fail(f"Command {command_id} already exists")
        if command.get("role"):
            _require_member(command["role"], SIGNAL_ROLES, "role")
        imported = deepcopy(command)
        _canonicalize_command_history(imported)
        commands[command_id] = imported

    def history(self, remote_profile_id: str, command_id: str) -> dict[str, Any]:
        command = self.command(remote_profile_id, command_id)
        return {
            "current_revision": command.get(CURRENT_REVISION, 0),
            "revisions": command_history(command),
        }

    def public_view(self) -> dict[str, Any]:
        profiles = deepcopy(self.document["remote_profiles"])
        for profile_id, profile in profiles.items():
            profile["commands"] = {
                key: command_without_history(command)
                for key, command in profile.get("commands", {}).items()
            }
            profile["dependent_appliance_ids"] = self.profile_dependents(profile_id)
        return {
            "remote_profiles": profiles,
            "appliances": deepcopy(self.document["appliances"]),
        }

    def remote_profile(self, remote_profile_id: str) -> dict[str, Any]:
        try:
            return self.document["remote_profiles"][remote_profile_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND,
                f"Remote profile {remote_profile_id} was not found",
            ) from error

    def appliance(self, appliance_id: str) -> dict[str, Any]:
        try:
            return self.document["appliances"][appliance_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND,
                f"IR appliance {appliance_id} was not found",
            ) from error

    def command(self, remote_profile_id: str, command_id: str) -> dict[str, Any]:
        try:
            return self.remote_profile(remote_profile_id)["commands"][command_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Command {command_id} was not found"
            ) from error

    def command_for_appliance(
        self, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        appliance = self.appliance(appliance_id)
        remote_profile_id = appliance.get("remote_profile_id")
        if not remote_profile_id:
            _fail(
                f"IR appliance {appliance_id} has no remote profile",
                ERROR_COMMAND_NOT_FOUND,
            )
        return self.command(str(remote_profile_id), command_id)
