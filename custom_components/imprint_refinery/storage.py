"""Home Assistant persistence adapter for the Imprint Refinery library."""

from collections.abc import Callable
from copy import deepcopy
from typing import Any, TypeVar

from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
import voluptuous as vol

from .backup import BackupError, export_backup, inspect_backup, normalize_import_command
from .const import DOMAIN, ERROR_STORAGE_ERROR, SIGNAL_REGISTRY_UPDATED
from .errors import ImprintRefineryError
from .hardware import discover_infrared_hardware
from .ir_formats import ANALYZER_VERSION, IRFormatError, analyze_signal
from .library import (
    LEGACY_LIBRARY_VERSION,
    LIBRARY_SCHEMA,
    SignalLibrary,
    migrate_v2_to_v3,
)
from .signal_command import decoded_signal_from_command

STORAGE_VERSION = 1
STORAGE_KEY = LIBRARY_SCHEMA
_Result = TypeVar("_Result")


class SignalLibraryStore:
    """Persist domain operations and roll back failed writes."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._library = SignalLibrary()
        self._legacy_area_names: dict[str, str] = {}

    @property
    def hass(self) -> HomeAssistant:
        return self._hass

    @property
    def data(self) -> dict[str, Any]:
        return self._library.document

    @data.setter
    def data(self, value: dict[str, Any]) -> None:
        model = SignalLibrary.__new__(SignalLibrary)
        model.document = value
        self._library = model

    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored is None:
            self._library = SignalLibrary()
            return
        if stored.get("version") == LEGACY_LIBRARY_VERSION:
            self._legacy_area_names = {
                f"{location_id}__{appliance_id}": str(
                    location.get("name") or location_id
                )
                for location_id, location in stored.get("locations", {}).items()
                if isinstance(location, dict)
                for appliance_id in location.get("appliances", {})
            }
            stored = migrate_v2_to_v3(
                stored,
                emitter_refs=self._legacy_emitter_refs(stored),
                sole_emitter_ref=self._sole_live_emitter_ref(),
            )
            self._library = SignalLibrary(stored)
            return
        self._library = SignalLibrary(stored)

    async def async_refresh_analysis(self) -> bool:
        """Refresh derived command analysis after analyzer upgrades."""
        changed = await self._hass.async_add_executor_job(self._refresh_stale_analysis)
        if changed:
            await self._store.async_save(self._library.document)
        return changed

    def _refresh_stale_analysis(self) -> bool:
        changed = False
        for profile in self.data.get("remote_profiles", {}).values():
            for command in profile.get("commands", {}).values():
                analysis = command.get("analysis")
                if (
                    isinstance(analysis, dict)
                    and analysis.get("analyzer_version") == ANALYZER_VERSION
                ):
                    continue
                try:
                    decoded = decoded_signal_from_command(command)
                    command["analysis"] = analyze_signal(
                        decoded.signal,
                        carrier_source=decoded.carrier_source,
                    )
                except IRFormatError, TypeError, ValueError:
                    continue
                changed = True
        return changed

    async def async_complete_migration(self, config_entry_id: str) -> None:
        """Map legacy locations to HA Areas before committing a v3 migration."""
        if not self._legacy_area_names:
            return
        areas = ar.async_get(self._hass)
        devices = dr.async_get(self._hass)
        by_name = {area.name.casefold(): area for area in areas.async_list_areas()}
        for appliance_id, area_name in self._legacy_area_names.items():
            device = next(
                iter(devices.async_get_devices(identifiers={(DOMAIN, appliance_id)})),
                None,
            )
            if device is None:
                appliance = self.data["appliances"][appliance_id]
                device = devices.async_get_or_create(
                    config_entry_id=config_entry_id,
                    identifiers={(DOMAIN, appliance_id)},
                    name=appliance["name"],
                )
            if device.area_id:
                continue
            area = by_name.get(area_name.casefold())
            if area is None:
                area = areas.async_create(area_name)
                by_name[area.name.casefold()] = area
            devices.async_update_device(device.id, area_id=area.id)
        await self._store.async_save(self._library.document)
        self._legacy_area_names.clear()

    def _legacy_emitter_refs(self, stored: dict[str, Any]) -> dict[str, str]:
        """Resolve v2 emitter keys to stable Core Entity Registry UUIDs."""
        registry = er.async_get(self._hass)
        resolved: dict[str, str] = {}
        for key, record in stored.get("emitters", {}).items():
            entity_id: str | None = None
            reference = record.get("entity_id") if isinstance(record, dict) else None
            if reference:
                try:
                    entity_id = er.async_validate_entity_id(registry, str(reference))
                except vol.Invalid:
                    entity_id = None
            if entity_id is None:
                entity_id = registry.async_get_entity_id(
                    Platform.INFRARED, DOMAIN, str(key)
                )
            entry = registry.async_get(entity_id) if entity_id else None
            if entry is not None:
                resolved[str(key)] = entry.id
        return resolved

    def _sole_live_emitter_ref(self) -> str | None:
        emitters = discover_infrared_hardware(self._hass)["emitters"]
        return str(emitters[0]["ref"]) if len(emitters) == 1 else None

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
        return result

    async def create_remote_profile(
        self, remote_profile_id: str, name: str, appliance_type: str = "generic"
    ) -> None:
        await self._commit(
            lambda: self._library.put_remote_profile(
                remote_profile_id, name, appliance_type
            )
        )

    async def update_remote_profile(
        self,
        remote_profile_id: str,
        *,
        name: str | None = None,
        appliance_type: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if appliance_type is not None:
            patch["appliance_type"] = appliance_type
        await self._commit(
            lambda: self._library.patch_remote_profile(remote_profile_id, **patch)
        )

    async def duplicate_remote_profile(
        self, source_id: str, target_id: str, name: str
    ) -> None:
        await self._commit(
            lambda: self._library.duplicate_remote_profile(source_id, target_id, name)
        )

    async def remove_remote_profile(
        self, remote_profile_id: str, confirm: bool
    ) -> None:
        await self._commit(
            lambda: self._library.remove_remote_profile(
                remote_profile_id, confirmed=confirm
            )
        )

    async def create_appliance(
        self,
        appliance_id: str,
        name: str,
        *,
        remote_profile_id: str | None = None,
        infrared_emitter_ref: str | None = None,
        preferred_platform: str = "auto",
    ) -> None:
        await self._commit(
            lambda: self._library.put_appliance(
                appliance_id,
                name,
                remote_profile_id=remote_profile_id,
                infrared_emitter_ref=infrared_emitter_ref,
                preferred_platform=preferred_platform,
            )
        )

    async def update_appliance(
        self,
        appliance_id: str,
        *,
        name: str | None = None,
        remote_profile_id: str | None = None,
        infrared_emitter_ref: str | None = None,
        preferred_platform: str | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if remote_profile_id is not None:
            patch["remote_profile_id"] = remote_profile_id
        if infrared_emitter_ref is not None:
            patch["infrared_emitter_ref"] = infrared_emitter_ref
        if preferred_platform is not None:
            patch["preferred_platform"] = preferred_platform
        await self._commit(lambda: self._library.patch_appliance(appliance_id, **patch))

    async def remove_appliance(self, appliance_id: str, confirm: bool) -> None:
        await self._commit(
            lambda: self._library.remove_appliance(appliance_id, confirmed=confirm)
        )

    async def draft_command(
        self,
        remote_profile_id: str,
        command_id: str,
        name: str,
        role: str | None = None,
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.put_command_placeholder(
                remote_profile_id,
                command_id,
                name,
                role,
                timestamp=timestamp,
            )
        )

    async def set_command_name(
        self, remote_profile_id: str, command_id: str, name: str
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.set_command_name(
                remote_profile_id, command_id, name, timestamp=timestamp
            )
        )

    async def remove_command(self, remote_profile_id: str, command_id: str) -> None:
        await self._commit(
            lambda: self._library.remove_command(remote_profile_id, command_id)
        )

    async def relocate_command(
        self,
        remote_profile_id: str,
        command_id: str,
        target_remote_profile_id: str,
    ) -> None:
        await self._commit(
            lambda: self._library.move_command(
                remote_profile_id, command_id, target_remote_profile_id
            )
        )

    async def duplicate_command(
        self,
        remote_profile_id: str,
        command_id: str,
        target_remote_profile_id: str,
        target_command_id: str,
        name: str,
    ) -> None:
        timestamp = dt_util.utcnow().isoformat()
        await self._commit(
            lambda: self._library.duplicate_command(
                remote_profile_id,
                command_id,
                target_remote_profile_id,
                target_command_id,
                name,
                timestamp=timestamp,
            )
        )

    async def store_signal(
        self,
        remote_profile_id: str,
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
                remote_profile_id,
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
        remote_profile_id: str,
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
                remote_profile_id,
                command_id,
                **patch,
                timestamp=timestamp,
            )
        )

    async def restore_revision(
        self,
        remote_profile_id: str,
        command_id: str,
        revision_id: int,
    ) -> int:
        timestamp = dt_util.utcnow().isoformat()
        return await self._commit(
            lambda: self._library.restore_command(
                remote_profile_id,
                command_id,
                revision_id,
                timestamp=timestamp,
            )
        )

    async def label_revision(
        self,
        remote_profile_id: str,
        command_id: str,
        revision_id: int,
        label: str,
    ) -> None:
        await self._commit(
            lambda: self._library.label_revision(
                remote_profile_id, command_id, revision_id, label
            )
        )

    def export_backup(
        self,
        *,
        remote_profile_id: str | None = None,
        include_history: bool = True,
    ) -> dict[str, Any]:
        try:
            return export_backup(
                self.data,
                remote_profile_id=remote_profile_id,
                include_history=include_history,
            )
        except BackupError as error:
            raise ImprintRefineryError(ERROR_STORAGE_ERROR, str(error)) from error

    async def import_command_backup(
        self,
        remote_profile_id: str,
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
                remote_profile_id, command_id, normalized
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

        def operation() -> dict[str, int]:
            profiles_created = 0
            appliances_created = 0
            for profile_id, profile in inspected["remote_profiles"].items():
                if profile_id not in self.data["remote_profiles"]:
                    self._library.put_remote_profile(
                        profile_id,
                        profile["name"],
                        profile["appliance_type"],
                    )
                    profiles_created += 1
            for appliance_id, appliance in inspected["appliances"].items():
                if appliance_id not in self.data["appliances"]:
                    self._library.put_appliance(
                        appliance_id,
                        appliance["name"],
                        remote_profile_id=appliance["remote_profile_id"],
                        preferred_platform=appliance["preferred_platform"],
                    )
                    appliances_created += 1
            for item, command in prepared:
                self._library.insert_imported_command(
                    item["remote_profile_id"], item["command_id"], command
                )
            return {
                "remote_profiles_created": profiles_created,
                "appliances_created": appliances_created,
                "commands_imported": len(prepared),
            }

        return await self._commit(operation)

    def history_for(self, remote_profile_id: str, command_id: str) -> dict[str, Any]:
        return self._library.history(remote_profile_id, command_id)

    def command_at(self, remote_profile_id: str, command_id: str) -> dict[str, Any]:
        return self._library.command(remote_profile_id, command_id)

    def command_for_appliance(
        self, appliance_id: str, command_id: str
    ) -> dict[str, Any]:
        return self._library.command_for_appliance(appliance_id, command_id)

    def snapshot(self) -> dict[str, Any]:
        return self._library.public_view()
