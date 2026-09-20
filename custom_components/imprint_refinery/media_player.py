"""Home Assistant media controls projected from stored infrared signals."""

from homeassistant.components.media_player import MediaPlayerEntity
from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_IDLE, STATE_OFF, STATE_PAUSED, STATE_PLAYING
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .capabilities import PowerControl
from .consumer import LibraryEntity, async_install_projection
from .entity_projection import EntityBlueprint
from .storage import SignalLibraryStore

MEDIA_PLAYER_DOMAIN = "media_player"
_ACTION_FLAGS = (
    ("play", MediaPlayerEntityFeature.PLAY),
    ("pause", MediaPlayerEntityFeature.PAUSE),
    ("stop", MediaPlayerEntityFeature.STOP),
    ("next", MediaPlayerEntityFeature.NEXT_TRACK),
    ("previous", MediaPlayerEntityFeature.PREVIOUS_TRACK),
    ("volume_step", MediaPlayerEntityFeature.VOLUME_STEP),
    ("mute", MediaPlayerEntityFeature.VOLUME_MUTE),
)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    add_entities: AddEntitiesCallback,
) -> None:
    """Install the media-player projection for this library."""
    await async_install_projection(
        hass,
        entry,
        add_entities,
        runtime_key="media_player_projection",
        entity_domain=MEDIA_PLAYER_DOMAIN,
        build_entity=SignalMediaPlayer,
    )


def supported_features(blueprint: EntityBlueprint) -> MediaPlayerEntityFeature:
    """Build Home Assistant flags from the signal roles available to a device."""
    flags = MediaPlayerEntityFeature(0)
    for role, flag in _ACTION_FLAGS:
        if role in blueprint.abilities.media_controls:
            flags |= flag
    if blueprint.abilities.source_ids:
        flags |= MediaPlayerEntityFeature.SELECT_SOURCE
    if blueprint.abilities.power_control is not PowerControl.ABSENT:
        flags |= MediaPlayerEntityFeature.TURN_ON | MediaPlayerEntityFeature.TURN_OFF
    return flags


def source_command(blueprint: EntityBlueprint, label: str) -> str:
    """Return the command associated with a source's display label."""
    command = next(
        (
            command_id
            for command_id, name in blueprint.abilities.source_labels.items()
            if name == label
        ),
        None,
    )
    if command is None:
        raise ServiceValidationError(
            f"IR device {blueprint.registry_device_key} has no source {label}"
        )
    return command


def _select_role(blueprint: EntityBlueprint, choices: tuple[str, ...]) -> str:
    role = next(
        (candidate for candidate in choices if candidate in blueprint.roles), None
    )
    if role is None:
        options = ", ".join(choices)
        raise ServiceValidationError(
            f"IR device {blueprint.registry_device_key} has no supported command among {options}"
        )
    return role


class SignalMediaPlayer(LibraryEntity, MediaPlayerEntity, RestoreEntity):
    """Optimistic media-player state driven by one-way infrared commands."""

    def __init__(self, store: SignalLibraryStore, blueprint: EntityBlueprint) -> None:
        self._attr_state = STATE_IDLE
        self._attr_source: str | None = None
        self._attr_is_volume_muted: bool | None = None
        super().__init__(store, blueprint)

    def update_blueprint(self, blueprint: EntityBlueprint) -> None:
        self._attr_supported_features = supported_features(blueprint)
        sources = blueprint.abilities.source_ids
        self._attr_source_list = (
            [blueprint.abilities.source_labels[command] for command in sources]
            if sources
            else None
        )
        roles = blueprint.roles
        toggle_only = "mute_toggle" in roles and not all(
            role in roles for role in ("mute", "unmute")
        )
        self._attr_extra_state_attributes = (
            {"mute_state_assumed": True} if toggle_only else None
        )
        lost_power_controls = blueprint.abilities.power_control is PowerControl.ABSENT
        if lost_power_controls and self._attr_state == STATE_OFF:
            self._attr_state = STATE_IDLE
        LibraryEntity.update_blueprint(self, blueprint)

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        previous = await self.async_get_last_state()
        if previous is None:
            return
        can_be_off = self._blueprint.abilities.power_control is not PowerControl.ABSENT
        if previous.state != STATE_OFF or can_be_off:
            self._attr_state = previous.state
        self._attr_source = previous.attributes.get("source")
        if "is_volume_muted" in previous.attributes:
            self._attr_is_volume_muted = previous.attributes["is_volume_muted"]

    def _publish(self, *, state: str | None = None) -> None:
        if state is not None:
            self._attr_state = state
        self.async_write_ha_state()

    async def _send_role(
        self,
        *choices: str,
        state: str | None = None,
    ) -> None:
        await self.async_send_feature_command(_select_role(self._blueprint, choices))
        self._publish(state=state)

    async def _send_power(self, turn_on: bool) -> None:
        mode = self._blueprint.abilities.power_control
        if mode is PowerControl.ABSENT:
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no supported power command"
            )
        role = "power_on" if turn_on else "power_off"
        await self._send_role(
            *(role, "power_toggle") if mode is PowerControl.TOGGLE else (role,),
            state=STATE_IDLE if turn_on else STATE_OFF,
        )

    async def async_turn_on(self) -> None:
        await self._send_power(True)

    async def async_turn_off(self) -> None:
        await self._send_power(False)

    async def async_media_play(self) -> None:
        await self._send_role("play", state=STATE_PLAYING)

    async def async_media_pause(self) -> None:
        await self._send_role("pause", "play_pause_toggle", state=STATE_PAUSED)

    async def async_media_play_pause(self) -> None:
        next_state = (
            STATE_PAUSED if self._attr_state == STATE_PLAYING else STATE_PLAYING
        )
        await self._send_role("play_pause_toggle", "pause", "play", state=next_state)

    async def async_media_stop(self) -> None:
        await self._send_role("stop", state=STATE_IDLE)

    async def async_media_next_track(self) -> None:
        await self._send_role("next")

    async def async_media_previous_track(self) -> None:
        await self._send_role("previous")

    async def async_volume_up(self) -> None:
        await self._send_role("volume_up")

    async def async_volume_down(self) -> None:
        await self._send_role("volume_down")

    async def async_mute_volume(self, mute: bool) -> None:
        choices = ("mute", "mute_toggle") if mute else ("unmute", "mute_toggle")
        try:
            await self.async_send_feature_command(
                _select_role(self._blueprint, choices)
            )
        except ServiceValidationError as error:
            action = "mute" if mute else "unmute"
            raise ServiceValidationError(
                f"IR device {self._blueprint.registry_device_key} has no supported command for {action}"
            ) from error
        self._attr_is_volume_muted = mute
        self._publish()

    async def async_select_source(self, source: str) -> None:
        await self.async_send_stored_command(source_command(self._blueprint, source))
        self._attr_source = source
        self._publish()
