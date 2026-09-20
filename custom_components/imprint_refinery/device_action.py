"""Device actions for sending saved Imprint commands."""

from typing import Any

from homeassistant.components.device_automation import (
    InvalidDeviceAutomationConfig,
    async_get_entity_registry_entry_or_raise,
    async_validate_entity_schema,
)
from homeassistant.components.remote import (
    ATTR_COMMAND,
    ATTR_DELAY_SECS,
    ATTR_NUM_REPEATS,
    DOMAIN as REMOTE_DOMAIN,
    SERVICE_SEND_COMMAND,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    CONF_DEVICE_ID,
    CONF_DOMAIN,
    CONF_ENTITY_ID,
    CONF_TYPE,
)
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)
from homeassistant.helpers.typing import ConfigType, TemplateVarsType
import voluptuous as vol

from .const import DOMAIN
from .entity_projection import EntityBlueprint, project_platform

ACTION_SEND_SAVED_COMMAND = "send_saved_command"
CONF_COMMAND_ID = "command_id"
DEFAULT_DELAY = 0.4
MAX_DELAY = 60.0
MAX_REPEATS = 255

ACTION_SCHEMA = cv.DEVICE_ACTION_BASE_SCHEMA.extend(
    {
        vol.Required(CONF_DOMAIN): DOMAIN,
        vol.Required(CONF_ENTITY_ID): cv.entity_id_or_uuid,
        vol.Required(CONF_TYPE): ACTION_SEND_SAVED_COMMAND,
        vol.Required(CONF_COMMAND_ID): cv.string,
        vol.Optional(ATTR_NUM_REPEATS, default=1): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=MAX_REPEATS)
        ),
        vol.Optional(ATTR_DELAY_SECS, default=DEFAULT_DELAY): vol.All(
            vol.Coerce(float), vol.Range(min=0, max=MAX_DELAY)
        ),
    }
)


def _blueprint_for_action(
    hass: HomeAssistant, config: ConfigType
) -> tuple[er.RegistryEntry, EntityBlueprint]:
    """Resolve and verify the Imprint remote selected by a device action."""
    entry = async_get_entity_registry_entry_or_raise(hass, config[CONF_ENTITY_ID])
    if (
        entry.domain != REMOTE_DOMAIN
        or entry.platform != DOMAIN
        or entry.device_id != config[CONF_DEVICE_ID]
    ):
        raise InvalidDeviceAutomationConfig(
            "The selected entity is not an Imprint remote for this device"
        )

    store = hass.data.get(DOMAIN, {}).get("store")
    blueprint = (
        project_platform(store.data, REMOTE_DOMAIN).get(str(entry.unique_id))
        if store is not None
        else None
    )
    if blueprint is None:
        raise InvalidDeviceAutomationConfig(
            "The selected Imprint remote is no longer available"
        )
    return entry, blueprint


async def async_get_actions(
    hass: HomeAssistant, device_id: str
) -> list[dict[str, str]]:
    """List the saved-command action for each Imprint remote on a device."""
    registry = er.async_get(hass)
    return [
        {
            CONF_DEVICE_ID: device_id,
            CONF_DOMAIN: DOMAIN,
            CONF_ENTITY_ID: entry.id,
            CONF_TYPE: ACTION_SEND_SAVED_COMMAND,
        }
        for entry in er.async_entries_for_device(registry, device_id)
        if entry.domain == REMOTE_DOMAIN and entry.platform == DOMAIN
    ]


async def async_get_action_capabilities(
    hass: HomeAssistant, config: ConfigType
) -> dict[str, vol.Schema]:
    """Return the named command, repeat, and delay controls."""
    _, blueprint = _blueprint_for_action(hass, config)
    store = hass.data[DOMAIN]["store"]
    commands: dict[str, Any] = store.data["locations"][blueprint.location][
        "appliances"
    ][blueprint.appliance]["commands"]
    options = [
        {
            "value": command_id,
            "label": str(commands[command_id].get("name") or command_id),
        }
        for command_id in sorted(
            blueprint.commands,
            key=lambda item: str(commands[item].get("name") or item).casefold(),
        )
    ]
    return {
        "extra_fields": vol.Schema(
            {
                vol.Required(CONF_COMMAND_ID): SelectSelector(
                    SelectSelectorConfig(
                        options=options,
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Optional(ATTR_NUM_REPEATS, default=1): NumberSelector(
                    NumberSelectorConfig(
                        min=1,
                        max=MAX_REPEATS,
                        step=1,
                        mode=NumberSelectorMode.BOX,
                    )
                ),
                vol.Optional(ATTR_DELAY_SECS, default=DEFAULT_DELAY): NumberSelector(
                    NumberSelectorConfig(
                        min=0,
                        max=MAX_DELAY,
                        step=0.1,
                        mode=NumberSelectorMode.BOX,
                        unit_of_measurement="seconds",
                    )
                ),
            }
        )
    }


async def async_validate_action_config(
    hass: HomeAssistant, config: ConfigType
) -> ConfigType:
    """Validate a saved-command device action."""
    validated = async_validate_entity_schema(hass, config, ACTION_SCHEMA)
    _, blueprint = _blueprint_for_action(hass, validated)
    if validated[CONF_COMMAND_ID] not in blueprint.commands:
        raise InvalidDeviceAutomationConfig(
            f"Command {validated[CONF_COMMAND_ID]} is not saved on this Imprint remote"
        )
    return validated


async def async_call_action_from_config(
    hass: HomeAssistant,
    config: ConfigType,
    variables: TemplateVarsType,
    context: Context | None,
) -> None:
    """Send one named command through the native remote service."""
    del variables
    validated = await async_validate_action_config(hass, config)
    await hass.services.async_call(
        REMOTE_DOMAIN,
        SERVICE_SEND_COMMAND,
        {
            ATTR_ENTITY_ID: validated[CONF_ENTITY_ID],
            ATTR_COMMAND: [validated[CONF_COMMAND_ID]],
            ATTR_NUM_REPEATS: validated[ATTR_NUM_REPEATS],
            ATTR_DELAY_SECS: validated[ATTR_DELAY_SECS],
        },
        blocking=True,
        context=context,
    )
