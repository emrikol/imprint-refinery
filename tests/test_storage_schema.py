"""Tests for the independent Imprint Refinery storage document."""

from copy import deepcopy

import pytest

from custom_components.imprint_refinery.errors import ImprintRefineryError
from custom_components.imprint_refinery.ir_formats import IRSignal, zosung_encode
from custom_components.imprint_refinery.library import (
    LIBRARY_SCHEMA,
    SignalLibrary,
    empty_library,
    load_library,
)
from custom_components.imprint_refinery.revisions import initialize_history
from custom_components.imprint_refinery.storage import STORAGE_VERSION


def test_new_library_uses_canonical_raw_signal_schema() -> None:
    assert empty_library() == {
        "schema": LIBRARY_SCHEMA,
        "version": 2,
        "emitters": {},
        "locations": {},
    }
    assert STORAGE_VERSION == 1


def test_loaded_library_is_detached_from_store_payload() -> None:
    payload = empty_library()
    payload["locations"]["room"] = {"name": "Room", "appliances": {}}
    before = deepcopy(payload)

    loaded = load_library(payload)
    loaded["locations"]["room"]["name"] = "Changed"

    assert payload == before


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
    library.put_location("room", "Room")
    library.put_appliance("room", "lamp", "Lamp", "light")

    library.insert_imported_command("room", "lamp", "power", command)

    stored = library.command("room", "lamp", "power")
    assert stored["format"] == "raw_signed"
    assert stored["code"] == "+9000 -4500 +560 -1690"
    assert stored["revisions"][0]["snapshot"]["format"] == "raw_signed"
    assert stored["revisions"][0]["snapshot"]["code"] == stored["code"]


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
            "Unsupported stored library version",
        ),
        (
            {
                "schema": LIBRARY_SCHEMA,
                "version": 2,
                "emitters": [],
                "locations": {},
            },
            "emitters must be an object",
        ),
        (
            {
                "schema": LIBRARY_SCHEMA,
                "version": 2,
                "emitters": {},
                "locations": [],
            },
            "locations must be an object",
        ),
    ],
)
def test_invalid_library_documents_are_rejected(payload, message) -> None:
    with pytest.raises(ImprintRefineryError, match=message):
        load_library(payload)
