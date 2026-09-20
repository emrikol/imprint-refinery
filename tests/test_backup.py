"""Focused tests for portable native backup behavior."""

import json
import unittest

from custom_components.imprint_refinery.backup import (
    BackupError,
    export_backup,
    inspect_backup,
    normalize_import_command,
)
from custom_components.imprint_refinery.revisions import (
    append_revision,
    initialize_history,
    set_revision_label,
)


def _registry() -> dict:
    command = initialize_history(
        {
            "name": "Power",
            "code": "transport-one",
            "format": "zosung_base64",
            "source": {
                "type": "duplicate",
                "source_command": {
                    "location_id": "private_room",
                    "appliance_id": "private_tv",
                },
            },
            "signal": {
                "carrier_frequency": 38_000,
                "carrier_source": "assumed",
                "timings": [9000, 4500, 560, 560],
            },
        },
        created_at="t1",
        action="captured",
    )
    command["code"] = "transport-two"
    command["signal"]["timings"][-1] = 1690
    append_revision(command, created_at="t2", action="replaced")
    set_revision_label(command, 1, "Original remote")
    return {
        "version": 6,
        "emitters": {
            "private": {"ieee": "00:11:22:33:44:55:66:77"},
        },
        "locations": {
            "living_room": {
                "name": "Living room",
                "appliances": {
                    "television": {
                        "name": "Television",
                        "appliance_type": "television",
                        "preferred_platform": "media_player",
                        "emitter_id": "private",
                        "commands": {"power": command},
                    }
                },
            }
        },
    }


class NativeBackupTests(unittest.TestCase):
    def test_full_history_roundtrip_is_portable_and_lossless(self) -> None:
        exported = export_backup(
            _registry(),
            location_id="living_room",
            appliance_id="television",
            include_history=True,
        )
        serialized = json.dumps(exported)

        self.assertNotIn("emitters", serialized)
        self.assertNotIn("source_command", serialized)
        self.assertNotIn("00:11:22", serialized)

        inspected = inspect_backup(serialized)
        command = inspected["commands"][0]["command"]
        self.assertEqual(inspected["history"], "full")
        self.assertEqual(command["current_revision"], 2)
        self.assertEqual(len(command["revisions"]), 2)
        self.assertEqual(command["revision_labels"]["1"], "Original remote")
        self.assertEqual(command["signal"]["timings"][-1], 1690)

    def test_current_only_backup_creates_one_import_revision(self) -> None:
        exported = export_backup(_registry(), include_history=False)
        inspected = inspect_backup(exported)
        command = inspected["commands"][0]["command"]

        self.assertNotIn("revisions", command)
        imported = normalize_import_command(command, created_at="imported-at")
        self.assertEqual(imported["current_revision"], 1)
        self.assertEqual(imported["revisions"][0]["action"], "imported")
        self.assertEqual(imported["revisions"][0]["created_at"], "imported-at")

    def test_version_check_rejects_unknown_backup_version(self) -> None:
        exported = export_backup(_registry())
        exported["version"] = 99

        with self.assertRaisesRegex(BackupError, "unsupported native backup version"):
            inspect_backup(exported)

    def test_non_product_document_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            BackupError, "document is not an Imprint Refinery backup"
        ):
            inspect_backup({"commands": {"power": {"code": "foreign"}}})


if __name__ == "__main__":
    unittest.main()
