"""Pure domain model for an Imprint Refinery signal library."""

from copy import deepcopy
import re
from typing import Any

from .const import (
    ERROR_COMMAND_NOT_FOUND,
    ERROR_EMITTER_NOT_CONFIGURED,
    ERROR_EMITTER_REQUIRED,
    ERROR_EMITTER_UNAVAILABLE,
    ERROR_STORAGE_ERROR,
    HOME_ASSISTANT_IR,
    ZHA_BRIDGE,
)
from .emitter_identity import normalize_emitter_ref
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
LIBRARY_VERSION = 2
_SLUG = re.compile(r"[a-z0-9_]+")
_MISSING = object()


def empty_library() -> dict[str, Any]:
    """Create a new canonical library document."""
    return {
        "schema": LIBRARY_SCHEMA,
        "version": LIBRARY_VERSION,
        "emitters": {},
        "locations": {},
    }


def load_library(value: Any) -> dict[str, Any]:
    """Validate and detach a persisted library document."""
    if not isinstance(value, dict):
        _fail("Stored library root must be an object")
    if value.get("schema") != LIBRARY_SCHEMA:
        _fail("Stored library does not use the Imprint Refinery schema")
    if value.get("version") != LIBRARY_VERSION:
        _fail(f"Unsupported stored library version: {value.get('version')!r}")
    for collection in ("emitters", "locations"):
        if not isinstance(value.get(collection), dict):
            _fail(f"Stored library {collection} must be an object")
    return deepcopy(value)


def _canonicalize_command(command: dict[str, Any]) -> None:
    """Replace a transport payload with the canonical raw timing representation."""
    if not command.get("signal") and not command.get("code"):
        return
    decoded = decoded_signal_from_command(command)
    signal = decoded.signal
    command["code"] = encode_raw(signal, signed=True)
    command["format"] = "raw_signed"
    command["signal"] = signal_document(signal, decoded.carrier_source)


def _canonicalize_command_history(command: dict[str, Any]) -> None:
    """Canonicalize the current command and every retained revision."""
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


def _fallback_emitter_name(name: Any, ieee: str) -> bool:
    if not name:
        return True
    text = str(name).strip()
    prefix = "IR emitter "
    if not text.casefold().startswith(prefix.casefold()):
        return False
    return normalize_emitter_ref(text[len(prefix) :]) == normalize_emitter_ref(ieee)


def _put_optional(target: dict[str, Any], field: str, value: Any) -> None:
    if value:
        target[field] = value
    else:
        target.pop(field, None)


