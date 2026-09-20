"""Home Assistant persistence adapter for the Imprint Refinery library."""

from collections.abc import Callable
from copy import deepcopy
from typing import Any, TypeVar

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .backup import BackupError, export_backup, inspect_backup, normalize_import_command
from .const import (
    ERROR_STORAGE_ERROR,
    HOME_ASSISTANT_IR,
    SIGNAL_REGISTRY_UPDATED,
    ZHA_BRIDGE,
)
from .errors import ImprintRefineryError
from .library import LIBRARY_SCHEMA, SignalLibrary

# Home Assistant's Store envelope stays at version 1. The independently
# versioned library document is migrated by load_library before it is saved.
STORAGE_VERSION = 1
STORAGE_KEY = LIBRARY_SCHEMA
_Result = TypeVar("_Result")


class SignalLibraryStore:
    """Persist domain operations and roll back failed Home Assistant writes."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._library = SignalLibrary()

    @property
    def hass(self) -> HomeAssistant:
        return self._hass

    @property
    def data(self) -> dict[str, Any]:
        return self._library.document

    @data.setter
    def data(self, value: dict[str, Any]) -> None:
        # Lightweight tests seed partial documents directly. Persisted data still
        # enters only through SignalLibrary's strict current-version loader.
        model = SignalLibrary.__new__(SignalLibrary)
        model.document = value
        self._library = model

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored is None:
            self._library = SignalLibrary()
            return
        self._library = SignalLibrary(stored)
        if self._library.document != stored:
            await self._store.async_save(self._library.document)

    async def async_save(self) -> None:
        await self._store.async_save(self.data)
        async_dispatcher_send(self._hass, SIGNAL_REGISTRY_UPDATED)

    async def _commit(self, operation: Callable[[], _Result]) -> _Result:
        before = deepcopy(self.data)
        try:
            result = operation()
            if self.data != before:
                await self.async_save()
        except Exception:
            self._library.document = before
            raise
        else:
            return result

    async def async_upsert_emitter_from_entry(self, entry_data: dict[str, Any]) -> str:
        return await self._commit(lambda: self._library.upsert_emitter(entry_data))

    async def async_reconcile_emitters(
        self, valid_keys: set[str], transport: str = ZHA_BRIDGE
    ) -> None:
        await self._commit(lambda: self._library.retain_emitters(valid_keys, transport))

    async def async_sync_home_assistant_emitters(
        self, records: list[dict[str, Any]]
    ) -> None:
        """Reconcile native Home Assistant infrared endpoints in one write."""

        def operation() -> None:
            valid = {self._library.upsert_emitter(record) for record in records}
            self._library.retain_emitters(valid, HOME_ASSISTANT_IR)

        await self._commit(operation)

    def choose_emitter(self, emitter_id: str | None = None) -> dict[str, Any]:
        return self._library.choose_emitter(emitter_id)

    async def add_location(self, location_id: str, name: str) -> None:
        await self._commit(lambda: self._library.put_location(location_id, name))

    async def rename_location(self, location_id: str, name: str) -> None:
        await self._commit(lambda: self._library.set_location_name(location_id, name))

    async def delete_location(self, location_id: str, confirm: bool) -> None:
        await self._commit(
            lambda: self._library.remove_location(location_id, confirmed=confirm)
        )

    async def create_appliance(
        self,
        location_id: str,
        appliance_id: str,
        name: str,
        appliance_type: str,
        preferred_platform: str | None = None,
        emitter_id: str | None = None,
    ) -> None:
        await self._commit(
            lambda: self._library.put_appliance(
                location_id,
                appliance_id,
                name,
                appliance_type,
                preferred_platform=preferred_platform,
                emitter_id=emitter_id,
            )
        )

    async def set_appliance_name(
        self, location_id: str, appliance_id: str, name: str
    ) -> None:
        await self._commit(
            lambda: self._library.patch_appliance(location_id, appliance_id, name=name)
        )

    async def revise_appliance(
        self,
        location_id: str,
        appliance_id: str,
        *,
        name: str | None = None,
        appliance_type: str | None = None,
        preferred_platform: str | None = None,
        emitter_id: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if appliance_type is not None:
            patch["appliance_type"] = appliance_type
        if preferred_platform is not None:
            patch["preferred_platform"] = preferred_platform
        if emitter_id is not None:
            patch["emitter_id"] = emitter_id
        await self._commit(
            lambda: self._library.patch_appliance(location_id, appliance_id, **patch)
        )

    async def remove_appliance(
        self, location_id: str, appliance_id: str, confirm: bool
    ) -> None:
        await self._commit(
            lambda: self._library.remove_appliance(
                location_id, appliance_id, confirmed=confirm
            )
        )

    async def relocate_appliance(
        self, location_id: str, appliance_id: str, target_location_id: str
    ) -> None:
        await self._commit(
            lambda: self._library.move_appliance(
                location_id, appliance_id, target_location_id
            )
        )

    async def draft_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        name: str,
        role: str | None = None,
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.put_command_placeholder(
                location_id,
                appliance_id,
                command_id,
                name,
                role,
                timestamp=timestamp,
            )
        )

    async def set_command_name(
        self, location_id: str, appliance_id: str, command_id: str, name: str
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.set_command_name(
                location_id,
                appliance_id,
                command_id,
                name,
                timestamp=timestamp,
            )
        )

    async def remove_command(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> None:
        await self._commit(
            lambda: self._library.remove_command(location_id, appliance_id, command_id)
        )

    async def relocate_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        target_location_id: str,
        target_ir_device_id: str,
    ) -> None:
        await self._commit(
            lambda: self._library.move_command(
                location_id,
                appliance_id,
                command_id,
                target_location_id,
                target_ir_device_id,
            )
        )

    async def store_signal(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        name: str,
        code: str,
        code_format: str = "raw_signed",
        source: dict[str, Any] | None = None,
        role: str | None = None,
        signal: dict[str, Any] | None = None,
        analysis: dict[str, Any] | None = None,
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.store_command(
                location_id,
                appliance_id,
                command_id,
                name=name,
                code=code,
                code_format=code_format,
                source=source,
                role=role,
                signal=signal,
                analysis=analysis,
                timestamp=timestamp,
            )
        )

    async def revise_command(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        name: str | None = None,
        icon: str | None = None,
        role: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if icon is not None:
            patch["icon"] = icon
        if role is not None:
            patch["role"] = role
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.patch_command(
                location_id,
                appliance_id,
                command_id,
                **patch,
                timestamp=timestamp,
            )
        )

    async def restore_revision(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        revision_id: int,
    ) -> int:
        timestamp = dt_util.utcnow().isoformat()
        return await self._commit(
            lambda: self._library.restore_command(
                location_id,
                appliance_id,
                command_id,
                revision_id,
                timestamp=timestamp,
            )
        )

    async def label_revision(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        revision_id: int,
        label: str,
    ) -> None:
        await self._commit(
            lambda: self._library.label_revision(
                location_id, appliance_id, command_id, revision_id, label
            )
        )

    def export_backup(
        self,
        *,
        location_id: str | None = None,
        appliance_id: str | None = None,
        include_history: bool = True,
    ) -> dict[str, Any]:
        try:
            return export_backup(
                self.data,
                location_id=location_id,
                appliance_id=appliance_id,
                include_history=include_history,
            )
        except BackupError as error:
            raise ImprintRefineryError(ERROR_STORAGE_ERROR, str(error)) from error

    async def import_command_backup(
        self,
        location_id: str,
        appliance_id: str,
        command_id: str,
        command: dict[str, Any],
    ) -> None:
        try:
            normalized = normalize_import_command(
                command, created_at=dt_util.utcnow().isoformat()
            )
        except BackupError as error:
            raise ImprintRefineryError(ERROR_STORAGE_ERROR, str(error)) from error
        await self._commit(
            lambda: self._library.insert_imported_command(
                location_id, appliance_id, command_id, normalized
            )
        )

    async def import_backup(self, payload: str | dict[str, Any]) -> dict[str, int]:
        try:
            inspected = inspect_backup(payload)
            timestamp = dt_util.utcnow().isoformat()
            prepared = [
                (
                    item,
                    normalize_import_command(item["command"], created_at=timestamp),
                )
                for item in inspected["commands"]
            ]
        except BackupError as error:
            raise ImprintRefineryError(ERROR_STORAGE_ERROR, str(error)) from error
        return await self._commit(lambda: self._library.insert_backup(prepared))

    def history_for(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        return self._library.history(location_id, appliance_id, command_id)

    def command_at(
        self, location_id: str, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        return self._library.command(location_id, appliance_id, command_id)

    def snapshot(self) -> dict[str, Any]:
        return self._library.public_view()
