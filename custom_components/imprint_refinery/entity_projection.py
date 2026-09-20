"""Turn signal-library appliances into Home Assistant entity blueprints."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode

from .capabilities import COMMAND_FEATURE_SET, CommandCapabilities, infer_capabilities

MEDIA_PLATFORM = "media_player"
REMOTE_PLATFORM = "remote"
SWITCH_PLATFORM = "switch"
BUTTON_PLATFORM = "button"
AUTOMATIC_PLATFORM = "auto"


@dataclass(frozen=True, slots=True)
class EntityBlueprint:
    """Everything needed to construct one projected Home Assistant entity."""

    platform: str
    entity_key: str
    location: str
    appliance: str
    title: str
    emitter: str | None
    commands: tuple[str, ...]
    roles: dict[str, str]
    abilities: CommandCapabilities
    area_name: str | None = None
    command_id: str | None = None
    entity_name: str | None = None
    icon: str | None = None

    @property
    def registry_device_key(self) -> str:
        return f"{self.location}__{self.appliance}"

    @property
    def configuration_url(self) -> str:
        query = urlencode(
            {
                "screen": "library",
                "location": self.location,
                "appliance": self.appliance,
            }
        )
        return f"homeassistant://navigate/imprint-refinery?{query}"


def _command_summaries(commands: dict[str, Any]) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for key, command in commands.items():
        summaries.append(
            {
                "command_id": key,
                "role": command.get("role"),
                "name": command.get("name") or key,
            }
        )
    return summaries


def _role_index(commands: dict[str, Any]) -> dict[str, str]:
    index: dict[str, str] = {}
    for key, command in commands.items():
        role = command.get("role")
        if role in COMMAND_FEATURE_SET and role not in index:
            index[role] = key
    return index


def _platform_for(
    preference: str,
    appliance_type: str,
    abilities: CommandCapabilities,
) -> str:
    if preference == SWITCH_PLATFORM:
        return SWITCH_PLATFORM if abilities.power_only else REMOTE_PLATFORM
    if preference in (MEDIA_PLATFORM, REMOTE_PLATFORM):
        return preference
    if appliance_type == MEDIA_PLATFORM:
        return MEDIA_PLATFORM
    if appliance_type == SWITCH_PLATFORM and abilities.power_only:
        return SWITCH_PLATFORM
    return REMOTE_PLATFORM


def _represented_command_ids(
    platform: str,
    roles: dict[str, str],
    abilities: CommandCapabilities,
) -> set[str]:
    """Return commands already exposed as first-class controls by a platform."""
    represented: set[str] = set()
    if abilities.power_control.value != "absent":
        represented.update(
            command_id
            for role, command_id in roles.items()
            if role in {"power_on", "power_off", "power_toggle"}
        )
    if platform != MEDIA_PLATFORM:
        return represented

    media_roles: set[str] = set()
    for control in abilities.media_controls:
        if control == "pause":
            media_roles.update({"pause", "play_pause_toggle"})
        elif control == "volume_step":
            media_roles.update({"volume_up", "volume_down"})
        elif control == "mute":
            media_roles.update({"mute", "unmute", "mute_toggle"})
        elif control == "source":
            represented.update(abilities.source_ids)
        else:
            media_roles.add(control)
    represented.update(
        command_id for role, command_id in roles.items() if role in media_roles
    )
    return represented


def _appliance_blueprint(
    location_key: str,
    location: dict[str, Any],
    appliance_key: str,
    appliance: dict[str, Any],
) -> EntityBlueprint:
    commands = appliance.get("commands", {})
    abilities = infer_capabilities(_command_summaries(commands))
    platform = _platform_for(
        str(appliance.get("preferred_platform") or AUTOMATIC_PLATFORM),
        str(appliance.get("appliance_type") or "generic"),
        abilities,
    )
    entity_key = f"{location_key}__{appliance_key}"
    if platform == SWITCH_PLATFORM:
        entity_key += "__switch"
    return EntityBlueprint(
        platform=platform,
        entity_key=entity_key,
        location=location_key,
        appliance=appliance_key,
        title=str(appliance.get("name") or appliance_key),
        emitter=appliance.get("emitter_id") or None,
        commands=tuple(sorted(commands)),
        roles=_role_index(commands),
        abilities=abilities,
        area_name=(
            str(location.get("name") or location_key)
            if location_key != "unsorted"
            else None
        ),
    )


def project_library(document: dict[str, Any]) -> list[EntityBlueprint]:
    """Create a stable entity plan from a library document."""
    plan: list[EntityBlueprint] = []
    locations = document.get("locations", {})
    for location_key in sorted(locations):
        location = locations[location_key]
        appliances = location.get("appliances", {})
        for appliance_key in sorted(appliances):
            appliance = appliances[appliance_key]
            plan.append(
                _appliance_blueprint(location_key, location, appliance_key, appliance)
            )
    return plan


def project_command_buttons(document: dict[str, Any]) -> list[EntityBlueprint]:
    """Project commands without a native semantic control as button entities."""
    plan: list[EntityBlueprint] = []
    locations = document.get("locations", {})
    for location_key in sorted(locations):
        location = locations[location_key]
        for appliance_key in sorted(location.get("appliances", {})):
            appliance = location["appliances"][appliance_key]
            primary = _appliance_blueprint(
                location_key, location, appliance_key, appliance
            )
            represented = _represented_command_ids(
                primary.platform, primary.roles, primary.abilities
            )
            commands = appliance.get("commands", {})
            for command_id in sorted(commands):
                if command_id in represented:
                    continue
                command = commands[command_id]
                plan.append(
                    EntityBlueprint(
                        platform=BUTTON_PLATFORM,
                        entity_key=(
                            f"{location_key}__{appliance_key}__command__{command_id}"
                        ),
                        location=location_key,
                        appliance=appliance_key,
                        title=primary.title,
                        emitter=primary.emitter,
                        commands=(command_id,),
                        roles={},
                        abilities=primary.abilities,
                        area_name=primary.area_name,
                        command_id=command_id,
                        entity_name=str(command.get("name") or command_id),
                        icon=str(command.get("icon") or "mdi:remote"),
                    )
                )
    return plan


def project_platform(
    document: dict[str, Any], platform: str
) -> dict[str, EntityBlueprint]:
    """Index the blueprints belonging to one Home Assistant platform."""
    source = (
        project_command_buttons(document)
        if platform == BUTTON_PLATFORM
        else project_library(document)
    )
    return {
        blueprint.entity_key: blueprint
        for blueprint in source
        if blueprint.platform == platform
    }
