"""Declarative service API for the Imprint Refinery integration."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import re
from typing import Any
from uuid import uuid4

from homeassistant.components import websocket_api
from homeassistant.const import STATE_UNAVAILABLE, Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
    service as service_helper,
)
import voluptuous as vol

from .backup import BackupError, inspect_backup
from .catalog import (
    CatalogUnavailableError,
    guided_candidates,
    match_signal,
    prepare_profile_import,
    search_profiles,
)
from .catalog_sessions import GuidedCatalogSessionManager, GuidedSessionError
from .const import (
    DOMAIN,
    ERROR_CATALOG_UNAVAILABLE,
    ERROR_CODE_EMPTY,
    ERROR_CODE_INVALID,
    ERROR_COMMAND_NOT_FOUND,
    ERROR_GUIDED_SESSION,
    ERROR_UNEXPECTED,
    HOME_ASSISTANT_IR,
)
from .consumer import emitter_key
from .emitter_identity import emitter_entity_id
from .entity_projection import project_command_buttons, project_library
from .errors import ImprintRefineryError
from .hardware import InfraredHardware, discover_home_assistant_emitters
from .identifiers import unique_identifier
from .ir_formats import (
    DEFAULT_CARRIER_HZ,
    INPUT_FORMATS,
    OUTPUT_FORMATS,
    PROFILE_OUTPUT_FORMATS,
    IRFormatError,
    IRSignal,
    analyze_signal,
    convert_signal,
    decode_signal,
    encode_profile_format,
    encode_raw,
    rebuild_recognized_signal,
    signal_document,
)
from .ir_formats.conversion import (
    DecodedSignal,
    conversion_loss_report,
    decode_profile_partial,
)
from .product_spec import PLATFORM_PREFERENCES, SIGNAL_ROLES, Actions, Fields, States
from .signal_command import signal_from_command
from .status import ActivityStatus
from .storage import SignalLibraryStore
from .transmission import SendRoute, SignalQueue

MAX_IMPORT_CHARACTERS = 2_000_000
_ID_PATTERN = re.compile(r"^[a-z0-9_]+$")

PANEL_ACTIONS = (
    Actions.CANCEL_CAPTURE,
    Actions.CAPTURE_SIGNAL,
    Actions.SEND_SIGNAL,
    Actions.REBUILD_SIGNAL,
    Actions.ANALYZE_SIGNAL,
    Actions.CONVERT_SIGNAL,
    Actions.SEARCH_CATALOG,
    Actions.GET_CATALOG_PROFILE,
    Actions.GUIDED_ANSWER,
    Actions.GUIDED_CONTROL,
    Actions.GUIDED_START,
    Actions.GUIDED_TEST,
    Actions.MATCH_CATALOG_SIGNAL,
    Actions.ENCODE_SIGNAL,
    Actions.EXPORT_BACKUP,
    Actions.EXPORT_PROFILE,
    Actions.COMMAND_HISTORY,
    Actions.INSPECT_IMPORT,
    Actions.IMPORT_BACKUP,
    Actions.IMPORT_COMMAND_BACKUP,
    Actions.STORE_COMMAND,
    Actions.SEND_COMMAND,
    Actions.GET_LIBRARY,
    Actions.MOVE_COMMAND,
    Actions.MOVE_APPLIANCE,
    Actions.CREATE_LOCATION,
    Actions.CREATE_APPLIANCE,
    Actions.CREATE_COMMAND,
    Actions.UPDATE_COMMAND,
    Actions.UPDATE_APPLIANCE,
    Actions.RENAME_LOCATION,
    Actions.RENAME_APPLIANCE,
    Actions.RENAME_COMMAND,
    Actions.RESTORE_REVISION,
    Actions.LABEL_REVISION,
    Actions.REMOVE_LOCATION,
    Actions.REMOVE_APPLIANCE,
    Actions.REMOVE_COMMAND,
)

REGISTERED_SERVICES = (Actions.SEND_COMMAND,)
PANEL_COMMAND = f"{DOMAIN}/execute"


def id_schema(value: str) -> str:
    result = cv.string(value).strip()
    if not _ID_PATTERN.fullmatch(result):
        raise vol.Invalid("ID must match [a-z0-9_]+")
    return result


def non_empty_string(value: str) -> str:
    result = cv.string(value).strip()
    if not result:
        raise vol.Invalid("Value must not be empty")
    return result


def optional_string(value: str) -> str:
    return cv.string(value).strip()


def icon_schema(value: str) -> str:
    result = cv.string(value).strip()
    return cv.icon(result) if result else result


def import_payload(value: str) -> str:
    result = non_empty_string(value)
    if len(result) > MAX_IMPORT_CHARACTERS:
        raise vol.Invalid("Import document is too large")
    return result


def _at_least_one(*fields: str) -> Callable[[dict[str, Any]], dict[str, Any]]:
    def validate(value: dict[str, Any]) -> dict[str, Any]:
        if not set(fields) & value.keys():
            raise vol.Invalid(f"At least one of {', '.join(fields)} is required")
        return value

    return validate


def _profile_export_schema(value: dict[str, Any]) -> dict[str, Any]:
    if (Fields.LOCATION_ID in value) != (Fields.APPLIANCE_ID in value):
        raise vol.Invalid(
            "location_id and appliance_id must be provided together for an appliance export"
        )
    return value


def _download_filename_stem(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "ir-profile"


def _decode_service_signal(
    code: str,
    input_format: str = "raw_signed",
    carrier_frequency: int | None = None,
) -> DecodedSignal:
    """Decode service input and expose one consistent validation error."""
    try:
        return decode_signal(
            code,
            input_format,
            carrier_frequency=carrier_frequency,
        )
    except IRFormatError as error:
        raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error


def _decode_service_request(data: dict[str, Any]) -> DecodedSignal:
    """Decode the standard code/format/carrier service fields."""
    return _decode_service_signal(
        data[Fields.CODE],
        data.get(Fields.FORMAT, "raw_signed"),
        data.get(Fields.CARRIER_FREQUENCY),
    )


def _unique_profile_name(display: str, command_id: str, used: set[str]) -> str:
    candidate = display.strip() or command_id
    if candidate.casefold() in used:
        candidate = f"{candidate} ({command_id})"
    base = candidate
    suffix = 2
    while candidate.casefold() in used:
        candidate = f"{base} {suffix}"
        suffix += 1
    used.add(candidate.casefold())
    return candidate


@dataclass(frozen=True, slots=True)
class MutationPlan:
    method: str
    required: tuple[str, ...]
    optional: tuple[tuple[str, str], ...] = ()
    result: str = "saved"
    include_missing: bool = False


_MUTATIONS = {
    Actions.CREATE_LOCATION: MutationPlan(
        "add_location", (Fields.LOCATION_ID, Fields.NAME)
    ),
    Actions.CREATE_APPLIANCE: MutationPlan(
        "create_appliance",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.NAME, Fields.APPLIANCE_TYPE),
        (
            (Fields.PREFERRED_PLATFORM, "preferred_platform"),
            (Fields.EMITTER_ID, "emitter_id"),
        ),
        include_missing=True,
    ),
    Actions.UPDATE_APPLIANCE: MutationPlan(
        "revise_appliance",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID),
        (
            (Fields.NAME, "name"),
            (Fields.APPLIANCE_TYPE, "appliance_type"),
            (Fields.PREFERRED_PLATFORM, "preferred_platform"),
            (Fields.EMITTER_ID, "emitter_id"),
        ),
        include_missing=True,
    ),
    Actions.CREATE_COMMAND: MutationPlan(
        "draft_command",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.COMMAND_ID, Fields.NAME),
        ((Fields.ROLE, "role"),),
        include_missing=True,
    ),
    Actions.UPDATE_COMMAND: MutationPlan(
        "revise_command",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.COMMAND_ID),
        ((Fields.NAME, "name"), (Fields.ICON, "icon"), (Fields.ROLE, "role")),
        include_missing=True,
    ),
    Actions.RENAME_LOCATION: MutationPlan(
        "rename_location", (Fields.LOCATION_ID, Fields.NAME)
    ),
    Actions.RENAME_APPLIANCE: MutationPlan(
        "set_appliance_name", (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.NAME)
    ),
    Actions.RENAME_COMMAND: MutationPlan(
        "set_command_name",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.COMMAND_ID, Fields.NAME),
    ),
    Actions.MOVE_COMMAND: MutationPlan(
        "relocate_command",
        (
            Fields.LOCATION_ID,
            Fields.APPLIANCE_ID,
            Fields.COMMAND_ID,
            Fields.TARGET_LOCATION_ID,
            Fields.TARGET_APPLIANCE_ID,
        ),
        result="moved",
    ),
    Actions.MOVE_APPLIANCE: MutationPlan(
        "relocate_appliance",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.TARGET_LOCATION_ID),
        result="moved",
    ),
    Actions.REMOVE_LOCATION: MutationPlan(
        "delete_location", (Fields.LOCATION_ID, Fields.CONFIRM), result="deleted"
    ),
    Actions.REMOVE_APPLIANCE: MutationPlan(
        "remove_appliance",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.CONFIRM),
        result="deleted",
    ),
    Actions.REMOVE_COMMAND: MutationPlan(
        "remove_command",
        (Fields.LOCATION_ID, Fields.APPLIANCE_ID, Fields.COMMAND_ID),
        result="deleted",
    ),
}


class ServiceAPI:
    """Stateful service handlers sharing registry and transport dependencies."""

    def __init__(
        self,
        hass: HomeAssistant,
        resolve_emitter_ref: Callable[[str], str],
    ) -> None:
        runtime = hass.data[DOMAIN]
        self.hass = hass
        self.store: SignalLibraryStore = runtime["store"]
        self.transport: InfraredHardware = runtime["transport"]
        self.signal_queue: SignalQueue = runtime["signal_queue"]
        self.status: ActivityStatus = runtime["status"]
        self.capture_tasks: dict[str, asyncio.Task] = runtime["capture_tasks"]
        self.catalog_sessions: GuidedCatalogSessionManager = runtime.setdefault(
            "catalog_sessions", GuidedCatalogSessionManager()
        )
        self._resolve_ref = resolve_emitter_ref

    def emitter(self, data: dict[str, Any]) -> dict[str, Any]:
        return self.emitter_with_id(data)[1]

    def emitter_with_id(self, data: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        reference = data.get(Fields.EMITTER_ID)
        if reference:
            emitter_id = self._resolve_ref(reference)
            return emitter_id, self.store.choose_emitter(emitter_id)
        emitter = self.store.choose_emitter(None)
        return emitter_key(self.store, emitter), emitter

    def _set_error(
        self, action: str, data: dict[str, Any], error: ImprintRefineryError
    ) -> None:
        self.status.async_set(
            States.ERROR,
            action=action,
            location_id=data.get(Fields.LOCATION_ID),
            appliance_id=data.get(Fields.APPLIANCE_ID),
            command_id=data.get(Fields.COMMAND_ID),
            error=error.code,
            error_message=error.message,
        )

    async def run(
        self,
        action: str,
        call: ServiceCall,
        operation: Callable[[], Awaitable[Any]],
        *,
        final_state: str = States.IDLE,
        start_state: str | None = None,
    ) -> Any:
        context = {
            "action": action,
            "location_id": call.data.get(Fields.LOCATION_ID),
            "appliance_id": call.data.get(Fields.APPLIANCE_ID),
            "command_id": call.data.get(Fields.COMMAND_ID),
        }
        if start_state:
            self.status.async_set(start_state, **context)
        try:
            result = await operation()
        except ImprintRefineryError as error:
            self.status.async_set(
                States.ERROR,
                **context,
                error=error.code,
                error_message=error.message,
            )
            raise
        except Exception as error:
            self.status.async_set(
                States.ERROR,
                **context,
                error=ERROR_UNEXPECTED,
                error_message=str(error),
            )
            raise
        self.status.async_set(final_state, **context)
        return result

    async def analyze(self, signal: IRSignal, carrier_source: str) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(
            lambda: analyze_signal(signal, carrier_source=carrier_source)
        )

    async def dispatch(
        self, action: str, data: dict[str, Any], signal: IRSignal
    ) -> dict[str, Any]:
        try:
            emitter_id, emitter = self.emitter_with_id(data)
        except ImprintRefineryError as error:
            self._set_error(action, data, error)
            raise
        result = await self.signal_queue.submit(
            emitter_id,
            emitter,
            signal,
            route=SendRoute(
                token=uuid4().hex,
                emitter=emitter_id,
                location=data.get(Fields.LOCATION_ID),
                appliance=data.get(Fields.APPLIANCE_ID),
                command=data.get(Fields.COMMAND_ID),
                origin="service",
            ),
        )
        return result.to_dict()

    def _cancel_capture_window(self, emitter: dict[str, Any]) -> None:
        task = self.capture_tasks.pop(emitter_key(self.store, emitter), None)
        if task is not None:
            task.cancel()

    async def cancel_capture(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            emitter = self.emitter(call.data)
            task = self.capture_tasks.pop(emitter_key(self.store, emitter), None)
            if task is not None and task is not asyncio.current_task():
                task.cancel()
            await self.transport.stop_capture(emitter)
            return {"status": "capture_cancelled"}

        return await self.run(Actions.CANCEL_CAPTURE, call, operation)

    async def capture_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            emitter = self.emitter(call.data)
            self._cancel_capture_window(emitter)
            key = emitter_key(self.store, emitter)
            current = asyncio.current_task()
            if current is not None:
                self.capture_tasks[key] = current
            try:
                signal, carrier_source = await self.transport.capture(
                    emitter,
                    timeout=call.data[Fields.TIMEOUT],
                    poll_interval=call.data[Fields.POLL_INTERVAL],
                )
                return {
                    "code": encode_raw(signal, signed=True),
                    "format": "raw_signed",
                    "signal": signal_document(signal, carrier_source),
                }
            finally:
                if self.capture_tasks.get(key) is current:
                    self.capture_tasks.pop(key, None)

        return await self.run(
            Actions.CAPTURE_SIGNAL,
            call,
            operation,
            final_state=States.CAPTURE_READY,
            start_state=States.CAPTURING,
        )

    async def send_signal(self, call: ServiceCall) -> dict[str, Any]:
        signal = _decode_service_request(call.data).signal
        return await self.dispatch(Actions.SEND_SIGNAL, call.data, signal)

    async def analyze_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            decoded = _decode_service_request(call.data)
            signal = decoded.signal
            return {
                "signal": signal_document(signal, decoded.carrier_source),
                "analysis": await self.analyze(signal, decoded.carrier_source),
            }

        return await self.run(Actions.ANALYZE_SIGNAL, call, operation)

    def _guided(self, operation: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        try:
            return operation()
        except GuidedSessionError as error:
            raise ImprintRefineryError(ERROR_GUIDED_SESSION, str(error)) from error

    async def catalog_search(self, call: ServiceCall) -> dict[str, Any]:
        try:
            return await self.hass.async_add_executor_job(
                lambda: search_profiles(
                    category=call.data.get(Fields.CATEGORY, ""),
                    brand=call.data.get(Fields.BRAND, ""),
                    model=call.data.get(Fields.MODEL, ""),
                )
            )
        except CatalogUnavailableError as error:
            raise ImprintRefineryError(ERROR_CATALOG_UNAVAILABLE, str(error)) from error

    async def catalog_profile(self, call: ServiceCall) -> dict[str, Any]:
        try:
            return await self.hass.async_add_executor_job(
                lambda: prepare_profile_import(
                    call.data[Fields.PROFILE_ID],
                    registry_data=self.store.data,
                    location_id=call.data.get(Fields.LOCATION_ID),
                    appliance_id=call.data.get(Fields.APPLIANCE_ID),
                )
            )
        except CatalogUnavailableError as error:
            raise ImprintRefineryError(ERROR_CATALOG_UNAVAILABLE, str(error)) from error
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_CODE_INVALID,
                f"Unknown catalog profile: {call.data[Fields.PROFILE_ID]}",
            ) from error

    async def catalog_guided_start(self, call: ServiceCall) -> dict[str, Any]:
        try:
            catalog = await self.hass.async_add_executor_job(
                lambda: guided_candidates(
                    category=call.data[Fields.CATEGORY], brand=call.data[Fields.BRAND]
                )
            )
        except CatalogUnavailableError as error:
            raise ImprintRefineryError(ERROR_CATALOG_UNAVAILABLE, str(error)) from error
        return self._guided(
            lambda: self.catalog_sessions.start(
                catalog["candidates"],
                context={
                    "category": call.data[Fields.CATEGORY],
                    "brand": call.data[Fields.BRAND],
                    "catalog": catalog.get("catalog", {}),
                },
            )
        )

    async def catalog_guided_test(self, call: ServiceCall) -> dict[str, Any]:
        session_id = call.data[Fields.SESSION_ID]
        candidate_id = call.data[Fields.CANDIDATE]
        session = self._guided(
            lambda: self.catalog_sessions.begin_test(session_id, candidate_id)
        )
        candidate = (session.get("current_candidate") or {}).get("command") or {}
        code = candidate.get("code")
        if not isinstance(code, str) or not code:
            message = "The catalog candidate has no sendable code"
            self.catalog_sessions.record_send_failure(session_id, candidate_id, message)
            raise ImprintRefineryError(ERROR_GUIDED_SESSION, message)
        try:
            signal = _decode_service_signal(
                code,
                str(candidate.get("format") or "raw_signed"),
            ).signal
            dispatch = await self.dispatch(Actions.GUIDED_TEST, call.data, signal)
        except Exception as error:
            self.catalog_sessions.record_send_failure(
                session_id, candidate_id, str(error)
            )
            raise
        return {"session": self.catalog_sessions.get(session_id), "dispatch": dispatch}

    async def catalog_guided_answer(self, call: ServiceCall) -> dict[str, Any]:
        return self._guided(
            lambda: self.catalog_sessions.record_result(
                call.data[Fields.SESSION_ID],
                call.data[Fields.CANDIDATE],
                call.data[Fields.RESULT],
            )
        )

    async def catalog_guided_control(self, call: ServiceCall) -> dict[str, Any]:
        operations = {
            "status": self.catalog_sessions.get,
            "pause": self.catalog_sessions.pause,
            "resume": self.catalog_sessions.resume,
            "cancel": self.catalog_sessions.cancel,
        }
        return self._guided(
            lambda: operations[call.data[Fields.SESSION_ACTION]](
                call.data[Fields.SESSION_ID]
            )
        )

    async def catalog_match_signal(self, call: ServiceCall) -> dict[str, Any]:
        try:
            signal = _decode_service_request(call.data).signal
            return await self.hass.async_add_executor_job(
                lambda: match_signal(signal, limit=call.data[Fields.LIMIT])
            )
        except CatalogUnavailableError as error:
            raise ImprintRefineryError(ERROR_CATALOG_UNAVAILABLE, str(error)) from error
        except ValueError as error:
            raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error

    async def convert_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            try:
                decoded, value = convert_signal(
                    call.data[Fields.CODE],
                    call.data[Fields.FORMAT],
                    call.data[Fields.OUTPUT_FORMAT],
                    carrier_frequency=call.data.get(Fields.CARRIER_FREQUENCY),
                    name=call.data.get(Fields.NAME, "Command"),
                )
            except IRFormatError as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
            signal = decoded.signal
            return {
                "value": value,
                "format": call.data[Fields.OUTPUT_FORMAT],
                "loss_report": conversion_loss_report(
                    signal,
                    call.data[Fields.OUTPUT_FORMAT],
                    name=call.data.get(Fields.NAME, "Command"),
                ),
                "signal": signal_document(signal, decoded.carrier_source),
                "analysis": await self.analyze(signal, decoded.carrier_source),
            }

        return await self.run(Actions.CONVERT_SIGNAL, call, operation)

    async def inspect_import(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            input_format = call.data[Fields.FORMAT]
            if input_format == "native_json":
                try:
                    backup = inspect_backup(call.data[Fields.CODE])
                except BackupError as error:
                    raise ImprintRefineryError(
                        ERROR_CODE_INVALID, str(error)
                    ) from error
                commands = []
                for item in backup["commands"]:
                    command = item["command"]
                    command_format = command.get("format", "raw_signed")
                    compatible = bool((command.get("signal") or {}).get("timings"))
                    commands.append(
                        {
                            "name": command.get("name") or item["command_id"],
                            "command_id": item["command_id"],
                            "code": command["code"],
                            "format": command_format,
                            "compatible": compatible,
                            "compatibility_error": None
                            if compatible
                            else "This command does not contain canonical timing data",
                            "signal": command.get("signal", {}),
                            "analysis": command.get("analysis", {}),
                            "source": command.get("source"),
                            "role": command.get("role", ""),
                            "icon": command.get("icon", ""),
                            "native_command": command,
                            "backup_origin": {
                                "location_id": item["location_id"],
                                "appliance_id": item["appliance_id"],
                                "history": backup["history"],
                            },
                        }
                    )
                return {
                    "format": "native_json",
                    "command_count": len(commands),
                    "scope": backup["scope"],
                    "history": backup["history"],
                    "commands": commands,
                }

            try:
                decoded, unsupported = decode_profile_partial(
                    call.data[Fields.CODE],
                    input_format,
                    carrier_frequency=call.data.get(Fields.CARRIER_FREQUENCY),
                )
            except IRFormatError as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
            if len(decoded) + len(unsupported) > 500:
                raise ImprintRefineryError(
                    ERROR_CODE_INVALID, "Import contains more than 500 commands"
                )

            used_ids: set[str] = set()
            commands = []
            fallback = call.data.get(Fields.NAME, "Imported command")
            for index, item in enumerate(decoded, start=1):
                signal = item.signal
                name = item.name or (
                    fallback if len(decoded) == 1 else f"{fallback} {index}"
                )
                analysis = await self.analyze(signal, item.carrier_source)
                code = encode_raw(signal, signed=True)
                loss = conversion_loss_report(signal, "raw_signed", name=name)
                compatible = True
                compatibility_error = None
                commands.append(
                    {
                        "name": name,
                        "command_id": unique_identifier(name, used_ids),
                        "code": code,
                        "format": "raw_signed",
                        "compatible": compatible,
                        "compatibility_error": compatibility_error,
                        "loss_report": loss,
                        "signal": signal_document(signal, item.carrier_source),
                        "analysis": analysis,
                        "source": {
                            "type": "import",
                            "format": input_format,
                            "carrier_frequency": signal.carrier_frequency,
                            "original_name": item.name,
                            "metadata": item.metadata,
                        },
                    }
                )
            return {
                "format": input_format,
                "command_count": len(commands),
                "commands": commands,
                "unsupported_count": len(unsupported),
                "unsupported_commands": unsupported,
            }

        return await self.run(Actions.INSPECT_IMPORT, call, operation)

    async def export_backup(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            return self.store.export_backup(
                location_id=call.data.get(Fields.LOCATION_ID),
                appliance_id=call.data.get(Fields.APPLIANCE_ID),
                include_history=call.data[Fields.INCLUDE_HISTORY],
            )

        return await self.run(Actions.EXPORT_BACKUP, call, operation)

    async def export_profile(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            location_id = call.data.get(Fields.LOCATION_ID)
            device_id = call.data.get(Fields.APPLIANCE_ID)
            output_format = call.data[Fields.OUTPUT_FORMAT]
            locations = self.store.data.get("locations", {})
            scope = "appliance" if device_id else "library"
            if device_id:
                try:
                    device = locations[location_id]["appliances"][device_id]
                    selected = {
                        location_id: {
                            **locations[location_id],
                            "appliances": {device_id: device},
                        }
                    }
                except KeyError as error:
                    raise ImprintRefineryError(
                        ERROR_COMMAND_NOT_FOUND,
                        f"IR appliance {location_id}/{device_id} was not found",
                    ) from error
                profile_name = str(device.get("name", device_id))
                filename_stem = _download_filename_stem(profile_name)
            else:
                selected = locations
                profile_name = "Imprint Refinery Library"
                filename_stem = "imprint-refinery-library"

            commands: list[tuple[str, IRSignal]] = []
            used_names: set[str] = set()
            for current_location_id, location in sorted(selected.items()):
                for current_device_id, device in sorted(
                    location.get("appliances", {}).items()
                ):
                    for command_id, command in sorted(
                        device.get("commands", {}).items()
                    ):
                        display = str(command.get("name") or command_id)
                        if scope == "library":
                            display = " / ".join(
                                (
                                    str(location.get("name") or current_location_id),
                                    str(device.get("name") or current_device_id),
                                    display,
                                )
                            )
                        name = _unique_profile_name(display, command_id, used_names)
                        try:
                            signal = signal_from_command(command)
                        except (
                            IRFormatError,
                            KeyError,
                            TypeError,
                            ValueError,
                        ) as error:
                            raise ImprintRefineryError(
                                ERROR_CODE_INVALID,
                                "Cannot export "
                                f"{current_location_id}/{current_device_id}/{command_id}: {error}",
                            ) from error
                        commands.append((name, signal))
            if not commands:
                raise ImprintRefineryError(
                    ERROR_CODE_EMPTY, "The selected profile has no IR commands"
                )
            try:
                reports = [
                    {
                        "name": name,
                        **conversion_loss_report(signal, output_format, name=name),
                    }
                    for name, signal in commands
                ]
                value = encode_profile_format(
                    commands, output_format, profile_name=profile_name
                )
            except IRFormatError as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
            extension, media_type = {
                "girr": ("girr", "application/xml"),
                "flipper": ("ir", "text/plain"),
                "lirc": ("conf", "text/plain"),
            }[output_format]
            return {
                "value": value,
                "format": output_format,
                "filename": f"{filename_stem}.{extension}",
                "media_type": media_type,
                "scope": scope,
                "profile_name": profile_name,
                "command_count": len(commands),
                "loss_report": {
                    "lossless": all(report["lossless"] for report in reports),
                    "commands": reports,
                },
            }

        return await self.run(Actions.EXPORT_PROFILE, call, operation)

    async def import_command_backup(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            await self.store.import_command_backup(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.PAYLOAD],
            )
            return {"status": "saved"}

        return await self.run(Actions.IMPORT_COMMAND_BACKUP, call, operation)

    async def import_backup(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, int]:
            return await self.store.import_backup(call.data[Fields.CODE])

        return await self.run(Actions.IMPORT_BACKUP, call, operation)

    async def encode_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            carrier = call.data.get(Fields.CARRIER_FREQUENCY, DEFAULT_CARRIER_HZ)
            source = "provided" if Fields.CARRIER_FREQUENCY in call.data else "assumed"
            try:
                signal = IRSignal(call.data[Fields.TIMINGS], carrier)
                code = encode_raw(signal, signed=True)
            except IRFormatError as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
            return {
                "code": code,
                "format": "raw_signed",
                "signal": signal_document(signal, source),
                "analysis": await self.analyze(signal, source),
            }

        return await self.run(Actions.ENCODE_SIGNAL, call, operation)

    async def rebuild_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            decoded = _decode_service_request(call.data)
            try:
                signal, rebuild = await self.hass.async_add_executor_job(
                    lambda: rebuild_recognized_signal(
                        decoded.signal,
                        call.data[Fields.REBUILD_ID],
                        carrier_source=decoded.carrier_source,
                    )
                )
                code = encode_raw(signal, signed=True)
            except (IRFormatError, ValueError) as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
            return {
                "format": "raw_signed",
                "code": code,
                "signal": signal_document(signal, "protocol"),
                "analysis": await self.analyze(signal, "provided"),
                "rebuild": rebuild,
            }

        return await self.run(Actions.REBUILD_SIGNAL, call, operation)

    async def store_command(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            source = call.data.get(Fields.SOURCE)
            decoded = _decode_service_signal(
                call.data[Fields.CODE],
                call.data.get(Fields.FORMAT, "raw_signed"),
                (source or {}).get("carrier_frequency"),
            )
            signal = decoded.signal
            await self.store.store_signal(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.NAME],
                encode_raw(signal, signed=True),
                code_format="raw_signed",
                source=source,
                role=call.data.get(Fields.ROLE),
                signal=signal_document(signal, decoded.carrier_source),
                analysis=await self.analyze(signal, decoded.carrier_source),
            )
            return {"status": "saved"}

        return await self.run(Actions.STORE_COMMAND, call, operation)

    async def send_command(self, call: ServiceCall) -> dict[str, Any]:
        try:
            command = self.store.command_at(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
            )
        except ImprintRefineryError as error:
            self._set_error(Actions.SEND_COMMAND, call.data, error)
            raise
        try:
            signal = signal_from_command(command)
        except IRFormatError as error:
            self._set_error(
                Actions.SEND_COMMAND,
                call.data,
                ImprintRefineryError(ERROR_CODE_INVALID, str(error)),
            )
            raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
        return await self.dispatch(Actions.SEND_COMMAND, call.data, signal)

    async def get_library(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            await self.store.async_sync_home_assistant_emitters(
                discover_home_assistant_emitters(self.hass)
            )
            response = self.store.snapshot()
            registry = er.async_get(self.hass)
            for emitter in response.get("emitters", []):
                if emitter.get("transport") == HOME_ASSISTANT_IR:
                    stored_ref = self.store.data["emitters"][emitter["key"]].get(
                        "entity_id"
                    )
                    try:
                        entity_id = er.async_validate_entity_id(registry, stored_ref)
                    except vol.Invalid:
                        entity_id = None
                else:
                    entity_id = registry.async_get_entity_id(
                        Platform.INFRARED, DOMAIN, emitter["key"]
                    )
                emitter["entity_id"] = entity_id or emitter_entity_id(emitter["key"])
                state = self.hass.states.get(entity_id) if entity_id else None
                emitter["available"] = bool(
                    state is not None and state.state != STATE_UNAVAILABLE
                )
            locations = response.get("locations", {})
            if isinstance(locations, dict):
                devices = dr.async_get(self.hass)
                for blueprint in project_library(self.store.data):
                    appliance = (
                        locations.get(blueprint.location, {})
                        .get("appliances", {})
                        .get(blueprint.appliance)
                    )
                    if not isinstance(appliance, dict):
                        continue
                    entity_id = registry.async_get_entity_id(
                        blueprint.platform, DOMAIN, blueprint.entity_key
                    )
                    device = next(
                        iter(
                            devices.async_get_devices(
                                identifiers={(DOMAIN, blueprint.registry_device_key)}
                            )
                        ),
                        None,
                    )
                    appliance["home_assistant"] = {
                        "entity_id": entity_id,
                        "platform": blueprint.platform,
                        "device_id": getattr(device, "id", None),
                        "device_url": (
                            f"/config/devices/device/{device.id}" if device else None
                        ),
                        "configuration_url": blueprint.configuration_url,
                    }
                for blueprint in project_command_buttons(self.store.data):
                    command = (
                        locations.get(blueprint.location, {})
                        .get("appliances", {})
                        .get(blueprint.appliance, {})
                        .get("commands", {})
                        .get(blueprint.command_id or "")
                    )
                    if isinstance(command, dict):
                        command["home_assistant"] = {
                            "entity_id": registry.async_get_entity_id(
                                blueprint.platform, DOMAIN, blueprint.entity_key
                            ),
                            "platform": blueprint.platform,
                        }
            return response

        return await self.run(Actions.GET_LIBRARY, call, operation)

    async def command_history(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            return self.store.history_for(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
            )

        return await self.run(Actions.COMMAND_HISTORY, call, operation)

    async def restore_revision(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            revision = await self.store.restore_revision(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.REVISION_ID],
            )
            return {"status": "restored", "revision_id": revision}

        return await self.run(Actions.RESTORE_REVISION, call, operation)

    async def label_revision(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            await self.store.label_revision(
                call.data[Fields.LOCATION_ID],
                call.data[Fields.APPLIANCE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.REVISION_ID],
                call.data[Fields.LABEL],
            )
            return {"status": "saved"}

        return await self.run(Actions.LABEL_REVISION, call, operation)

    def handler_for(self, service: str) -> Callable[[ServiceCall], Awaitable[Any]]:
        """Return a dedicated handler or a handler built from a mutation plan."""
        if service not in _MUTATIONS:
            return getattr(self, service)

        async def handle(call: ServiceCall) -> dict[str, str]:
            return await self._apply_mutation(service, call)

        return handle

    async def _apply_mutation(self, service: str, call: ServiceCall) -> dict[str, str]:
        plan = _MUTATIONS[service]
        arguments = [call.data[field] for field in plan.required]
        keywords = {
            target: call.data.get(source)
            for source, target in plan.optional
            if plan.include_missing or source in call.data
        }
        if reference := keywords.get("emitter_id"):
            keywords["emitter_id"] = self._resolve_ref(reference)

        async def operation() -> dict[str, str]:
            await getattr(self.store, plan.method)(*arguments, **keywords)
            return {"status": plan.result}

        return await self.run(service, call, operation)


def _schemas() -> dict[str, Any]:
    """Build the authenticated panel action schemas from shared fragments."""
    optional_emitter = {vol.Optional(Fields.EMITTER_ID): non_empty_string}
    positive = vol.All(int, vol.Range(min=1))
    location_key = {vol.Required(Fields.LOCATION_ID): id_schema}
    appliance_key = location_key | {vol.Required(Fields.APPLIANCE_ID): id_schema}
    command_key = appliance_key | {vol.Required(Fields.COMMAND_ID): id_schema}
    location = location_key | {vol.Required(Fields.NAME): non_empty_string}
    device = appliance_key | {
        vol.Required(Fields.NAME): non_empty_string,
        vol.Optional(Fields.APPLIANCE_TYPE, default="generic"): non_empty_string,
        vol.Optional(Fields.PREFERRED_PLATFORM): vol.In(PLATFORM_PREFERENCES),
        vol.Optional(Fields.EMITTER_ID): optional_string,
    }
    command = command_key | {vol.Required(Fields.NAME): non_empty_string}
    signal_input = {
        vol.Required(Fields.CODE): non_empty_string,
        vol.Optional(Fields.FORMAT, default="raw_signed"): vol.In(INPUT_FORMATS),
        vol.Optional(Fields.CARRIER_FREQUENCY): positive,
    }
    schemas: dict[str, Any] = {
        Actions.CANCEL_CAPTURE: vol.Schema(optional_emitter),
        Actions.CAPTURE_SIGNAL: vol.Schema(
            {
                vol.Optional(Fields.TIMEOUT, default=60): positive,
                vol.Optional(Fields.POLL_INTERVAL, default=1): positive,
            }
            | optional_emitter
        ),
        Actions.SEND_SIGNAL: vol.Schema(signal_input | optional_emitter),
        Actions.ANALYZE_SIGNAL: vol.Schema(signal_input),
        Actions.CONVERT_SIGNAL: vol.Schema(
            {
                vol.Required(Fields.CODE): non_empty_string,
                vol.Required(Fields.FORMAT): vol.In(INPUT_FORMATS),
                vol.Required(Fields.OUTPUT_FORMAT): vol.In(OUTPUT_FORMATS),
                vol.Optional(Fields.CARRIER_FREQUENCY): positive,
                vol.Optional(Fields.NAME, default="Command"): non_empty_string,
            }
        ),
        Actions.SEARCH_CATALOG: vol.Schema(
            {
                vol.Optional(Fields.CATEGORY, default=""): cv.string,
                vol.Optional(Fields.BRAND, default=""): cv.string,
                vol.Optional(Fields.MODEL, default=""): cv.string,
            }
        ),
        Actions.GET_CATALOG_PROFILE: vol.Schema(
            {
                vol.Required(Fields.PROFILE_ID): non_empty_string,
                vol.Optional(Fields.LOCATION_ID): id_schema,
                vol.Optional(Fields.APPLIANCE_ID): id_schema,
            }
        ),
        Actions.GUIDED_START: vol.Schema(
            {
                vol.Required(Fields.CATEGORY): non_empty_string,
                vol.Required(Fields.BRAND): non_empty_string,
            }
        ),
        Actions.GUIDED_TEST: vol.Schema(
            {
                vol.Required(Fields.SESSION_ID): non_empty_string,
                vol.Required(Fields.CANDIDATE): non_empty_string,
            }
            | optional_emitter
        ),
        Actions.GUIDED_ANSWER: vol.Schema(
            {
                vol.Required(Fields.SESSION_ID): non_empty_string,
                vol.Required(Fields.CANDIDATE): non_empty_string,
                vol.Required(Fields.RESULT): vol.In(
                    ("worked", "no_response", "not_sure")
                ),
            }
        ),
        Actions.GUIDED_CONTROL: vol.Schema(
            {
                vol.Required(Fields.SESSION_ID): non_empty_string,
                vol.Required(Fields.SESSION_ACTION): vol.In(
                    ("status", "pause", "resume", "cancel")
                ),
            }
        ),
        Actions.MATCH_CATALOG_SIGNAL: vol.Schema(
            signal_input
            | {
                vol.Optional(Fields.LIMIT, default=25): vol.All(
                    int, vol.Range(min=1, max=100)
                ),
            }
        ),
        Actions.INSPECT_IMPORT: vol.Schema(
            {
                vol.Required(Fields.CODE): import_payload,
                vol.Required(Fields.FORMAT): vol.In((*INPUT_FORMATS, "native_json")),
                vol.Optional(Fields.CARRIER_FREQUENCY): positive,
                vol.Optional(Fields.NAME, default="Imported command"): non_empty_string,
            }
        ),
        Actions.EXPORT_BACKUP: vol.Schema(
            {
                vol.Optional(Fields.LOCATION_ID): id_schema,
                vol.Optional(Fields.APPLIANCE_ID): id_schema,
                vol.Optional(Fields.INCLUDE_HISTORY, default=True): cv.boolean,
            }
        ),
        Actions.EXPORT_PROFILE: vol.All(
            vol.Schema(
                {
                    vol.Optional(Fields.LOCATION_ID): id_schema,
                    vol.Optional(Fields.APPLIANCE_ID): id_schema,
                    vol.Required(Fields.OUTPUT_FORMAT): vol.In(PROFILE_OUTPUT_FORMATS),
                }
            ),
            _profile_export_schema,
        ),
        Actions.IMPORT_BACKUP: vol.Schema({vol.Required(Fields.CODE): import_payload}),
        Actions.IMPORT_COMMAND_BACKUP: vol.Schema(
            command_key | {vol.Required(Fields.PAYLOAD): dict}
        ),
        Actions.ENCODE_SIGNAL: vol.Schema(
            {
                vol.Required(Fields.TIMINGS): [
                    vol.All(int, vol.Range(min=1, max=0xFFFF))
                ],
                vol.Optional(Fields.CARRIER_FREQUENCY): positive,
            }
        ),
        Actions.REBUILD_SIGNAL: vol.Schema(
            signal_input | {vol.Required(Fields.REBUILD_ID): non_empty_string}
        ),
        Actions.STORE_COMMAND: vol.Schema(
            command
            | {
                vol.Required(Fields.CODE): non_empty_string,
                vol.Optional(Fields.FORMAT, default="raw_signed"): vol.In(
                    INPUT_FORMATS
                ),
                vol.Optional(Fields.SOURCE): dict,
                vol.Optional(Fields.ROLE): vol.In(("", *SIGNAL_ROLES)),
            }
        ),
        Actions.SEND_COMMAND: vol.Schema(command_key | optional_emitter),
        Actions.GET_LIBRARY: vol.Schema(optional_emitter),
        Actions.COMMAND_HISTORY: vol.Schema(command_key),
        Actions.RESTORE_REVISION: vol.Schema(
            command_key
            | {
                vol.Required(Fields.REVISION_ID): vol.All(
                    vol.Coerce(int), vol.Range(min=1)
                )
            }
        ),
        Actions.LABEL_REVISION: vol.Schema(
            command_key
            | {
                vol.Required(Fields.REVISION_ID): vol.All(
                    vol.Coerce(int), vol.Range(min=1)
                ),
                vol.Required(Fields.LABEL): vol.All(cv.string, vol.Length(max=80)),
            }
        ),
        Actions.CREATE_LOCATION: vol.Schema(location),
        Actions.CREATE_APPLIANCE: vol.Schema(device),
        Actions.CREATE_COMMAND: vol.Schema(command),
        Actions.UPDATE_COMMAND: vol.All(
            vol.Schema(
                command_key
                | {
                    vol.Optional(Fields.NAME): non_empty_string,
                    vol.Optional(Fields.ICON): icon_schema,
                    vol.Optional(Fields.ROLE): vol.In(("", *SIGNAL_ROLES)),
                }
            ),
            _at_least_one(Fields.NAME, Fields.ICON, Fields.ROLE),
        ),
        Actions.UPDATE_APPLIANCE: vol.All(
            vol.Schema(
                appliance_key
                | {
                    vol.Optional(Fields.NAME): non_empty_string,
                    vol.Optional(Fields.APPLIANCE_TYPE): non_empty_string,
                    vol.Optional(Fields.PREFERRED_PLATFORM): vol.In(
                        PLATFORM_PREFERENCES
                    ),
                    vol.Optional(Fields.EMITTER_ID): optional_string,
                }
            ),
            _at_least_one(
                Fields.NAME,
                Fields.APPLIANCE_TYPE,
                Fields.PREFERRED_PLATFORM,
                Fields.EMITTER_ID,
            ),
        ),
        Actions.RENAME_LOCATION: vol.Schema(location),
        Actions.RENAME_APPLIANCE: vol.Schema(
            appliance_key | {vol.Required(Fields.NAME): non_empty_string}
        ),
        Actions.RENAME_COMMAND: vol.Schema(command),
        Actions.MOVE_COMMAND: vol.Schema(
            command_key
            | {
                vol.Required(Fields.TARGET_LOCATION_ID): id_schema,
                vol.Required(Fields.TARGET_APPLIANCE_ID): id_schema,
            }
        ),
        Actions.MOVE_APPLIANCE: vol.Schema(
            appliance_key | {vol.Required(Fields.TARGET_LOCATION_ID): id_schema}
        ),
        Actions.REMOVE_LOCATION: vol.Schema(
            location_key | {vol.Required(Fields.CONFIRM): cv.boolean}
        ),
        Actions.REMOVE_APPLIANCE: vol.Schema(
            appliance_key | {vol.Required(Fields.CONFIRM): cv.boolean}
        ),
        Actions.REMOVE_COMMAND: vol.Schema(command_key),
    }
    return schemas


@websocket_api.websocket_command(
    {
        vol.Required("type"): PANEL_COMMAND,
        vol.Required("action"): vol.In(PANEL_ACTIONS),
        vol.Optional("data", default={}): dict,
    }
)
@websocket_api.async_response
async def websocket_execute(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Execute one validated panel operation outside the public action picker."""
    api: ServiceAPI | None = hass.data.get(DOMAIN, {}).get("service_api")
    if api is None:
        connection.send_error(msg["id"], "not_loaded", "Imprint Refinery is not loaded")
        return
    action = msg["action"]
    try:
        data = _schemas()[action](msg["data"])
        call = ServiceCall(
            hass,
            DOMAIN,
            action,
            data,
            connection.context(msg),
            return_response=True,
        )
        result = await api.handler_for(action)(call)
    except (vol.Invalid, HomeAssistantError, ImprintRefineryError) as error:
        connection.send_error(msg["id"], "operation_failed", str(error))
        return
    connection.send_result(msg["id"], result)


@callback
def register_panel_api(hass: HomeAssistant) -> None:
    """Register the single authenticated command used by the panel."""
    websocket_api.async_register_command(hass, websocket_execute)


def register_services(
    hass: HomeAssistant, resolve_emitter_ref: Callable[[str], str]
) -> ServiceAPI:
    """Register the single public entity-targeted send action."""
    api = ServiceAPI(hass, resolve_emitter_ref)
    hass.data[DOMAIN]["service_api"] = api
    service_helper.async_register_platform_entity_service(
        hass,
        DOMAIN,
        Actions.SEND_COMMAND,
        entity_domain="remote",
        schema={vol.Required(Fields.COMMAND_ID): id_schema},
        func="async_send_stored_command",
    )
    return api
