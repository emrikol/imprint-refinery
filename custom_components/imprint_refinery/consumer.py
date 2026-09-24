"""Project stored signals into Home Assistant consumer entities."""

from collections.abc import Callable
from typing import Any

from homeassistant.components.infrared import InfraredEmitterConsumerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_ON
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import DeviceInfo, Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback
import voluptuous as vol

from .const import DOMAIN, SIGNAL_REGISTRY_UPDATED
from .entity_projection import EntityBlueprint, project_platform
from .signal_command import LibraryPath, RawSignalCommand, signal_from_command
from .storage import SignalLibraryStore

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
            rebound = []
            for unique_id in tuple(retained):
                entity = self.entities[unique_id]
                blueprint = desired[unique_id]
                if (
                    getattr(entity, "emitter_reference", blueprint.emitter)
                    != blueprint.emitter
                ):
                    await entity.async_remove()
                    replacement = self.build_entity(self.store, blueprint)
                    self.entities[unique_id] = replacement
                    rebound.append(replacement)
                else:
                    entity.update_blueprint(blueprint)

            additions = [
                self.build_entity(self.store, desired[unique_id])
                for unique_id in sorted(missing)
            ]
            self.entities.update({entity.unique_id: entity for entity in additions})
            if additions or rebound:
                self.add_entities([*rebound, *additions])
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


class LibraryEntity(InfraredEmitterConsumerEntity):
    """Entity identity and delivery behavior backed by a library blueprint."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_assumed_state = True
    _attr_should_poll = False

    def __init__(self, store: SignalLibraryStore, blueprint: EntityBlueprint) -> None:
        self._store = store
        self._infrared_emitter_entity_id = (
            _resolve_emitter_entity_id(getattr(store, "hass", None), store, blueprint)
            or "infrared.unassigned"
        )
        self.update_blueprint(blueprint)

    def update_blueprint(self, blueprint: EntityBlueprint) -> None:
        self._blueprint = blueprint
        self._attr_unique_id = blueprint.entity_key
        info = DeviceInfo(
            identifiers={(DOMAIN, blueprint.registry_device_key)},
            name=blueprint.title,
            configuration_url=blueprint.configuration_url,
        )
        emitter_entity_id = _resolve_emitter_entity_id(
            getattr(self._store, "hass", None), self._store, blueprint
        )
        hass = getattr(self._store, "hass", None)
        if emitter_entity_id and hass is not None:
            emitter = er.async_get(hass).async_get(emitter_entity_id)
            if emitter is not None and emitter.device_id:
                info["via_device_id"] = emitter.device_id
        self._attr_device_info = info
        if self.entity_id is not None:
            self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Fill appliance metadata that DeviceInfo only suggests on first creation."""
        if self._infrared_emitter_entity_id == "infrared.unassigned":
            self._attr_available = False
            await super(InfraredEmitterConsumerEntity, self).async_added_to_hass()
        else:
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
        if changes:
            devices.async_update_device(device.id, **changes)

    @property
    def registry_device_key(self) -> str:
        return self._blueprint.registry_device_key

    @property
    def emitter_reference(self) -> str | None:
        """Return the stable emitter reference used to detect route changes."""
        return self._blueprint.emitter

    async def async_send_stored_command(self, command_id: str) -> None:
        if self._infrared_emitter_entity_id == "infrared.unassigned":
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no assigned infrared emitter"
            )
        if command_id not in self._blueprint.commands:
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no command_id {command_id}"
            )
        command = self._store.command_at(
            self._blueprint.remote_profile,
            command_id,
        )
        await self._send_command(
            RawSignalCommand(
                signal_from_command(command),
                path=LibraryPath(
                    remote_profile_id=self._blueprint.remote_profile,
                    appliance_id=self._blueprint.appliance,
                    command_id=command_id,
                ),
            )
        )

    async def async_send_feature_command(self, role: str) -> None:
        command_id = self._blueprint.roles.get(role)
        if command_id is None:
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no role {role}"
            )
        await self.async_send_stored_command(command_id)


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


def _resolve_emitter_entity_id(
    hass: HomeAssistant | None,
    store: SignalLibraryStore,
    blueprint: EntityBlueprint,
) -> str | None:
    """Resolve a stored emitter reference to its current Core entity ID."""
    del store
    if hass is None or not blueprint.emitter:
        return None
    registry = er.async_get(hass)
    try:
        return er.async_validate_entity_id(registry, blueprint.emitter)
    except vol.Invalid:
        return None


def _owned_device(registry: dr.DeviceRegistry, identifier: str) -> Any | None:
    return next(
        iter(registry.async_get_devices(identifiers={(DOMAIN, identifier)})), None
    )
