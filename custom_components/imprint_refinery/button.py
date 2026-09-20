"""Stateless controls for saved commands without a native entity action."""

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .consumer import LibraryEntity, async_install_projection
from .entity_projection import EntityBlueprint

BUTTON_DOMAIN = "button"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Install the per-command button projection."""
    await async_install_projection(
        hass,
        entry,
        async_add_entities,
        runtime_key="button_projection",
        entity_domain=BUTTON_DOMAIN,
        build_entity=SignalCommandButton,
    )


class SignalCommandButton(LibraryEntity, ButtonEntity):
    """Press one saved command exactly once."""

    def update_blueprint(self, blueprint: EntityBlueprint) -> None:
        self._attr_name = blueprint.entity_name
        self._attr_icon = blueprint.icon
        LibraryEntity.update_blueprint(self, blueprint)

    async def async_press(self) -> None:
        command_id = self._blueprint.command_id
        if command_id is None:
            raise RuntimeError("Command button is missing its saved command ID")
        await self.async_send_stored_command(command_id)
