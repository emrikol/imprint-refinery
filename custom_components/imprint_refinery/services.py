"""Declarative service API for the Imprint Refinery integration."""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
import re
from typing import Any

from homeassistant.components import infrared, websocket_api
from homeassistant.components.infrared import InfraredReceivedSignal
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
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
    CONF_IEEE,
    DOMAIN,
    EMITTER_SUBENTRY_TYPE,
    ERROR_CAPTURE_TIMEOUT,
    ERROR_CATALOG_UNAVAILABLE,
    ERROR_CODE_EMPTY,
    ERROR_CODE_INVALID,
    ERROR_COMMAND_NOT_FOUND,
    ERROR_EMITTER_NOT_CONFIGURED,
    ERROR_GUIDED_SESSION,
)
from .device_bridge import remove_consumer_device_entries
from .emitter_identity import normalize_emitter_ref
from .entity_projection import (
    appliance_configuration_url,
    project_command_buttons,
    project_library,
)
from .errors import ImprintRefineryError
from .hardware import async_compatibility_adapter_available, discover_infrared_hardware
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
    detect_import_format,
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
from .signal_command import RawSignalCommand, signal_from_command
from .storage import SignalLibraryStore

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
    Actions.DUPLICATE_COMMAND,
    Actions.CREATE_REMOTE_PROFILE,
    Actions.UPDATE_REMOTE_PROFILE,
    Actions.DUPLICATE_REMOTE_PROFILE,
    Actions.CREATE_APPLIANCE,
    Actions.CREATE_COMMAND,
    Actions.UPDATE_COMMAND,
    Actions.UPDATE_APPLIANCE,
    Actions.RENAME_COMMAND,
    Actions.RESTORE_REVISION,
    Actions.LABEL_REVISION,
    Actions.REMOVE_REMOTE_PROFILE,
    Actions.REMOVE_APPLIANCE,
    Actions.REMOVE_COMMAND,
)

REGISTERED_SERVICES: tuple[str, ...] = ()
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
    Actions.CREATE_REMOTE_PROFILE: MutationPlan(
        "create_remote_profile",
        (Fields.REMOTE_PROFILE_ID, Fields.NAME),
        ((Fields.APPLIANCE_TYPE, "appliance_type"),),
        include_missing=True,
    ),
    Actions.UPDATE_REMOTE_PROFILE: MutationPlan(
        "update_remote_profile",
        (Fields.REMOTE_PROFILE_ID,),
        (
            (Fields.NAME, "name"),
            (Fields.APPLIANCE_TYPE, "appliance_type"),
        ),
        include_missing=True,
    ),
    Actions.DUPLICATE_REMOTE_PROFILE: MutationPlan(
        "duplicate_remote_profile",
        (Fields.REMOTE_PROFILE_ID, Fields.TARGET_REMOTE_PROFILE_ID, Fields.NAME),
    ),
    Actions.CREATE_COMMAND: MutationPlan(
        "draft_command",
        (Fields.REMOTE_PROFILE_ID, Fields.COMMAND_ID, Fields.NAME),
        ((Fields.ROLE, "role"),),
        include_missing=True,
    ),
    Actions.UPDATE_COMMAND: MutationPlan(
        "revise_command",
        (Fields.REMOTE_PROFILE_ID, Fields.COMMAND_ID),
        ((Fields.NAME, "name"), (Fields.ICON, "icon"), (Fields.ROLE, "role")),
        include_missing=True,
    ),
    Actions.RENAME_COMMAND: MutationPlan(
        "set_command_name",
        (Fields.REMOTE_PROFILE_ID, Fields.COMMAND_ID, Fields.NAME),
    ),
    Actions.MOVE_COMMAND: MutationPlan(
        "relocate_command",
        (
            Fields.REMOTE_PROFILE_ID,
            Fields.COMMAND_ID,
            Fields.TARGET_REMOTE_PROFILE_ID,
        ),
        result="moved",
    ),
    Actions.DUPLICATE_COMMAND: MutationPlan(
        "duplicate_command",
        (
            Fields.REMOTE_PROFILE_ID,
            Fields.COMMAND_ID,
            Fields.TARGET_REMOTE_PROFILE_ID,
            Fields.TARGET_COMMAND_ID,
            Fields.NAME,
        ),
        result="duplicated",
    ),
    Actions.REMOVE_REMOTE_PROFILE: MutationPlan(
        "remove_remote_profile",
        (Fields.REMOTE_PROFILE_ID, Fields.CONFIRM),
        result="deleted",
    ),
    Actions.REMOVE_COMMAND: MutationPlan(
        "remove_command",
        (Fields.REMOTE_PROFILE_ID, Fields.COMMAND_ID),
        result="deleted",
    ),
}


