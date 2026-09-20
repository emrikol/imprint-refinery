"""Native Home Assistant device action for named Imprint commands."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.components.device_automation import InvalidDeviceAutomationConfig
from homeassistant.components.remote import ATTR_DELAY_SECS, ATTR_NUM_REPEATS
from homeassistant.helpers import config_validation as cv
from probatio import to_field_list
import pytest

from custom_components.imprint_refinery import device_action
from custom_components.imprint_refinery.const import DOMAIN


def execute(awaitable):
    return asyncio.run(awaitable)


def document() -> dict:
    return {
        "locations": {
            "living_room": {
                "appliances": {
                    "wall_light": {
                        "name": "Wall light",
                        "appliance_type": "light",
                        "preferred_platform": "remote",
                        "commands": {
                            "warm_white": {"name": "Warm white"},
                            "power_off": {"name": "Off", "role": "power_off"},
                        },
                    }
                }
            }
        }
    }


def harness():
    entry = SimpleNamespace(
        id="11111111111141118111111111111111",
        entity_id="remote.wall_light",
        domain="remote",
        platform=DOMAIN,
        device_id="device-id",
        unique_id="living_room__wall_light",
    )
    services = SimpleNamespace(async_call=AsyncMock())
    hass = SimpleNamespace(
        data={DOMAIN: {"store": SimpleNamespace(data=document())}},
        services=services,
    )
    config = {
        "device_id": "device-id",
        "domain": DOMAIN,
        "entity_id": entry.id,
        "type": device_action.ACTION_SEND_SAVED_COMMAND,
        "command_id": "warm_white",
    }
    return hass, entry, config


def test_lists_one_named_command_action_for_an_imprint_remote() -> None:
    hass, entry, _ = harness()
    other = SimpleNamespace(domain="button", platform=DOMAIN)
    with (
        patch.object(device_action.er, "async_get", return_value=object()),
        patch.object(
            device_action.er,
            "async_entries_for_device",
            return_value=[entry, other],
        ),
    ):
        actions = execute(device_action.async_get_actions(hass, "device-id"))

    assert actions == [
        {
            "device_id": "device-id",
            "domain": DOMAIN,
            "entity_id": "11111111111141118111111111111111",
            "type": "send_saved_command",
        }
    ]


def test_capabilities_are_named_dropdown_and_compact_number_fields() -> None:
    hass, entry, config = harness()
    with patch.object(
        device_action, "async_get_entity_registry_entry_or_raise", return_value=entry
    ):
        capabilities = execute(
            device_action.async_get_action_capabilities(hass, config)
        )

    fields = to_field_list(
        capabilities["extra_fields"], custom_serializer=cv.custom_serializer
    )
    assert fields[0] == {
        "selector": {
            "select": {
                "options": [
                    {"value": "power_off", "label": "Off"},
                    {"value": "warm_white", "label": "Warm white"},
                ],
                "mode": "dropdown",
                "multiple": False,
                "custom_value": False,
                "sort": False,
            }
        },
        "name": "command_id",
        "required": True,
    }
    assert fields[1]["selector"]["number"] == {
        "min": 1.0,
        "max": 255.0,
        "step": 1.0,
        "mode": "box",
    }
    assert fields[2]["selector"]["number"] == {
        "min": 0.0,
        "max": 60.0,
        "step": 0.1,
        "mode": "box",
        "unit_of_measurement": "seconds",
    }


def test_validation_applies_defaults_and_rejects_an_unknown_command() -> None:
    hass, entry, config = harness()

    def validate(_hass, value, schema):
        validated = schema(value)
        validated["entity_id"] = entry.entity_id
        return validated

    with (
        patch.object(device_action, "async_validate_entity_schema", validate),
        patch.object(
            device_action,
            "async_get_entity_registry_entry_or_raise",
            return_value=entry,
        ),
    ):
        validated = execute(device_action.async_validate_action_config(hass, config))
        assert validated[ATTR_NUM_REPEATS] == 1
        assert validated[ATTR_DELAY_SECS] == 0.4

        with pytest.raises(InvalidDeviceAutomationConfig, match="not saved"):
            execute(
                device_action.async_validate_action_config(
                    hass, {**config, "command_id": "missing"}
                )
            )


def test_action_calls_native_remote_service_without_generic_editor_fields() -> None:
    hass, entry, config = harness()
    context = object()
    validated = {
        **config,
        "entity_id": entry.entity_id,
        "num_repeats": 3,
        "delay_secs": 0.4,
    }
    with patch.object(
        device_action,
        "async_validate_action_config",
        AsyncMock(return_value=validated),
    ):
        execute(device_action.async_call_action_from_config(hass, config, {}, context))

    hass.services.async_call.assert_awaited_once_with(
        "remote",
        "send_command",
        {
            "entity_id": "remote.wall_light",
            "command": ["warm_white"],
            "num_repeats": 3,
            "delay_secs": 0.4,
        },
        blocking=True,
        context=context,
    )


def test_action_rejects_an_entity_from_another_device() -> None:
    hass, entry, config = harness()
    entry.device_id = "different-device"
    with (
        patch.object(
            device_action,
            "async_get_entity_registry_entry_or_raise",
            return_value=entry,
        ),
        pytest.raises(InvalidDeviceAutomationConfig, match="for this device"),
    ):
        execute(device_action.async_get_action_capabilities(hass, config))
