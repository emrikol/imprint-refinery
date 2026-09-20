"""Project stored signals into Home Assistant consumer entities."""

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.components import infrared
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo, Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, HOME_ASSISTANT_IR, SIGNAL_REGISTRY_UPDATED
from .emitter_identity import normalize_emitter_ref
from .entity_projection import EntityBlueprint, project_platform
from .errors import ImprintRefineryError
from .signal_command import LibraryPath, RawSignalCommand, signal_from_command
from .storage import SignalLibraryStore

_LOGGER = logging.getLogger(__name__)
_EMITTER_DOMAIN = "infrared"
EntityBuilder = Callable[[SignalLibraryStore, EntityBlueprint], Entity]


async def async_install_projection(
    hass: HomeAssistant,
    entry: ConfigEntry,
    add_entities: AddEntitiesCallback,
    *,
    runtime_key: str,
    entity_domain: str,
    build_entity: EntityBuilder,
) -> None:
    """Install one live projection of the signal library."""
    runtime = hass.data.get(DOMAIN, {})
    store: SignalLibraryStore | None = runtime.get("store")
    if store is None:
        add_entities([])
        return

    projection = ProjectionController(
        hass, store, add_entities, entity_domain, build_entity
    )
    runtime[runtime_key] = projection
    await projection.async_sync()
    entry.async_on_unload(
        async_dispatcher_connect(hass, SIGNAL_REGISTRY_UPDATED, projection.request_sync)
    )
    entry.async_on_unload(projection.unload)


class ProjectionController:
    """Converge one entity domain on the current library projection."""

    def __init__(
        self,
        hass: HomeAssistant,
        store: SignalLibraryStore,
        add_entities: AddEntitiesCallback,
        entity_domain: str,
        build_entity: EntityBuilder,
    ) -> None:
        self.hass = hass
        self.store = store
        self.add_entities = add_entities
        self.entity_domain = entity_domain
        self.build_entity = build_entity
        self.entities: dict[str, Entity] = {}
        self._requested = 0
        self._task: Any | None = None

    @callback
    def request_sync(self) -> None:
        """Coalesce registry changes behind at most one active task."""
        self._requested += 1
        if self._task is None or self._task.done():
            self._task = self.hass.async_create_task(self.async_sync())

    async def async_sync(self) -> None:
        """Apply changes until no newer registry generation remains."""
        while True:
            generation = self._requested
            desired = project_platform(self.store.data, self.entity_domain)
            stale = self.entities.keys() - desired.keys()
            retained = self.entities.keys() & desired.keys()
            missing = desired.keys() - self.entities.keys()

            for unique_id in tuple(stale):
                await self._discard(self.entities.pop(unique_id))
            for unique_id in retained:
                self.entities[unique_id].update_blueprint(desired[unique_id])

            additions = [
                self.build_entity(self.store, desired[unique_id])
                for unique_id in sorted(missing)
            ]
            self.entities.update({entity.unique_id: entity for entity in additions})
            if additions:
                self.add_entities(additions)
            if generation == self._requested:
                return

    async def _discard(self, entity: Any) -> None:
        entity_id = entity.entity_id
        registry_device_key = entity.registry_device_key
        await entity.async_remove()
        entities = er.async_get(self.hass)
        if entity_id is not None and entities.async_get(entity_id) is not None:
            entities.async_remove(entity_id)

        devices = dr.async_get(self.hass)
        device = _owned_device(devices, registry_device_key)
        if device is not None and not any(
            item.device_id == device.id for item in entities.entities.values()
        ):
            devices.async_remove_device(device.id)

    @callback
    def unload(self) -> None:
        """Cancel pending reconciliation and forget runtime entity objects."""
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None
        self.entities.clear()


class LibraryEntity:
    """Entity identity and delivery behavior backed by a library blueprint."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_assumed_state = True
    _attr_should_poll = False

    def __init__(self, store: SignalLibraryStore, blueprint: EntityBlueprint) -> None:
        self._store = store
        self.update_blueprint(blueprint)

    def update_blueprint(self, blueprint: EntityBlueprint) -> None:
        self._blueprint = blueprint
        self._attr_unique_id = blueprint.entity_key
        info = DeviceInfo(
            identifiers={(DOMAIN, blueprint.registry_device_key)},
            name=blueprint.title,
            suggested_area=blueprint.area_name,
            configuration_url=blueprint.configuration_url,
        )
        emitter_id = _emitter_key_or_none(self._store, blueprint)
        hass = getattr(self._store, "hass", None)
        if emitter_id and hass is not None:
            emitter = _owned_device(dr.async_get(hass), emitter_id)
            if emitter is not None:
                info["via_device_id"] = emitter.id
        self._attr_device_info = info
        if self.entity_id is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Fill appliance metadata that DeviceInfo only suggests on first creation."""
        await super().async_added_to_hass()
        if getattr(self, "hass", None) is None:
            return
        devices = dr.async_get(self.hass)
        device = _owned_device(devices, self._blueprint.registry_device_key)
        if device is None:
            return
        changes: dict[str, str] = {}
        if device.configuration_url != self._blueprint.configuration_url:
            changes["configuration_url"] = self._blueprint.configuration_url
        if self._blueprint.area_name and device.area_id is None:
            area = ar.async_get(self.hass).async_get_or_create(
                self._blueprint.area_name
            )
            changes["area_id"] = area.id
        if changes:
            devices.async_update_device(device.id, **changes)

    @property
    def registry_device_key(self) -> str:
        return self._blueprint.registry_device_key

    async def async_send_stored_command(self, command_id: str) -> None:
        await SignalSender(self.hass, self._store).send(
            self._blueprint, command_id, context=self._context
        )

    async def async_send_feature_command(self, role: str) -> None:
        await SignalSender(self.hass, self._store).send_feature(
            self._blueprint, role, context=self._context
        )


