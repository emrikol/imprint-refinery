"""Turn appliances and remote profiles into Home Assistant entity blueprints."""

from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

from .capabilities import COMMAND_FEATURE_SET, CommandCapabilities, infer_capabilities

MEDIA_PLATFORM = "media_player"
REMOTE_PLATFORM = "remote"
SWITCH_PLATFORM = "switch"
BUTTON_PLATFORM = "button"
AUTOMATIC_PLATFORM = "auto"


def appliance_configuration_url(appliance_id: str) -> str:
    """Return the canonical Home Assistant deep link for one appliance."""
    return "homeassistant://navigate/imprint-refinery/appliances/" + quote(
        appliance_id, safe=""
    )


@dataclass(frozen=True, slots=True)
class EntityBlueprint:
    """Everything needed to construct one projected Home Assistant entity."""

    platform: str
    entity_key: str
    appliance: str
    remote_profile: str
    title: str
    emitter: str
    commands: tuple[str, ...]
    roles: dict[str, str]
    abilities: CommandCapabilities
    command_id: str | None = None
    entity_name: str | None = None
    icon: str | None = None

    @property
    def registry_device_key(self) -> str:
        return self.appliance

    @property
    def configuration_url(self) -> str:
        return appliance_configuration_url(self.appliance)


def _command_summaries(commands: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "command_id": key,
            "role": command.get("role"),
            "name": command.get("name") or key,
        }
        for key, command in commands.items()
    ]


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
    appliance_id: str,
    appliance: dict[str, Any],
    remote_profile_id: str,
    profile: dict[str, Any],
) -> EntityBlueprint:
    commands = profile.get("commands", {})
    abilities = infer_capabilities(_command_summaries(commands))
    platform = _platform_for(
        str(appliance.get("preferred_platform") or AUTOMATIC_PLATFORM),
        str(profile.get("appliance_type") or "generic"),
        abilities,
    )
    entity_key = appliance_id
    if platform == SWITCH_PLATFORM:
        entity_key += "__switch"
    return EntityBlueprint(
        platform=platform,
        entity_key=entity_key,
        appliance=appliance_id,
        remote_profile=remote_profile_id,
        title=str(appliance.get("name") or appliance_id),
        emitter=str(appliance["infrared_emitter_ref"]),
        commands=tuple(sorted(commands)),
        roles=_role_index(commands),
        abilities=abilities,
    )


def project_library(document: dict[str, Any]) -> list[EntityBlueprint]:
    """Create a stable entity plan for every fully assigned appliance."""
    profiles = document.get("remote_profiles", {})
    plan: list[EntityBlueprint] = []
    for appliance_id, appliance in sorted(document.get("appliances", {}).items()):
        profile_id = appliance.get("remote_profile_id")
        emitter_ref = appliance.get("infrared_emitter_ref")
        profile = profiles.get(profile_id)
        if not profile_id or not emitter_ref or not isinstance(profile, dict):
            continue
        plan.append(_appliance_blueprint(appliance_id, appliance, profile_id, profile))
    return plan


def project_command_buttons(document: dict[str, Any]) -> list[EntityBlueprint]:
    """Project commands without a native semantic control as button entities."""
    profiles = document.get("remote_profiles", {})
    plan: list[EntityBlueprint] = []
    for primary in project_library(document):
        represented = _represented_command_ids(
            primary.platform, primary.roles, primary.abilities
        )
        commands = profiles[primary.remote_profile].get("commands", {})
        for command_id, command in sorted(commands.items()):
            if command_id in represented:
                continue
            plan.append(
                EntityBlueprint(
                    platform=BUTTON_PLATFORM,
                    entity_key=(f"{primary.appliance}__command__{command_id}"),
                    appliance=primary.appliance,
                    remote_profile=primary.remote_profile,
                    title=primary.title,
                    emitter=primary.emitter,
                    commands=(command_id,),
                    roles={},
                    abilities=primary.abilities,
                    command_id=command_id,
                    entity_name=str(command.get("name") or command_id),
                    icon=str(command.get("icon") or "mdi:remote"),
                )
            )
    return plan


def project_platform(
    document: dict[str, Any], platform: str
) -> dict[str, EntityBlueprint]:
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