class ServiceAPI:
    """Stateful service handlers sharing registry and transport dependencies."""

    def __init__(
        self,
        hass: HomeAssistant,
        resolve_emitter_ref: Callable[[str], str] | None = None,
    ) -> None:
        del resolve_emitter_ref
        runtime = hass.data[DOMAIN]
        self.hass = hass
        self.store: SignalLibraryStore = runtime["store"]
        self.capture_tasks: dict[str, asyncio.Task] = runtime["capture_tasks"]
        self.catalog_sessions: GuidedCatalogSessionManager = runtime.setdefault(
            "catalog_sessions", GuidedCatalogSessionManager()
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
        del action, call, final_state, start_state
        return await operation()

    async def analyze(self, signal: IRSignal, carrier_source: str) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(
            lambda: analyze_signal(signal, carrier_source=carrier_source)
        )

    async def dispatch(
        self,
        action: str,
        data: dict[str, Any],
        signal: IRSignal,
        *,
        context: Any | None = None,
    ) -> dict[str, Any]:
        del action
        appliance_id = data.get(Fields.APPLIANCE_ID)
        emitter_ref = None
        if appliance_id:
            emitter_ref = (
                self.store.data["appliances"]
                .get(appliance_id, {})
                .get("infrared_emitter_ref")
            )
        else:
            emitter_ref = data.get(Fields.INFRARED_EMITTER_REF)
        if not emitter_ref:
            raise ImprintRefineryError(
                ERROR_EMITTER_NOT_CONFIGURED,
                "No infrared emitter is assigned for this operation",
            )
        await infrared.async_send_command(
            self.hass,
            str(emitter_ref),
            RawSignalCommand(signal),
            context=context,
        )
        return {
            "status": States.SENT_UNCONFIRMED,
            "emitter_ref": str(emitter_ref),
            "delivery_confirmed": False,
        }

    async def cancel_capture(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            receiver_ref = call.data[Fields.INFRARED_RECEIVER_REF]
            task = self.capture_tasks.pop(receiver_ref, None)
            if task is not None and task is not asyncio.current_task():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            return {"status": "capture_cancelled"}

        return await self.run(Actions.CANCEL_CAPTURE, call, operation)

    async def capture_signal(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            receiver_ref = call.data[Fields.INFRARED_RECEIVER_REF]
            previous = self.capture_tasks.pop(receiver_ref, None)
            if previous is not None and previous is not asyncio.current_task():
                previous.cancel()
                await asyncio.gather(previous, return_exceptions=True)
            current = asyncio.current_task()
            if current is not None:
                self.capture_tasks[receiver_ref] = current
            loop = asyncio.get_running_loop()
            result: asyncio.Future[InfraredReceivedSignal] = loop.create_future()

            @callback
            def received(received_signal: InfraredReceivedSignal) -> None:
                if not result.done():
                    result.set_result(received_signal)

            remove = infrared.async_subscribe_receiver(
                self.hass, receiver_ref, received
            )
            try:
                try:
                    captured = await asyncio.wait_for(
                        result, timeout=call.data[Fields.TIMEOUT]
                    )
                except TimeoutError as error:
                    raise ImprintRefineryError(
                        ERROR_CAPTURE_TIMEOUT,
                        "No new IR signal was captured within "
                        f"{call.data[Fields.TIMEOUT]} seconds",
                    ) from error
                carrier = captured.modulation or DEFAULT_CARRIER_HZ
                signal = IRSignal([abs(value) for value in captured.timings], carrier)
                carrier_source = "measured" if captured.modulation else "assumed"
                return {
                    "code": encode_raw(signal, signed=True),
                    "format": "raw_signed",
                    "signal": signal_document(signal, carrier_source),
                }
            finally:
                remove()
                if self.capture_tasks.get(receiver_ref) is current:
                    self.capture_tasks.pop(receiver_ref, None)

        return await self.run(
            Actions.CAPTURE_SIGNAL,
            call,
            operation,
            final_state=States.CAPTURE_READY,
            start_state=States.CAPTURING,
        )

    async def send_signal(self, call: ServiceCall) -> dict[str, Any]:
        signal = _decode_service_request(call.data).signal
        return await self.dispatch(
            Actions.SEND_SIGNAL, call.data, signal, context=call.context
        )

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
                    call.data[Fields.CATALOG_PROFILE_ID],
                    registry_data=self.store.data,
                    remote_profile_id=call.data.get(Fields.REMOTE_PROFILE_ID),
                )
            )
        except CatalogUnavailableError as error:
            raise ImprintRefineryError(ERROR_CATALOG_UNAVAILABLE, str(error)) from error
        except KeyError as error:
            raise ImprintRefineryError(
                ERROR_CODE_INVALID,
                f"Unknown catalog profile: {call.data[Fields.CATALOG_PROFILE_ID]}",
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
            dispatch = await self.dispatch(
                Actions.GUIDED_TEST, call.data, signal, context=call.context
            )
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
            requested_format = call.data[Fields.FORMAT]
            try:
                input_format = (
                    detect_import_format(call.data[Fields.CODE])
                    if requested_format == "auto"
                    else requested_format
                )
            except IRFormatError as error:
                raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
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
                                "remote_profile_id": item["remote_profile_id"],
                                "history": backup["history"],
                            },
                        }
                    )
                return {
                    "format": "native_json",
                    "command_count": len(commands),
                    "scope": backup["scope"],
                    "history": backup["history"],
                    "remote_profiles": backup["remote_profiles"],
                    "appliances": backup["appliances"],
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
            document = self.store.export_backup(
                remote_profile_id=call.data.get(Fields.REMOTE_PROFILE_ID),
                include_history=call.data[Fields.INCLUDE_HISTORY],
            )
            if document.get("scope") != "library":
                return document
            devices = dr.async_get(self.hass)
            areas = ar.async_get(self.hass)
            for appliance_id, appliance in document.get("appliances", {}).items():
                device = next(
                    iter(
                        devices.async_get_devices(identifiers={(DOMAIN, appliance_id)})
                    ),
                    None,
                )
                area = (
                    areas.async_get_area(device.area_id)
                    if device is not None and device.area_id
                    else None
                )
                if area is not None:
                    appliance["area_name"] = area.name
            return document

        return await self.run(Actions.EXPORT_BACKUP, call, operation)

    async def export_profile(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            remote_profile_id = call.data.get(Fields.REMOTE_PROFILE_ID)
            output_format = call.data[Fields.OUTPUT_FORMAT]
            profiles = self.store.data.get("remote_profiles", {})
            scope = "remote_profile" if remote_profile_id else "library"
            if remote_profile_id:
                try:
                    selected = {remote_profile_id: profiles[remote_profile_id]}
                except KeyError as error:
                    raise ImprintRefineryError(
                        ERROR_COMMAND_NOT_FOUND,
                        f"Remote profile {remote_profile_id} was not found",
                    ) from error
                profile_name = str(
                    selected[remote_profile_id].get("name", remote_profile_id)
                )
                filename_stem = _download_filename_stem(profile_name)
            else:
                selected = profiles
                profile_name = "Imprint Refinery Library"
                filename_stem = "imprint-refinery-library"

            commands: list[tuple[str, IRSignal]] = []
            used_names: set[str] = set()
            for current_profile_id, profile in sorted(selected.items()):
                for command_id, command in sorted(profile.get("commands", {}).items()):
                    display = str(command.get("name") or command_id)
                    if scope == "library":
                        display = " / ".join(
                            (
                                str(profile.get("name") or current_profile_id),
                                display,
                            )
                        )
                    name = _unique_profile_name(display, command_id, used_names)
                    try:
                        signal = signal_from_command(command)
                    except (IRFormatError, KeyError, TypeError, ValueError) as error:
                        raise ImprintRefineryError(
                            ERROR_CODE_INVALID,
                            f"Cannot export {current_profile_id}/{command_id}: {error}",
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
                call.data[Fields.REMOTE_PROFILE_ID],
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
                call.data[Fields.REMOTE_PROFILE_ID],
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
        command = self.store.command_for_appliance(
            call.data[Fields.APPLIANCE_ID],
            call.data[Fields.COMMAND_ID],
        )
        try:
            signal = signal_from_command(command)
        except IRFormatError as error:
            raise ImprintRefineryError(ERROR_CODE_INVALID, str(error)) from error
        return await self.dispatch(
            Actions.SEND_COMMAND, call.data, signal, context=call.context
        )

    async def get_library(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            await self.store.async_refresh_analysis()
            response = self.store.snapshot()
            response["infrared_hardware"] = discover_infrared_hardware(self.hass)
            entry_id = self.hass.data.get(DOMAIN, {}).get("config_entry_id")
            entry = (
                self.hass.config_entries.async_get_entry(entry_id)
                if entry_id is not None
                else None
            )
            configured_emitter_ids = (
                {
                    normalize_emitter_ref(
                        str(subentry.unique_id or subentry.data.get(CONF_IEEE, ""))
                    )
                    for subentry in entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE)
                }
                if entry is not None
                else set()
            )
            core_infrared_device_ids = {
                str(item["device_id"])
                for kind in ("emitters", "receivers")
                for item in response["infrared_hardware"][kind]
                if item.get("device_id")
            }
            response["infrared_hardware"][
                "compatibility_adapter_available"
            ] = await async_compatibility_adapter_available(
                self.hass,
                configured_emitter_ids=configured_emitter_ids,
                core_infrared_device_ids=core_infrared_device_ids,
            )
            registry = er.async_get(self.hass)
            devices = dr.async_get(self.hass)
            areas = ar.async_get(self.hass)
            response["areas"] = [
                {"area_id": area.id, "name": area.name}
                for area in sorted(
                    areas.async_list_areas(), key=lambda item: item.name.casefold()
                )
            ]
            live_emitters = {
                item["ref"]: item for item in response["infrared_hardware"]["emitters"]
            }
            blueprints = {
                item.appliance: item for item in project_library(self.store.data)
            }
            command_buttons: dict[str, dict[str, str]] = {}
            for item in project_command_buttons(self.store.data):
                command_buttons.setdefault(item.appliance, {})[
                    item.command_id or ""
                ] = registry.async_get_entity_id(item.platform, DOMAIN, item.entity_key)
            for appliance_id, appliance in response["appliances"].items():
                device = next(
                    iter(
                        devices.async_get_devices(identifiers={(DOMAIN, appliance_id)})
                    ),
                    None,
                )
                blueprint = blueprints.get(appliance_id)
                emitter = live_emitters.get(appliance.get("infrared_emitter_ref"))
                appliance["route_status"] = (
                    "unassigned"
                    if not appliance.get("infrared_emitter_ref")
                    else "missing"
                    if emitter is None
                    else "ready"
                    if emitter["available"]
                    else "unavailable"
                )
                area = (
                    areas.async_get_area(device.area_id)
                    if device is not None and device.area_id
                    else None
                )
                appliance["area"] = (
                    {"area_id": area.id, "name": area.name} if area else None
                )
                entity_id = (
                    registry.async_get_entity_id(
                        blueprint.platform, DOMAIN, blueprint.entity_key
                    )
                    if blueprint
                    else None
                )
                entity_state = self.hass.states.get(entity_id) if entity_id else None
                appliance["home_assistant"] = {
                    "entity_id": entity_id,
                    "available": bool(
                        entity_state is not None
                        and entity_state.state != STATE_UNAVAILABLE
                    ),
                    "platform": blueprint.platform if blueprint else None,
                    "device_id": getattr(device, "id", None),
                    "device_url": (
                        f"/config/devices/device/{device.id}" if device else None
                    ),
                    "configuration_url": (
                        blueprint.configuration_url if blueprint else None
                    ),
                    "command_entities": command_buttons.get(appliance_id, {}),
                }
            return response

        return await self.run(Actions.GET_LIBRARY, call, operation)

    async def command_history(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            return self.store.history_for(
                call.data[Fields.REMOTE_PROFILE_ID],
                call.data[Fields.COMMAND_ID],
            )

        return await self.run(Actions.COMMAND_HISTORY, call, operation)

    async def restore_revision(self, call: ServiceCall) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            revision = await self.store.restore_revision(
                call.data[Fields.REMOTE_PROFILE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.REVISION_ID],
            )
            return {"status": "restored", "revision_id": revision}

        return await self.run(Actions.RESTORE_REVISION, call, operation)

    async def label_revision(self, call: ServiceCall) -> dict[str, str]:
        async def operation() -> dict[str, str]:
            await self.store.label_revision(
                call.data[Fields.REMOTE_PROFILE_ID],
                call.data[Fields.COMMAND_ID],
                call.data[Fields.REVISION_ID],
                call.data[Fields.LABEL],
            )
            return {"status": "saved"}

        return await self.run(Actions.LABEL_REVISION, call, operation)

    async def create_appliance(self, call: ServiceCall) -> dict[str, str]:
        """Create one logical appliance and its Home Assistant device."""
        await self.store.create_appliance(
            call.data[Fields.APPLIANCE_ID],
            call.data[Fields.NAME],
            remote_profile_id=call.data.get(Fields.REMOTE_PROFILE_ID),
            infrared_emitter_ref=call.data.get(Fields.INFRARED_EMITTER_REF),
            preferred_platform=call.data.get(Fields.PREFERRED_PLATFORM, "auto"),
        )
        self._sync_appliance_device(
            call.data[Fields.APPLIANCE_ID],
            area_id=call.data.get(Fields.AREA_ID),
        )
        return {"status": "saved"}

    async def update_appliance(self, call: ServiceCall) -> dict[str, str]:
        """Update routing/library assignment and authoritative HA Area."""
        await self.store.update_appliance(
            call.data[Fields.APPLIANCE_ID],
            name=call.data.get(Fields.NAME),
            remote_profile_id=call.data.get(Fields.REMOTE_PROFILE_ID),
            infrared_emitter_ref=call.data.get(Fields.INFRARED_EMITTER_REF),
            preferred_platform=call.data.get(Fields.PREFERRED_PLATFORM),
        )
        self._sync_appliance_device(
            call.data[Fields.APPLIANCE_ID],
            area_id=call.data.get(Fields.AREA_ID),
        )
        return {"status": "saved"}

    async def remove_appliance(self, call: ServiceCall) -> dict[str, str]:
        """Remove one appliance without touching its shared remote profile."""
        appliance_id = call.data[Fields.APPLIANCE_ID]
        await self.store.remove_appliance(appliance_id, call.data[Fields.CONFIRM])
        remove_consumer_device_entries(self.hass, appliance_id)
        return {"status": "deleted"}

    def _sync_appliance_device(self, appliance_id: str, *, area_id: str | None) -> None:
        appliance = self.store.data["appliances"][appliance_id]
        entry_id = self.hass.data[DOMAIN].get("config_entry_id")
        if not entry_id:
            entries = self.hass.config_entries.async_entries(DOMAIN)
            if not entries:
                return
            entry_id = entries[0].entry_id
        via_device_id = None
        emitter_ref = appliance.get("infrared_emitter_ref")
        if emitter_ref:
            registry = er.async_get(self.hass)
            try:
                emitter_entity_id = er.async_validate_entity_id(registry, emitter_ref)
            except vol.Invalid:
                emitter_entity_id = None
            emitter_entry = (
                registry.async_get(emitter_entity_id) if emitter_entity_id else None
            )
            via_device_id = getattr(emitter_entry, "device_id", None)
        devices = dr.async_get(self.hass)
        device = devices.async_get_or_create(
            config_entry_id=entry_id,
            identifiers={(DOMAIN, appliance_id)},
            name=appliance["name"],
            via_device_id=via_device_id,
            configuration_url=appliance_configuration_url(appliance_id),
        )
        changes: dict[str, Any] = {}
        if device.name != appliance["name"]:
            changes["name"] = appliance["name"]
        if device.via_device_id != via_device_id:
            changes["via_device_id"] = via_device_id
        if area_id is not None and device.area_id != (area_id or None):
            changes["area_id"] = area_id or None
        if changes:
            devices.async_update_device(device.id, **changes)

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

        async def operation() -> dict[str, str]:
            await getattr(self.store, plan.method)(*arguments, **keywords)
            return {"status": plan.result}

        return await self.run(service, call, operation)


def _schemas() -> dict[str, Any]:
    """Build the authenticated panel action schemas from shared fragments."""
    positive = vol.All(int, vol.Range(min=1))
    profile_key = {vol.Required(Fields.REMOTE_PROFILE_ID): id_schema}
    appliance_key = {vol.Required(Fields.APPLIANCE_ID): id_schema}
    command_key = profile_key | {vol.Required(Fields.COMMAND_ID): id_schema}
    appliance = appliance_key | {
        vol.Required(Fields.NAME): non_empty_string,
        vol.Optional(Fields.REMOTE_PROFILE_ID): optional_string,
        vol.Optional(Fields.INFRARED_EMITTER_REF): optional_string,
        vol.Optional(Fields.AREA_ID): optional_string,
        vol.Optional(Fields.PREFERRED_PLATFORM): vol.In(PLATFORM_PREFERENCES),
    }
    command = command_key | {vol.Required(Fields.NAME): non_empty_string}
    signal_input = {
        vol.Required(Fields.CODE): non_empty_string,
        vol.Optional(Fields.FORMAT, default="raw_signed"): vol.In(INPUT_FORMATS),
        vol.Optional(Fields.CARRIER_FREQUENCY): positive,
    }
    schemas: dict[str, Any] = {
        Actions.CANCEL_CAPTURE: vol.Schema(
            {vol.Required(Fields.INFRARED_RECEIVER_REF): non_empty_string}
        ),
        Actions.CAPTURE_SIGNAL: vol.Schema(
            {
                vol.Required(Fields.INFRARED_RECEIVER_REF): non_empty_string,
                vol.Optional(Fields.TIMEOUT, default=60): positive,
            }
        ),
        Actions.SEND_SIGNAL: vol.Schema(
            signal_input | {vol.Required(Fields.INFRARED_EMITTER_REF): non_empty_string}
        ),
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
                vol.Required(Fields.CATALOG_PROFILE_ID): non_empty_string,
                vol.Optional(Fields.REMOTE_PROFILE_ID): id_schema,
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
                vol.Required(Fields.INFRARED_EMITTER_REF): non_empty_string,
            }
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
                vol.Required(Fields.FORMAT): vol.In(
                    (*INPUT_FORMATS, "native_json", "auto")
                ),
                vol.Optional(Fields.CARRIER_FREQUENCY): positive,
                vol.Optional(Fields.NAME, default="Imported command"): non_empty_string,
            }
        ),
        Actions.EXPORT_BACKUP: vol.Schema(
            {
                vol.Optional(Fields.REMOTE_PROFILE_ID): id_schema,
                vol.Optional(Fields.INCLUDE_HISTORY, default=True): cv.boolean,
            }
        ),
        Actions.EXPORT_PROFILE: vol.Schema(
            {
                vol.Optional(Fields.REMOTE_PROFILE_ID): id_schema,
                vol.Required(Fields.OUTPUT_FORMAT): vol.In(PROFILE_OUTPUT_FORMATS),
            }
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
        Actions.SEND_COMMAND: vol.Schema(
            appliance_key | {vol.Required(Fields.COMMAND_ID): id_schema}
        ),
        Actions.GET_LIBRARY: vol.Schema({}),
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
        Actions.CREATE_REMOTE_PROFILE: vol.Schema(
            profile_key
            | {
                vol.Required(Fields.NAME): non_empty_string,
                vol.Optional(
                    Fields.APPLIANCE_TYPE, default="generic"
                ): non_empty_string,
            }
        ),
        Actions.UPDATE_REMOTE_PROFILE: vol.All(
            vol.Schema(
                profile_key
                | {
                    vol.Optional(Fields.NAME): non_empty_string,
                    vol.Optional(Fields.APPLIANCE_TYPE): non_empty_string,
                }
            ),
            _at_least_one(Fields.NAME, Fields.APPLIANCE_TYPE),
        ),
        Actions.DUPLICATE_REMOTE_PROFILE: vol.Schema(
            profile_key
            | {
                vol.Required(Fields.TARGET_REMOTE_PROFILE_ID): id_schema,
                vol.Required(Fields.NAME): non_empty_string,
            }
        ),
        Actions.CREATE_APPLIANCE: vol.Schema(appliance),
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
                    vol.Optional(Fields.REMOTE_PROFILE_ID): optional_string,
                    vol.Optional(Fields.INFRARED_EMITTER_REF): optional_string,
                    vol.Optional(Fields.AREA_ID): optional_string,
                    vol.Optional(Fields.PREFERRED_PLATFORM): vol.In(
                        PLATFORM_PREFERENCES
                    ),
                }
            ),
            _at_least_one(
                Fields.NAME,
                Fields.REMOTE_PROFILE_ID,
                Fields.INFRARED_EMITTER_REF,
                Fields.AREA_ID,
                Fields.PREFERRED_PLATFORM,
            ),
        ),
        Actions.RENAME_COMMAND: vol.Schema(command),
        Actions.MOVE_COMMAND: vol.Schema(
            command_key | {vol.Required(Fields.TARGET_REMOTE_PROFILE_ID): id_schema}
        ),
        Actions.DUPLICATE_COMMAND: vol.Schema(
            command_key
            | {
                vol.Required(Fields.TARGET_REMOTE_PROFILE_ID): id_schema,
                vol.Required(Fields.TARGET_COMMAND_ID): id_schema,
                vol.Required(Fields.NAME): non_empty_string,
            }
        ),
        Actions.REMOVE_REMOTE_PROFILE: vol.Schema(
            profile_key | {vol.Required(Fields.CONFIRM): cv.boolean}
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


def register_services(hass: HomeAssistant) -> ServiceAPI:
    """Install the private panel API without public integration actions."""
    api = ServiceAPI(hass)
    hass.data[DOMAIN]["service_api"] = api
    return api
