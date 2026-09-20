"""Behavior exposed by projected media-player, remote, and switch entities."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from homeassistant.components.media_player.const import MediaPlayerEntityFeature
from homeassistant.const import STATE_OFF, STATE_PAUSED, STATE_PLAYING
from homeassistant.core import State
from homeassistant.exceptions import ServiceValidationError
import pytest

from custom_components.imprint_refinery.button import SignalCommandButton
from custom_components.imprint_refinery.entity_projection import (
    project_command_buttons,
    project_library,
)
from custom_components.imprint_refinery.media_player import (
    SignalMediaPlayer,
    source_command,
    supported_features,
)
from custom_components.imprint_refinery.remote import SignalRemote
from custom_components.imprint_refinery.switch import SignalSwitch


def execute(awaitable):
    return asyncio.run(awaitable)


class LibraryStub:
    def __init__(self) -> None:
        self.emitter = {"ieee": "00:11"}
        self.data = {"emitters": {"0011": self.emitter}}

    def choose_emitter(self, requested=None):
        return self.emitter

    def command_at(self, location, appliance, command):
        return {"code": f"encoded:{command}", "format": "zosung_base64"}


def blueprint(
    roles: dict[str, str],
    *,
    appliance_type: str = "media_player",
    preferred_platform: str = "media_player",
):
    commands = {
        command: {"role": role, "name": command.replace("_", " ").title()}
        for command, role in roles.items()
    }
    [result] = project_library(
        {
            "locations": {
                "loft": {
                    "appliances": {
                        "receiver": {
                            "name": "Receiver",
                            "appliance_type": appliance_type,
                            "preferred_platform": preferred_platform,
                            "commands": commands,
                        }
                    }
                }
            }
        }
    )
    return result


def silence_state_writes(entity) -> None:
    entity.async_write_ha_state = lambda: None


@pytest.mark.parametrize(
    ("role", "flag"),
    [
        ("play", MediaPlayerEntityFeature.PLAY),
        ("pause", MediaPlayerEntityFeature.PAUSE),
        ("stop", MediaPlayerEntityFeature.STOP),
        ("next", MediaPlayerEntityFeature.NEXT_TRACK),
        ("previous", MediaPlayerEntityFeature.PREVIOUS_TRACK),
        ("mute_toggle", MediaPlayerEntityFeature.VOLUME_MUTE),
        ("source", MediaPlayerEntityFeature.SELECT_SOURCE),
        ("power_toggle", MediaPlayerEntityFeature.TURN_ON),
    ],
)
def test_media_flags_follow_roles(role, flag) -> None:
    plan = blueprint({f"button_{role}": role})
    assert supported_features(plan) & flag


def test_incomplete_pairs_do_not_claim_step_or_discrete_mute_support() -> None:
    plan = blueprint({"raise": "volume_up", "silence": "mute"})
    flags = supported_features(plan)
    assert not flags & MediaPlayerEntityFeature.VOLUME_STEP
    assert not flags & MediaPlayerEntityFeature.VOLUME_MUTE


def test_source_labels_map_back_to_the_stored_signal_id() -> None:
    plan = blueprint({"video_2": "source", "bluetooth": "source"})
    assert source_command(plan, "Video 2") == "video_2"
    with pytest.raises(ServiceValidationError, match="has no source Phono"):
        source_command(plan, "Phono")


def test_media_actions_choose_the_expected_roles_and_update_optimistic_state() -> None:
    plan = blueprint(
        {
            "turn_on": "power_on",
            "turn_off": "power_off",
            "begin": "play",
            "hold": "pause",
            "finish": "stop",
            "advance": "next",
            "rewind": "previous",
            "raise": "volume_up",
            "lower": "volume_down",
            "silence": "mute",
            "sound": "unmute",
            "video_2": "source",
        }
    )
    player = SignalMediaPlayer(LibraryStub(), plan)
    silence_state_writes(player)
    player.async_send_feature_command = AsyncMock()
    player.async_send_stored_command = AsyncMock()

    async def exercise() -> None:
        await player.async_turn_on()
        await player.async_media_play()
        assert player.state == STATE_PLAYING
        await player.async_media_pause()
        assert player.state == STATE_PAUSED
        await player.async_media_next_track()
        await player.async_media_previous_track()
        await player.async_volume_up()
        await player.async_volume_down()
        await player.async_mute_volume(True)
        await player.async_mute_volume(False)
        await player.async_select_source("Video 2")
        await player.async_media_stop()
        await player.async_turn_off()

    execute(exercise())
    sent_roles = [
        call.args[0] for call in player.async_send_feature_command.await_args_list
    ]
    assert sent_roles == [
        "power_on",
        "play",
        "pause",
        "next",
        "previous",
        "volume_up",
        "volume_down",
        "mute",
        "unmute",
        "stop",
        "power_off",
    ]
    player.async_send_stored_command.assert_awaited_once_with("video_2")
    assert player.state == STATE_OFF
    assert player.source == "Video 2"
    assert player.is_volume_muted is False


def test_play_pause_and_mute_toggles_are_explicitly_assumed() -> None:
    plan = blueprint({"transport": "play_pause_toggle", "sound": "mute_toggle"})
    player = SignalMediaPlayer(LibraryStub(), plan)
    silence_state_writes(player)
    player.async_send_feature_command = AsyncMock()

    execute(player.async_media_play_pause())
    assert player.state == STATE_PLAYING
    execute(player.async_media_play_pause())
    assert player.state == STATE_PAUSED
    execute(player.async_mute_volume(True))
    execute(player.async_mute_volume(False))

    assert player.extra_state_attributes == {"mute_state_assumed": True}
    assert [
        call.args[0] for call in player.async_send_feature_command.await_args_list
    ] == [
        "play_pause_toggle",
        "play_pause_toggle",
        "mute_toggle",
        "mute_toggle",
    ]


def test_missing_power_or_unmute_role_returns_actionable_validation_error() -> None:
    player = SignalMediaPlayer(
        LibraryStub(), blueprint({"play": "play", "mute": "mute"})
    )
    silence_state_writes(player)
    player.async_send_feature_command = AsyncMock()

    with pytest.raises(ServiceValidationError, match="no supported power command"):
        execute(player.async_turn_off())
    execute(player.async_mute_volume(True))
    with pytest.raises(ServiceValidationError, match="command for unmute"):
        execute(player.async_mute_volume(False))


def test_media_state_restore_retains_only_states_the_current_blueprint_can_hold() -> (
    None
):
    player = SignalMediaPlayer(LibraryStub(), blueprint({"play": "play"}))
    player.async_get_last_state = AsyncMock(
        return_value=State(
            "media_player.receiver",
            STATE_OFF,
            {"source": "Video 2", "is_volume_muted": True},
        )
    )
    execute(player.async_added_to_hass())
    assert player.state != STATE_OFF
    assert player.source == "Video 2"
    assert player.is_volume_muted is True


def test_switch_uses_discrete_power_when_available_and_tracks_local_state() -> None:
    plan = blueprint(
        {"bright": "power_on", "dark": "power_off"},
        appliance_type="switch",
        preferred_platform="switch",
    )
    switch = SignalSwitch(LibraryStub(), plan)
    silence_state_writes(switch)
    switch.async_send_feature_command = AsyncMock()

    execute(switch.async_turn_on())
    execute(switch.async_toggle())
    execute(switch.async_toggle())
    execute(switch.async_turn_off())

    assert [
        call.args[0] for call in switch.async_send_feature_command.await_args_list
    ] == [
        "power_on",
        "power_off",
        "power_on",
        "power_off",
    ]
    assert switch.is_on is False


def test_remote_sends_every_requested_command_in_order() -> None:
    plan = blueprint(
        {"one": "custom", "two": "custom"},
        appliance_type="generic",
        preferred_platform="remote",
    )
    remote = SignalRemote(LibraryStub(), plan)
    remote.async_send_stored_command = AsyncMock()

    execute(remote.async_send_command(["one", "two"]))

    assert [
        call.args[0] for call in remote.async_send_stored_command.await_args_list
    ] == [
        "one",
        "two",
    ]


def test_remote_repeats_the_command_sequence_with_the_requested_delay() -> None:
    plan = blueprint(
        {"one": "custom", "two": "custom"},
        appliance_type="generic",
        preferred_platform="remote",
    )
    remote = SignalRemote(LibraryStub(), plan)
    remote.async_send_stored_command = AsyncMock()

    with patch("custom_components.imprint_refinery.remote.asyncio.sleep") as sleep:
        execute(
            remote.async_send_command(["one", "two"], num_repeats=3, delay_secs=0.25)
        )

    assert [
        call.args[0] for call in remote.async_send_stored_command.await_args_list
    ] == ["one", "two", "one", "two", "one", "two"]
    assert [call.args[0] for call in sleep.await_args_list] == [0.25, 0.25]


def test_remote_empty_or_zero_repeat_requests_do_not_send_or_sleep() -> None:
    plan = blueprint(
        {"one": "custom"},
        appliance_type="generic",
        preferred_platform="remote",
    )
    remote = SignalRemote(LibraryStub(), plan)
    remote.async_send_stored_command = AsyncMock()

    with patch("custom_components.imprint_refinery.remote.asyncio.sleep") as sleep:
        execute(remote.async_send_command([], num_repeats=3, delay_secs=1))
        execute(remote.async_send_command(["one"], num_repeats=0, delay_secs=1))

    remote.async_send_stored_command.assert_not_awaited()
    sleep.assert_not_awaited()


def test_remote_rejects_hold_seconds_instead_of_guessing_protocol_behavior() -> None:
    plan = blueprint(
        {"one": "custom"},
        appliance_type="generic",
        preferred_platform="remote",
    )
    remote = SignalRemote(LibraryStub(), plan)
    remote.async_send_stored_command = AsyncMock()

    with pytest.raises(ServiceValidationError, match="cannot infer hold behavior"):
        execute(remote.async_send_command(["one"], hold_secs=1))

    remote.async_send_stored_command.assert_not_awaited()


def test_remote_command_updates_optimistic_power_after_each_successful_send() -> None:
    plan = blueprint(
        {"turn_on": "power_on", "turn_off": "power_off", "toggle": "power_toggle"},
        appliance_type="generic",
        preferred_platform="remote",
    )
    remote = SignalRemote(LibraryStub(), plan)
    remote.async_send_stored_command = AsyncMock()
    silence_state_writes(remote)

    execute(remote.async_send_command(["turn_on"]))
    assert remote.is_on is True
    execute(remote.async_send_command(["toggle"], num_repeats=2, delay_secs=0))
    assert remote.is_on is True
    execute(remote.async_send_command(["turn_off"]))
    assert remote.is_on is False


def test_command_button_preserves_name_icon_device_link_and_sends_once() -> None:
    [plan] = project_command_buttons(
        {
            "locations": {
                "loft": {
                    "name": "Loft",
                    "appliances": {
                        "lamp": {
                            "name": "Lamp",
                            "commands": {
                                "warm": {
                                    "name": "Warm white",
                                    "icon": "mdi:lightbulb-warm",
                                }
                            },
                        }
                    },
                }
            }
        }
    )
    button = SignalCommandButton(LibraryStub(), plan)
    button.async_send_stored_command = AsyncMock()

    execute(button.async_press())

    button.async_send_stored_command.assert_awaited_once_with("warm")
    assert button.name == "Warm white"
    assert button.icon == "mdi:lightbulb-warm"
    assert button.device_info["suggested_area"] == "Loft"
    assert button.device_info["configuration_url"].startswith(
        "homeassistant://navigate/imprint-refinery?"
    )


def test_existing_appliance_device_receives_missing_area_and_configuration_link() -> (
    None
):
    [plan] = project_command_buttons(
        {
            "locations": {
                "loft": {
                    "name": "Loft",
                    "appliances": {
                        "receiver": {
                            "name": "Receiver",
                            "commands": {"warm": {"name": "Warm", "icon": "mdi:fire"}},
                        }
                    },
                }
            }
        }
    )
    button = SignalCommandButton(LibraryStub(), plan)
    button.hass = SimpleNamespace()
    device = SimpleNamespace(id="device-1", area_id=None, configuration_url=None)
    devices = SimpleNamespace(
        async_get_devices=Mock(return_value=[device]),
        async_update_device=Mock(),
    )
    areas = SimpleNamespace(
        async_get_or_create=Mock(return_value=SimpleNamespace(id="loft-area"))
    )

    with (
        patch(
            "custom_components.imprint_refinery.consumer.dr.async_get",
            return_value=devices,
        ),
        patch(
            "custom_components.imprint_refinery.consumer.ar.async_get",
            return_value=areas,
        ),
    ):
        execute(button.async_added_to_hass())

    devices.async_update_device.assert_called_once_with(
        "device-1",
        configuration_url=plan.configuration_url,
        area_id="loft-area",
    )
