"""Tests for the independent Imprint Refinery storage document."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from custom_components.imprint_refinery.errors import ImprintRefineryError
from custom_components.imprint_refinery.ir_formats import (
    ANALYZER_VERSION,
    IRSignal,
    encode_raw,
    signal_document,
    zosung_encode,
)
from custom_components.imprint_refinery.ir_formats.protocols.known import (
    encode_known_protocol,
)
from custom_components.imprint_refinery.library import (
    LIBRARY_SCHEMA,
    SignalLibrary,
    empty_library,
    load_library,
    migrate_v2_to_v3,
)
from custom_components.imprint_refinery.revisions import initialize_history
from custom_components.imprint_refinery.storage import (
    STORAGE_VERSION,
    SignalLibraryStore,
)


def test_new_library_uses_canonical_raw_signal_schema() -> None:
    assert empty_library() == {
        "schema": LIBRARY_SCHEMA,
        "version": 3,
        "remote_profiles": {},
        "appliances": {},
    }
    assert STORAGE_VERSION == 1


def test_loaded_library_is_detached_from_store_payload() -> None:
    payload = empty_library()
    payload["remote_profiles"]["lamp"] = {
        "name": "Lamp",
        "appliance_type": "light",
        "commands": {},
    }
    before = deepcopy(payload)

    loaded = load_library(payload)
    loaded["remote_profiles"]["lamp"]["name"] = "Changed"

    assert payload == before


def test_stale_command_analysis_is_refreshed_without_creating_a_revision() -> None:
    signal = encode_known_protocol("NEC", 0, 0x5E)
    store = SignalLibraryStore.__new__(SignalLibraryStore)
    store._library = SignalLibrary()
    store._library.put_remote_profile("lamp", "Lamp", "light")
    store._library.store_command(
        "lamp",
        "power",
        name="Power",
        code=encode_raw(signal, signed=True),
        code_format="raw_signed",
        source={"type": "learn"},
        role="power_toggle",
        signal=signal_document(signal, "assumed"),
        analysis={"analyzer_version": "generic-2", "protocol": "NEC"},
        timestamp="2026-01-01T00:00:00+00:00",
    )
    command = store.data["remote_profiles"]["lamp"]["commands"]["power"]
    revision_count = len(command["revisions"])

    assert store._refresh_stale_analysis() is True
    assert command["analysis"]["analyzer_version"] == ANALYZER_VERSION
    assert command["analysis"]["protocol"] == "NEC"
    assert command["analysis"]["protocol_rebuilds"]
    assert len(command["revisions"]) == revision_count
    assert store._refresh_stale_analysis() is False


def test_private_version_one_library_is_rejected_after_one_time_migration() -> None:
    payload = {
        "schema": LIBRARY_SCHEMA,
        "version": 1,
        "emitters": {},
        "locations": {},
    }

    with pytest.raises(
        ImprintRefineryError, match="Unsupported stored library version"
    ):
        load_library(payload)


def test_imported_command_and_history_are_canonicalized() -> None:
    signal = IRSignal([9000, 4500, 560, 1690], 38_000)
    command = initialize_history(
        {
            "name": "Power",
            "code": zosung_encode(signal),
            "format": "zosung_base64",
        },
        created_at="2026-01-01T00:00:00+00:00",
        action="imported",
    )
    library = SignalLibrary()
    library.put_remote_profile("lamp", "Lamp", "light")

    library.insert_imported_command("lamp", "power", command)

    stored = library.command("lamp", "power")
    assert stored["format"] == "raw_signed"
    assert stored["code"] == "+9000 -4500 +560 -1690"
    assert stored["revisions"][0]["snapshot"]["format"] == "raw_signed"
    assert stored["revisions"][0]["snapshot"]["code"] == stored["code"]


def test_duplicate_command_copies_current_state_into_independent_history() -> None:
    library = SignalLibrary()
    library.put_remote_profile("source", "Source")
    library.put_remote_profile("destination", "Destination")
    library.store_command(
        "source",
        "power",
        name="Power",
        code="+9000 -4500 +560 -560",
        code_format="raw_signed",
        source={"type": "learn"},
        role="power_toggle",
        signal={
            "carrier_frequency": 38_000,
            "carrier_source": "provided",
            "timings": [9000, 4500, 560, 560],
        },
        analysis={"protocol": "NEC"},
        timestamp="2026-01-01T00:00:00+00:00",
    )
    library.patch_command(
        "source",
        "power",
        icon="mdi:power",
        timestamp="2026-01-01T00:01:00+00:00",
    )

    library.duplicate_command(
        "source",
        "power",
        "destination",
        "main_power",
        "Main power",
        timestamp="2026-01-01T00:02:00+00:00",
    )

    source = library.command("source", "power")
    duplicate = library.command("destination", "main_power")
    assert duplicate["name"] == "Main power"
    for field in ("code", "format", "icon", "role", "source", "signal", "analysis"):
        assert duplicate[field] == source[field]
    assert len(source["revisions"]) == 2
    assert duplicate["current_revision"] == 1
    assert duplicate["revisions"] == [
        {
            "revision": 1,
            "created_at": "2026-01-01T00:02:00+00:00",
            "action": "duplicated",
            "parent_revision": None,
            "snapshot": duplicate["revisions"][0]["snapshot"],
            "details": {
                "source_remote_profile_id": "source",
                "source_command_id": "power",
            },
        }
    ]
    duplicate["signal"]["timings"][0] = 1
    assert source["signal"]["timings"][0] == 9000


def test_duplicate_command_rejects_destination_collision_without_mutation() -> None:
    library = SignalLibrary()
    library.put_remote_profile("source", "Source")
    library.put_remote_profile("destination", "Destination")
    for profile_id in ("source", "destination"):
        library.store_command(
            profile_id,
            "power",
            name="Power",
            code="+9000 -4500 +560 -560",
            code_format="raw_signed",
            source=None,
            role=None,
            signal=None,
            analysis=None,
            timestamp="2026-01-01T00:00:00+00:00",
        )
    before = deepcopy(library.document)

    with pytest.raises(ImprintRefineryError, match="already exists"):
        library.duplicate_command(
            "source",
            "power",
            "destination",
            "power",
            "Power",
            timestamp="2026-01-01T00:02:00+00:00",
        )

    assert library.document == before


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([], "root must be an object"),
        ({"version": 1, "emitters": {}, "locations": {}}, "schema"),
        (
            {
                "schema": LIBRARY_SCHEMA,
                "version": 3,
                "emitters": {},
                "locations": {},
            },
            "remote_profiles must be an object",
        ),
        (
            {
                "schema": LIBRARY_SCHEMA,
                "version": 2,
                "emitters": [],
                "locations": {},
            },
            "Unsupported stored library version",
        ),
        (
            {
                "schema": LIBRARY_SCHEMA,
                "version": 2,
                "emitters": {},
                "locations": [],
            },
            "Unsupported stored library version",
        ),
    ],
)
def test_invalid_library_documents_are_rejected(payload, message) -> None:
    with pytest.raises(ImprintRefineryError, match=message):
        load_library(payload)


def test_v2_migration_separates_profiles_appliances_and_emitter_references() -> None:
    payload = {
        "schema": LIBRARY_SCHEMA,
        "version": 2,
        "emitters": {"legacy_ir": {"ieee": "synthetic-address"}},
        "locations": {
            "living_room": {
                "name": "Living room",
                "appliances": {
                    "sconce": {
                        "name": "Wall sconce",
                        "appliance_type": "light",
                        "preferred_platform": "remote",
                        "emitter_id": "legacy_ir",
                        "commands": {
                            "power": {
                                "name": "Power",
                                "code": "+9000 -4500 +560 -560",
                                "format": "raw_signed",
                                "revisions": [{"revision_id": 1}],
                            }
                        },
                    }
                },
            }
        },
    }

    migrated = migrate_v2_to_v3(
        payload,
        emitter_refs={"legacy_ir": "00000000000000000000000000000001"},
    )

    assert migrated == {
        "schema": LIBRARY_SCHEMA,
        "version": 3,
        "remote_profiles": {
            "living_room__sconce": {
                "name": "Wall sconce",
                "appliance_type": "light",
                "commands": payload["locations"]["living_room"]["appliances"]["sconce"][
                    "commands"
                ],
            }
        },
        "appliances": {
            "living_room__sconce": {
                "name": "Wall sconce",
                "remote_profile_id": "living_room__sconce",
                "infrared_emitter_ref": "00000000000000000000000000000001",
                "preferred_platform": "remote",
            }
        },
    }
    assert "emitters" not in migrated
    assert "locations" not in migrated
    assert migrate_v2_to_v3(migrated) == migrated


def test_v2_migration_uses_only_emitter_when_legacy_route_is_unassigned() -> None:
    payload = {
        "schema": LIBRARY_SCHEMA,
        "version": 2,
        "emitters": {},
        "locations": {},
    }
    payload["locations"]["room"] = {
        "name": "Room",
        "appliances": {
            "fan": {
                "name": "Fan",
                "appliance_type": "fan",
                "commands": {},
            }
        },
    }

    migrated = migrate_v2_to_v3(
        payload, sole_emitter_ref="00000000000000000000000000000002"
    )

    assert (
        migrated["appliances"]["room__fan"]["infrared_emitter_ref"]
        == "00000000000000000000000000000002"
    )


def test_v2_migration_rejects_non_injective_legacy_appliance_identity() -> None:
    payload = {
        "schema": LIBRARY_SCHEMA,
        "version": 2,
        "emitters": {},
        "locations": {
            "a": {"appliances": {"b__c": {"commands": {}}}},
            "a__b": {"appliances": {"c": {"commands": {}}}},
        },
    }

    with pytest.raises(ImprintRefineryError, match="collide after migration"):
        migrate_v2_to_v3(payload)


def test_complete_migration_maps_legacy_location_to_area_without_overwriting_user_area(
    monkeypatch,
) -> None:
    store = SignalLibraryStore.__new__(SignalLibraryStore)
    store._hass = SimpleNamespace()
    store._store = SimpleNamespace(async_save=AsyncMock())
    store._library = SignalLibrary()
    store._library.put_remote_profile("room__lamp", "Lamp", "light")
    store._library.put_appliance("room__lamp", "Lamp", remote_profile_id="room__lamp")
    store._legacy_area_names = {"room__lamp": "Living room"}

    existing_area = SimpleNamespace(id="living-room", name="Living room")
    device = SimpleNamespace(id="device-1", area_id="user-selected-area")
    areas = SimpleNamespace(
        async_list_areas=lambda: [existing_area],
        async_create=lambda name: pytest.fail(f"unexpected area creation: {name}"),
    )
    devices = SimpleNamespace(
        async_get_devices=lambda **kwargs: [device],
        async_get_or_create=lambda **kwargs: pytest.fail("unexpected device creation"),
        async_update_device=lambda *args, **kwargs: pytest.fail(
            "existing user Area must be preserved"
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.storage.ar.async_get", lambda hass: areas
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.storage.dr.async_get", lambda hass: devices
    )

    asyncio.run(store.async_complete_migration("entry-1"))

    store._store.async_save.assert_awaited_once_with(store.data)
    assert store._legacy_area_names == {}


def test_complete_migration_creates_missing_area_and_assigns_device(
    monkeypatch,
) -> None:
    store = SignalLibraryStore.__new__(SignalLibraryStore)
    store._hass = SimpleNamespace()
    store._store = SimpleNamespace(async_save=AsyncMock())
    store._library = SignalLibrary()
    store._library.put_remote_profile("room__lamp", "Lamp", "light")
    store._library.put_appliance("room__lamp", "Lamp", remote_profile_id="room__lamp")
    store._legacy_area_names = {"room__lamp": "Living room"}

    created = SimpleNamespace(id="living-room", name="Living room")
    device = SimpleNamespace(id="device-1", area_id=None)
    updates = []
    areas = SimpleNamespace(
        async_list_areas=list,
        async_create=lambda name: created,
    )
    devices = SimpleNamespace(
        async_get_devices=lambda **kwargs: [device],
        async_get_or_create=lambda **kwargs: pytest.fail("unexpected device creation"),
        async_update_device=lambda device_id, **changes: updates.append(
            (device_id, changes)
        ),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.storage.ar.async_get", lambda hass: areas
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.storage.dr.async_get", lambda hass: devices
    )

    asyncio.run(store.async_complete_migration("entry-1"))

    assert updates == [("device-1", {"area_id": "living-room"})]