class AssumedPower:
    """Restore and optimistically update power for one-way devices."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._is_on = False
        super().__init__(*args, **kwargs)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if (previous := await self.async_get_last_state()) is not None:
            self._is_on = previous.state == STATE_ON

    @property
    def is_on(self) -> bool:
        return self._is_on

    async def async_turn_on(self, **kwargs: Any) -> None:
        del kwargs
        await self._send_first_available("power_on", "power_toggle")
        self._publish_power(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        del kwargs
        await self._send_first_available("power_off", "power_toggle")
        self._publish_power(False)

    async def async_toggle(self, **kwargs: Any) -> None:
        del kwargs
        if "power_toggle" in self._blueprint.roles:
            await self.async_send_feature_command("power_toggle")
        else:
            await self._send_first_available("power_off" if self._is_on else "power_on")
        self._publish_power(not self._is_on)

    async def _send_first_available(self, *features: str) -> None:
        selected = next(
            (role for role in features if role in self._blueprint.roles),
            None,
        )
        if selected is None:
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no supported power command"
            )
        await self.async_send_feature_command(selected)

    def _publish_power(self, is_on: bool) -> None:
        self._is_on = is_on
        self.async_write_ha_state()


class SignalSender:
    """Resolve stored signals and route them through an infrared entity."""

    def __init__(self, hass: HomeAssistant, store: SignalLibraryStore) -> None:
        self.hass = hass
        self.store = store

    async def send(
        self,
        blueprint: EntityBlueprint,
        command_id: str,
        *,
        context: Any | None = None,
    ) -> None:
        if command_id not in blueprint.commands:
            raise ServiceValidationError(
                f"IR device {blueprint.registry_device_key} has no command_id {command_id}"
            )
        command = self.store.command_at(
            blueprint.location, blueprint.appliance, command_id
        )
        try:
            emitter = self.store.choose_emitter(blueprint.emitter)
        except ImprintRefineryError as error:
            raise ServiceValidationError(str(error)) from error
        emitter_id = emitter_key(self.store, emitter)
        external_entity = (
            emitter.get("entity_id")
            if emitter.get("transport") == HOME_ASSISTANT_IR
            else None
        )
        emitter = (
            str(external_entity)
            if external_entity
            else er.async_get(self.hass).async_get_entity_id(
                _EMITTER_DOMAIN, DOMAIN, emitter_id
            )
        )
        if emitter is None:
            raise ServiceValidationError(
                f"Infrared emitter entity for emitter {emitter_id} was not found"
            )
        await infrared.async_send_command(
            self.hass,
            emitter,
            RawSignalCommand(
                signal_from_command(command),
                path=LibraryPath(blueprint.location, blueprint.appliance, command_id),
            ),
            context=context,
        )

    async def send_feature(
        self,
        blueprint: EntityBlueprint,
        role: str,
        *,
        context: Any | None = None,
    ) -> None:
        command_id = blueprint.roles.get(role)
        if command_id is None:
            raise ServiceValidationError(
                f"IR device {blueprint.registry_device_key} has no role {role}"
            )
        await self.send(blueprint, command_id, context=context)


def emitter_key(store: SignalLibraryStore, emitter: dict[str, Any]) -> str:
    """Find the stable library key for a resolved emitter record."""
    ieee = emitter.get("ieee")
    address = normalize_emitter_ref(str(ieee)) if ieee is not None else None
    match = next(
        (
            key
            for key, candidate in store.data.get("emitters", {}).items()
            if candidate is emitter
            or (
                address is not None
                and candidate.get("ieee") is not None
                and normalize_emitter_ref(str(candidate["ieee"])) == address
            )
        ),
        None,
    )
    if match is None:
        raise ServiceValidationError(
            "Resolved IR emitter is not present in the registry"
        )
    return match


def _emitter_key_or_none(
    store: SignalLibraryStore, blueprint: EntityBlueprint
) -> str | None:
    try:
        return emitter_key(store, store.choose_emitter(blueprint.emitter))
    except (ImprintRefineryError, ServiceValidationError) as error:
        _LOGGER.warning(
            "Could not resolve emitter device for %s: %s",
            blueprint.registry_device_key,
            error,
        )
        return None


def _owned_device(registry: dr.DeviceRegistry, identifier: str) -> Any | None:
    return next(
        iter(registry.async_get_devices(identifiers={(DOMAIN, identifier)})), None
    )
