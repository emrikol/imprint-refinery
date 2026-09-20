"""Switches projected from appliances with only power signals."""

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .consumer import AssumedPower, LibraryEntity, async_install_projection

SWITCH_DOMAIN = "switch"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    await async_install_projection(
        hass,
        entry,
        async_add_entities,
        runtime_key="switch_projection",
        entity_domain=SWITCH_DOMAIN,
        build_entity=SignalSwitch,
    )


class SignalSwitch(
    AssumedPower,
    LibraryEntity,
    SwitchEntity,
    RestoreEntity,
):
    """Optimistic switch projected from power-only IR commands."""
