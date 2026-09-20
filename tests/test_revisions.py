"""Unit tests for append-only command revision helpers."""

import unittest

from custom_components.imprint_refinery.revisions import (
    append_revision,
    command_history,
    command_without_history,
    initialize_history,
    restore_revision,
    set_revision_label,
)


class RevisionTests(unittest.TestCase):
    def test_revision_labels_do_not_mutate_immutable_snapshot(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "abc", "format": "zosung_base64"},
            created_at="2000-01-01T00:00:00+00:00",
        )
        snapshot = command["revisions"][0]["snapshot"].copy()

        set_revision_label(command, 1, "Best capture")

        self.assertEqual(command["revisions"][0]["snapshot"], snapshot)
        self.assertEqual(command_history(command)[0]["label"], "Best capture")
        set_revision_label(command, 1, "")
        self.assertNotIn("label", command_history(command)[0])

    def test_append_is_immutable_and_parented(self) -> None:
        command = initialize_history(
            {
                "name": "Power",
                "code": "one",
                "format": "zosung_base64",
                "icon": "mdi:power",
            },
            created_at="t1",
            action="captured",
        )
        command["code"] = "two"
        command["icon"] = "mdi:power-standby"

        changed = append_revision(
            command,
            created_at="t2",
            action="recaptured",
        )

        self.assertTrue(changed)
        self.assertEqual(command["current_revision"], 2)
        self.assertEqual(command["revisions"][0]["snapshot"]["code"], "one")
        self.assertEqual(command["revisions"][1]["snapshot"]["code"], "two")
        self.assertEqual(command["revisions"][1]["parent_revision"], 1)

    def test_identical_snapshot_does_not_create_revision(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
        )

        self.assertFalse(
            append_revision(command, created_at="t2", action="metadata_updated")
        )
        self.assertEqual(len(command["revisions"]), 1)

    def test_restore_appends_instead_of_deleting_history(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
            action="captured",
        )
        command["code"] = "two"
        append_revision(command, created_at="t2", action="edited")

        restore_revision(command, 1, created_at="t3")

        self.assertEqual(command["code"], "one")
        self.assertEqual(command["current_revision"], 3)
        self.assertEqual(len(command["revisions"]), 3)
        self.assertEqual(
            command["revisions"][2]["details"]["restored_from_revision"], 1
        )
        self.assertEqual(command["revisions"][2]["parent_revision"], 2)
        self.assertEqual(
            command_history(command)[2]["label"],
            "Restored from revision 1",
        )

    def test_history_exposes_lineage_and_current_revision(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
            action="captured",
        )
        command["code"] = "two"
        append_revision(command, created_at="t2", action="replaced")

        history = command_history(command)

        self.assertEqual(history[0]["lineage"], [1])
        self.assertEqual(history[1]["lineage"], [1, 2])
        self.assertNotIn("tested", history[0])
        self.assertNotIn("tested", history[1])
        self.assertFalse(history[0]["is_current"])
        self.assertTrue(history[1]["is_current"])

    def test_partial_migration_with_empty_history_creates_revision_one(self) -> None:
        command = initialize_history(
            {
                "name": "Power",
                "code": "one",
                "current_revision": 0,
                "revisions": [],
            },
            created_at="t1",
        )

        self.assertEqual(command["current_revision"], 1)
        self.assertEqual(len(command["revisions"]), 1)
        self.assertEqual(command["revisions"][0]["snapshot"]["code"], "one")

    def test_history_repair_keeps_only_labels_for_existing_revisions(self) -> None:
        command = initialize_history(
            {
                "name": "Power",
                "code": "one",
                "revision_labels": {"1": " Original ", "9": "Missing"},
            },
            created_at="t1",
        )

        self.assertEqual(command["revision_labels"], {"1": "Original"})

    def test_mismatched_current_state_appends_recovery_without_pruning(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
            action="captured",
        )
        set_revision_label(command, 1, "Original")
        command["code"] = "unsaved-visible-state"

        repaired = initialize_history(
            command,
            created_at="t2",
            action="recovered",
        )

        self.assertEqual(repaired["current_revision"], 2)
        self.assertEqual(len(repaired["revisions"]), 2)
        self.assertEqual(repaired["revisions"][0]["snapshot"]["code"], "one")
        self.assertEqual(
            repaired["revisions"][1]["snapshot"]["code"],
            "unsaved-visible-state",
        )
        self.assertEqual(command_history(repaired)[0]["label"], "Original")

    def test_append_uses_current_snapshot_not_last_history_entry(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
        )
        command["code"] = "two"
        append_revision(command, created_at="t2", action="edited")
        command["code"] = "one"
        command["current_revision"] = 1

        self.assertFalse(
            append_revision(command, created_at="t3", action="metadata_updated")
        )
        self.assertEqual(command["current_revision"], 1)
        self.assertEqual(len(command["revisions"]), 2)

    def test_empty_placeholder_does_not_enter_committed_history(self) -> None:
        command = {
            "name": "Power",
            "code": "",
            "current_revision": 0,
            "revisions": [],
        }

        self.assertFalse(
            append_revision(command, created_at="t1", action="metadata_updated")
        )
        self.assertEqual(command["current_revision"], 0)
        self.assertEqual(command["revisions"], [])

    def test_list_projection_omits_large_revision_payloads(self) -> None:
        command = initialize_history(
            {"name": "Power", "code": "one"},
            created_at="t1",
        )

        projected = command_without_history(command)

        self.assertNotIn("revisions", projected)
        self.assertEqual(projected["revision_count"], 1)
        self.assertEqual(projected["current_revision"], 1)


if __name__ == "__main__":
    unittest.main()
