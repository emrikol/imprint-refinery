"""Frontend translation contracts for integration and emitter setup flows."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INTEGRATION = ROOT / "custom_components" / "imprint_refinery"


def test_emitter_subentry_lifecycle_is_exposed_to_home_assistant() -> None:
    strings = json.loads((INTEGRATION / "strings.json").read_text())
    english = json.loads((INTEGRATION / "translations" / "en.json").read_text())

    assert english == strings
    emitter = strings["config_subentries"]["emitter"]
    assert emitter["entry_type"] == "IR emitter"
    assert emitter["initiate_flow"] == {
        "user": "Add IR emitter",
        "reconfigure": "Reconfigure IR emitter",
    }
    assert {"user", "manual", "reconfigure"} <= emitter["step"].keys()