class SignalLibrary:
    """Mutable domain object with no Home Assistant or persistence dependency."""

    def __init__(self, document: dict[str, Any] | None = None) -> None:
        self.document = empty_library() if document is None else load_library(document)

    def upsert_emitter(self, values: dict[str, Any]) -> str:
        transport = str(values.get("transport") or ZHA_BRIDGE)
        ieee = str(values.get("ieee") or "")
        key = str(values.get("key") or normalize_emitter_ref(ieee))
        emitters = self.document["emitters"]
        previous = emitters.get(key, {})
        discovered = values.get("name")
        if values.get("name_authoritative") and discovered:
            display_name = discovered
        elif _fallback_emitter_name(previous.get("name"), ieee or key):
            display_name = discovered or f"IR emitter {ieee or key}"
        else:
            display_name = previous.get("name")
        config = deepcopy(values.get("config") or previous.get("config") or {})
        for source, target in (
            ("endpoint_id", "endpoint_id"),
            ("cluster_id", "control_cluster"),
            ("capture_timeout", "capture_timeout"),
            ("capture_reassert_interval", "capture_reassert_interval"),
        ):
            if source in values:
                config[target] = values[source]
        record = {
            "transport": transport,
            "name": display_name,
            "manufacturer": values.get("manufacturer") or previous.get("manufacturer"),
            "model": values.get("model") or previous.get("model"),
            "config": config,
            "enabled": previous.get("enabled", True),
            "needs_confirmation": previous.get("needs_confirmation", False),
            "can_capture": bool(values.get("can_capture", previous.get("can_capture"))),
        }
        if transport == HOME_ASSISTANT_IR:
            record["entity_id"] = values.get("entity_id") or previous.get("entity_id")
            record["receiver_entity_id"] = values.get(
                "receiver_entity_id"
            ) or previous.get("receiver_entity_id")
        else:
            record["ieee"] = ieee
            record["driver"] = str(values["driver"])
            record["quirk_class"] = values.get("quirk_class") or previous.get(
                "quirk_class"
            )
        emitters[key] = record
        return key

    def retain_emitters(self, valid_keys: set[str], transport: str) -> None:
        emitters = self.document["emitters"]
        for key in {
            key
            for key, record in emitters.items()
            if record.get("transport", ZHA_BRIDGE) == transport
        }.difference(valid_keys):
            del emitters[key]

    def choose_emitter(self, requested: str | None = None) -> dict[str, Any]:
        emitters = self.document["emitters"]
        if requested is not None:
            match = emitters.get(requested)
            if match is not None and match.get("enabled", True):
                return match
            _fail(
                f"Emitter {requested} is not available",
                ERROR_EMITTER_UNAVAILABLE,
            )
        enabled = [
            record for record in emitters.values() if record.get("enabled", True)
        ]
        if not enabled:
            _fail(
                "No enabled IR emitter is configured",
                ERROR_EMITTER_NOT_CONFIGURED,
            )
        if len(enabled) > 1:
            _fail(
                "More than one emitter is enabled; pass emitter_id",
                ERROR_EMITTER_REQUIRED,
            )
        return enabled[0]

    def put_location(self, location_id: str, name: str) -> None:
        _require_slug(location_id, "location_id")
        location = self.document["locations"].setdefault(
            location_id, {"name": name, "appliances": {}}
        )
        location["name"] = name

    def set_location_name(self, location_id: str, name: str) -> None:
        self.location(location_id)["name"] = name

    def remove_location(self, location_id: str, *, confirmed: bool) -> None:
        if not confirmed:
            _fail("delete_location requires confirm: true")
        self.location(location_id)
        del self.document["locations"][location_id]

    def put_appliance(
        self,
        location_id: str,
        appliance_id: str,
        name: str,
        appliance_type: str,
        *,
        preferred_platform: str | None = None,
        emitter_id: str | None = None,
    ) -> None:
        _require_slug(location_id, "location_id")
        _require_slug(appliance_id, "appliance_id")
        if preferred_platform is not None:
            _require_member(
                preferred_platform, PLATFORM_PREFERENCES, "preferred_platform"
            )
        if emitter_id:
            self.require_emitter_id(emitter_id)
        location = self.document["locations"].setdefault(
            location_id, {"name": location_id, "appliances": {}}
        )
        appliances = location.setdefault("appliances", {})
        appliance = appliances.setdefault(
            appliance_id,
            {
                "name": name,
                "appliance_type": appliance_type,
                "preferred_platform": AUTOMATIC_PLATFORM,
                "emitter_id": None,
                "commands": {},
            },
        )
        appliance.update({"name": name, "appliance_type": appliance_type})
        appliance.setdefault("preferred_platform", AUTOMATIC_PLATFORM)
        appliance.setdefault("emitter_id", None)
        if preferred_platform is not None:
            appliance["preferred_platform"] = preferred_platform
        if emitter_id is not None:
            appliance["emitter_id"] = emitter_id or None

    def patch_appliance(
        self,
        location_id: str,
        appliance_id: str,
        *,
        name: Any = _MISSING,
        appliance_type: Any = _MISSING,
        preferred_platform: Any = _MISSING,
        emitter_id: Any = _MISSING,
    ) -> None:
        if preferred_platform is not _MISSING:
            _require_member(
                preferred_platform, PLATFORM_PREFERENCES, "preferred_platform"
            )
        if emitter_id not in (_MISSING, None, ""):
            self.require_emitter_id(emitter_id)
        appliance = self.appliance(location_id, appliance_id)
        changes = {
            "name": name,
            "appliance_type": appliance_type,
            "preferred_platform": preferred_platform,
            "emitter_id": None if emitter_id == "" else emitter_id,
        }
        for field, value in changes.items():
            if value is not _MISSING:
                appliance[field] = value

    def remove_appliance(
        self, location_id: str, appliance_id: str, *, confirmed: bool
    ) -> None:
        if not confirmed:
            _fail("delete_device requires confirm: true")
        self.appliance(location_id, appliance_id)
        del self.location(location_id)["appliances"][appliance_id]

    def move_appliance(
        self, location_id: str, appliance_id: str, target_id: str
    ) -> None:
        _require_slug(target_id, "target_location_id")
        if location_id == target_id:
            return
        source = self.location(location_id)["appliances"]
        item = self.appliance(location_id, appliance_id)
        target = self.location(target_id).setdefault("appliances", {})
        if appliance_id in target:
            _fail(
                f"Appliance {appliance_id} already exists in the destination location"
            )
        target[appliance_id] = item
        del source[appliance_id]

    def put_command_placeholder(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        name: str,
        role: str | None,
        *,
        timestamp: str,
    ) -> None:
        _require_slug(command_id, "command_id")
        if role:
            _require_member(role, SIGNAL_ROLES, "role")
        commands = self.appliance(location_id, appliance_id).setdefault("commands", {})
        command = commands.setdefault(command_id, {})
        defaults = {
            "code": "",
            "format": "raw_signed",
            CURRENT_REVISION: 0,
            REVISIONS: [],
        }
        for field, value in defaults.items():
            command.setdefault(field, value)
        command["name"] = name
        if role is not None:
            _put_optional(command, "role", role)
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="metadata_updated")

    def set_command_name(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        name: str,
        *,
        timestamp: str,
    ) -> None:
        command = self.command(location_id, appliance_id, command_id)
        if command.get("name") == name:
            return
        command["name"] = name
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="renamed")

    def remove_command(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> None:
        self.command(location_id, appliance_id, command_id)
        del self.appliance(location_id, appliance_id)["commands"][command_id]

    def move_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        target_location_id: str,
        target_device_id: str,
    ) -> None:
        _require_slug(target_location_id, "target_location_id")
        _require_slug(target_device_id, "target_appliance_id")
        if (location_id, appliance_id) == (target_location_id, target_device_id):
            return
        source = self.appliance(location_id, appliance_id)["commands"]
        item = self.command(location_id, appliance_id, command_id)
        target = self.appliance(target_location_id, target_device_id).setdefault(
            "commands", {}
        )
        if command_id in target:
            _fail(f"Command {command_id} already exists in the destination appliance")
        target[command_id] = item
        del source[command_id]

    def store_command(
        self,
        location_id: str,
        appliance_id: str,
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
        for value, field in (
            (location_id, "location_id"),
            (appliance_id, "appliance_id"),
            (command_id, "command_id"),
        ):
            _require_slug(value, field)
        if role:
            _require_member(role, SIGNAL_ROLES, "role")
        self.document["locations"].setdefault(
            location_id, {"name": location_id, "appliances": {}}
        )
        appliances = self.document["locations"][location_id].setdefault(
            "appliances", {}
        )
        appliances.setdefault(
            appliance_id,
            {
                "name": appliance_id,
                "appliance_type": "generic",
                "preferred_platform": AUTOMATIC_PLATFORM,
                "emitter_id": None,
                "commands": {},
            },
        )
        commands = appliances[appliance_id].setdefault("commands", {})
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
        for field, value in (
            ("source", source),
            ("signal", signal),
            ("analysis", analysis),
        ):
            if value is not None:
                command[field] = deepcopy(value)
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
        location_id: str,
        appliance_id: str,
        command_id: str,
        *,
        name: Any = _MISSING,
        icon: Any = _MISSING,
        role: Any = _MISSING,
        timestamp: str,
    ) -> None:
        if role not in (_MISSING, None, ""):
            _require_member(role, SIGNAL_ROLES, "role")
        command = self.command(location_id, appliance_id, command_id)
        desired_name = command.get("name") if name is _MISSING else name
        desired_icon = command.get("icon") if icon is _MISSING else icon or None
        desired_feature = command.get("role") if role is _MISSING else role or None
        if (
            desired_name == command.get("name")
            and desired_icon == command.get("icon")
            and desired_feature == command.get("role")
        ):
            return
        command["name"] = desired_name
        _put_optional(command, "icon", desired_icon)
        _put_optional(command, "role", desired_feature)
        command["updated_at"] = timestamp
        append_revision(command, created_at=timestamp, action="metadata_updated")

    def restore_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        revision_id: int,
        *,
        timestamp: str,
    ) -> int:
        command = self.command(location_id, appliance_id, command_id)
        try:
            restore_revision(command, revision_id, created_at=timestamp)
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Revision {revision_id} was not found"
            ) from error
        return int(command[CURRENT_REVISION])

    def label_revision(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        revision_id: int,
        label: str,
    ) -> None:
        try:
            set_revision_label(
                self.command(location_id, appliance_id, command_id), revision_id, label
            )
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Revision {revision_id} was not found"
            ) from error

    def insert_imported_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        command: dict[str, Any],
    ) -> None:
        for value, field in (
            (location_id, "location_id"),
            (appliance_id, "appliance_id"),
            (command_id, "command_id"),
        ):
            _require_slug(value, field)
        appliance = self.appliance(location_id, appliance_id)
        commands = appliance.setdefault("commands", {})
        if command_id in commands:
            _fail(f"Command {command_id} already exists")
        if command.get("role"):
            _require_member(command["role"], SIGNAL_ROLES, "role")
        imported = deepcopy(command)
        _canonicalize_command_history(imported)
        commands[command_id] = imported

    def insert_backup(
        self, prepared: list[tuple[dict[str, Any], dict[str, Any]]]
    ) -> dict[str, int]:
        new_locations: set[str] = set()
        new_appliances: set[tuple[str, str]] = set()
        for item, command in prepared:
            location_id = item["location_id"]
            appliance_id = item["appliance_id"]
            command_id = item["command_id"]
            for value, field in (
                (location_id, "location_id"),
                (appliance_id, "appliance_id"),
                (command_id, "command_id"),
            ):
                _require_slug(value, field)
            _require_member(
                item["preferred_platform"], PLATFORM_PREFERENCES, "preferred_platform"
            )
            if command.get("role"):
                _require_member(command["role"], SIGNAL_ROLES, "role")
            locations = self.document["locations"]
            if location_id not in locations:
                locations[location_id] = {
                    "name": item["location_name"],
                    "appliances": {},
                }
                new_locations.add(location_id)
            appliances = locations[location_id].setdefault("appliances", {})
            if appliance_id not in appliances:
                appliances[appliance_id] = {
                    "name": item["appliance_name"],
                    "appliance_type": item["appliance_type"],
                    "preferred_platform": item["preferred_platform"],
                    "emitter_id": None,
                    "commands": {},
                }
                new_appliances.add((location_id, appliance_id))
            commands = appliances[appliance_id].setdefault("commands", {})
            if command_id in commands:
                _fail(
                    f"Command {location_id}/{appliance_id}/{command_id} already exists"
                )
            imported = deepcopy(command)
            _canonicalize_command_history(imported)
            commands[command_id] = imported
        return {
            "locations_created": len(new_locations),
            "appliances_created": len(new_appliances),
            "commands_imported": len(prepared),
        }

    def history(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        command = self.command(location_id, appliance_id, command_id)
        return {
            "current_revision": command.get(CURRENT_REVISION, 0),
            "revisions": command_history(command),
        }

    def public_view(self) -> dict[str, Any]:
        emitters = []
        for key, record in sorted(self.document["emitters"].items()):
            emitters.append(
                {
                    "key": key,
                    "ieee": record.get("ieee"),
                    "name": record.get("name"),
                    "manufacturer": record.get("manufacturer"),
                    "model": record.get("model"),
                    "enabled": record.get("enabled", True),
                    "can_capture": record.get("can_capture", False),
                    "transport": record.get("transport"),
                }
            )
        locations = deepcopy(self.document["locations"])
        for location in locations.values():
            for appliance in location.get("appliances", {}).values():
                appliance["commands"] = {
                    key: command_without_history(command)
                    for key, command in appliance.get("commands", {}).items()
                }
        return {"locations": locations, "emitters": emitters}

    def location(self, location_id: str) -> dict[str, Any]:
        try:
            return self.document["locations"][location_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Location {location_id} was not found"
            ) from error

    def appliance(self, location_id: str, appliance_id: str) -> dict[str, Any]:
        try:
            return self.location(location_id)["appliances"][appliance_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"IR appliance {appliance_id} was not found"
            ) from error

    def command(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        try:
            return self.appliance(location_id, appliance_id)["commands"][command_id]
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_COMMAND_NOT_FOUND, f"Command {command_id} was not found"
            ) from error

    def require_emitter_id(self, emitter_id: str) -> None:
        if (
            normalize_emitter_ref(emitter_id) != emitter_id
            or emitter_id not in self.document["emitters"]
        ):
            raise ImprintRefineryError(
                ERROR_EMITTER_UNAVAILABLE,
                f"Unknown IR emitter: {emitter_id}",
            )
