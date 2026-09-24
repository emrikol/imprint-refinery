"""Specification tests for the library-to-entity projection."""

from custom_components.imprint_refinery.entity_projection import (
    project_command_buttons,
    project_library,
    project_platform,
)


def library_with(*appliances: tuple[str, dict]) -> dict:
    profiles = {}
    instances = {}
    for appliance_id, data in appliances:
        global_id = f"studio__{appliance_id}"
        profile_id = f"{global_id}_profile"
        profiles[profile_id] = {
            "name": data.get("name", appliance_id),
            "appliance_type": data.get("appliance_type", "generic"),
            "commands": data.get("commands", {}),
        }
        instances[global_id] = {
            "name": data.get("name", appliance_id),
            "remote_profile_id": profile_id,
            "infrared_emitter_ref": data.get(
                "infrared_emitter_ref", data.get("emitter_id", "emitter-uuid")
            ),
            "preferred_platform": data.get("preferred_platform", "auto"),
        }
    return {"remote_profiles": profiles, "appliances": instances}


def test_projection_selects_platforms_without_creating_compatibility_entities() -> None:
    document = library_with(
        (
            "receiver",
            {
                "name": "Receiver",
                "appliance_type": "media_player",
                "preferred_platform": "auto",
                "emitter_id": "desk_blaster",
                "commands": {
                    "start": {"name": "Start", "role": "play"},
                    "quiet": {"name": "Quiet", "role": "volume_down"},
                },
            },
        ),
        (
            "lamp",
            {
                "name": "Lamp",
                "appliance_type": "switch",
                "preferred_platform": "auto",
                "commands": {
                    "ignite": {"role": "power_on"},
                    "darken": {"role": "power_off"},
                },
            },
        ),
        (
            "remote",
            {
                "name": "Loose buttons",
                "appliance_type": "generic",
                "preferred_platform": "remote",
                "commands": {"odd": {"role": "custom"}},
            },
        ),
    )

    plans = {item.appliance: item for item in project_library(document)}

    assert plans["studio__receiver"].platform == "media_player"
    assert plans["studio__receiver"].emitter == "desk_blaster"
    assert plans["studio__receiver"].roles == {
        "play": "start",
        "volume_down": "quiet",
    }
    assert plans["studio__lamp"].platform == "switch"
    assert plans["studio__lamp"].entity_key == "studio__lamp__switch"
    assert plans["studio__remote"].platform == "remote"


def test_switch_preference_is_refused_for_mixed_controls() -> None:
    [plan] = project_library(
        library_with(
            (
                "hybrid",
                {
                    "preferred_platform": "switch",
                    "commands": {
                        "power": {"role": "power_toggle"},
                        "play": {"role": "play"},
                    },
                },
            )
        )
    )
    assert plan.platform == "remote"
    assert plan.entity_key == "studio__hybrid"


def test_duplicate_roles_choose_the_first_command_in_library_order() -> None:
    [plan] = project_library(
        library_with(
            (
                "screen",
                {
                    "commands": {
                        "first": {"role": "power_toggle"},
                        "second": {"role": "power_toggle"},
                    }
                },
            )
        )
    )
    assert plan.roles["power_toggle"] == "first"
    assert plan.commands == ("first", "second")


def test_platform_index_is_deterministic() -> None:
    wanted = project_platform(
        library_with(
            ("zeta", {"commands": {}}),
            ("alpha", {"commands": {}}),
        ),
        "remote",
    )

    assert list(wanted) == ["studio__alpha", "studio__zeta"]


def test_unmapped_commands_become_stable_named_button_entities() -> None:
    buttons = project_command_buttons(
        library_with(
            (
                "lamp",
                {
                    "name": "Floor lamp",
                    "commands": {
                        "on": {"name": "On", "role": "power_on"},
                        "off": {"name": "Off", "role": "power_off"},
                        "red": {"name": "Red", "icon": "mdi:palette"},
                        "timer_6h": {"name": "Timer: 6h", "role": "custom"},
                    },
                },
            )
        )
    )

    assert [button.command_id for button in buttons] == ["red", "timer_6h"]
    assert [button.entity_key for button in buttons] == [
        "studio__lamp__command__red",
        "studio__lamp__command__timer_6h",
    ]
    assert buttons[0].entity_name == "Red"
    assert buttons[0].icon == "mdi:palette"
    assert project_platform(
        library_with(("lamp", {"commands": {"red": {"name": "Red"}}})),
        "button",
    )


def test_media_buttons_exclude_only_commands_with_native_controls() -> None:
    buttons = project_command_buttons(
        library_with(
            (
                "receiver",
                {
                    "appliance_type": "media_player",
                    "commands": {
                        "play": {"role": "play"},
                        "louder": {"role": "volume_up"},
                        "quieter": {"role": "volume_down"},
                        "fast": {"name": "Fast forward", "role": "fast_forward"},
                        "night": {"name": "Night mode"},
                    },
                },
            )
        )
    )

    assert [button.command_id for button in buttons] == ["fast", "night"]


def test_unassigned_appliance_does_not_project_usable_entities() -> None:
    document = {
        "remote_profiles": {
            "remote_profile": {
                "name": "Remote",
                "appliance_type": "generic",
                "commands": {"custom": {"name": "Custom"}},
            }
        },
        "appliances": {
            "remote": {
                "name": "Remote",
                "remote_profile_id": "remote_profile",
                "infrared_emitter_ref": None,
                "preferred_platform": "remote",
            }
        },
    }
    assert project_command_buttons(document) == []
