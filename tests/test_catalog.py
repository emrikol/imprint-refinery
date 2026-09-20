"""Unit tests for the bundled offline catalog adapter."""

import unittest
from unittest.mock import patch

from custom_components.imprint_refinery import catalog

_PROFILE = """Filetype: IR signals file
Version: 1
#
name: Power
type: raw
frequency: 38000
duty_cycle: 0.33
data: 9000 4500 560 560
#
name: Volume Up
type: raw
frequency: 38000
duty_cycle: 0.33
data: 9000 4500 560 1690
#
name: Vendor Button
type: parsed
protocol: Unsupported42
address: 00 00 00 00
command: 01 00 00 00
"""


class _FakeArtifact:
    def status(self):
        return {
            "installed": True,
            "version": "test-1",
            "counts": {"profiles": 1, "commands": 2},
            "source": {
                "name": "Flipper-IRDB",
                "license": "CC0-1.0",
                "revision": "abc123",
            },
        }

    def search(self, **filters):
        profiles = [
            {
                "profile_id": "flipper_irdb:TVs/Example/Model-1",
                "name": "Example Model 1",
                "brand": "Example",
                "model": "Model 1",
                "category": "tv",
                "command_count": 2,
                "formats": {"raw": 2},
                "remote_model": "M1",
                "aliases": [],
            },
            {
                "profile_id": "flipper_irdb:Receivers/Example/Receiver-1",
                "name": "Example Receiver 1",
                "brand": "Example",
                "model": "Receiver 1",
                "category": "receiver",
                "command_count": 1,
                "formats": {"raw": 1},
                "remote_model": "R1",
                "aliases": ["AV Family"],
            },
        ]
        category = filters.get("category")
        if category:
            profiles = [item for item in profiles if item["category"] == category]
        return profiles[: filters.get("limit", 50)]

    def get_profile(self, profile_id):
        if profile_id != "flipper_irdb:TVs/Example/Model-1":
            raise KeyError(profile_id)
        return {
            **self.search()[0],
            "document": _PROFILE,
            "catalog_version": "test-1",
            "source_path": "TVs/Example/Model-1.ir",
            "source": {
                "name": "Flipper-IRDB",
                "license": "CC0-1.0",
                "revision": "abc123",
            },
        }

    def match(self, **_filters):
        return {
            "match_count": 1,
            "truncated": False,
            "matches": [
                {
                    "profile": {
                        **self.search()[0],
                        "source_path": "TVs/Example/Model-1.ir",
                    },
                    "command": {
                        "name": "Power",
                        "record_index": 0,
                        "record_type": "raw",
                    },
                    "match_basis": {
                        "type": "normalized_50us",
                        "fingerprint": "a" * 64,
                    },
                }
            ],
        }


class CatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.artifact = _FakeArtifact()
        self.bundle = patch.object(
            catalog, "bundled_catalog", return_value=self.artifact
        )
        self.bundle.start()
        catalog.catalog_status.cache_clear()
        catalog.get_profile.cache_clear()

    def tearDown(self) -> None:
        catalog.get_profile.cache_clear()
        catalog.catalog_status.cache_clear()
        self.bundle.stop()

    def test_search_and_expand_use_only_bundled_artifact(self) -> None:
        result = catalog.search_profiles(category="tv", brand="Example", model="M1")
        self.assertEqual(result["catalog"]["source"], "Flipper-IRDB")
        self.assertNotIn("semantic_adapter", result["catalog"])
        self.assertEqual(
            result["profiles"][0]["profile_id"],
            "flipper_irdb:TVs/Example/Model-1",
        )

        profile = catalog.get_profile(result["profiles"][0]["profile_id"])
        self.assertEqual(profile["source"]["license"], "CC0-1.0")
        self.assertEqual(
            [item["command_id"] for item in profile["commands"]],
            ["power", "volume_up"],
        )
        self.assertTrue(profile["commands"][0]["code"])
        self.assertIn(
            "name: Power",
            profile["commands"][0]["source"]["original_representation"],
        )
        self.assertEqual(len(profile["unsupported_commands"]), 1)
        self.assertIn(
            "protocol: Unsupported42",
            profile["unsupported_commands"][0]["original_representation"],
        )

    def test_search_maps_ui_categories_to_catalog_families(self) -> None:
        result = catalog.search_profiles(category="audio", brand="Example", model="R1")

        self.assertEqual(len(result["profiles"]), 1)
        self.assertEqual(result["profiles"][0]["category"], "receiver")
        self.assertEqual(result["profiles"][0]["match"], "remote_family")

    def test_import_preview_exposes_starter_conflicts_duplicates_and_provenance(
        self,
    ) -> None:
        profile = catalog.get_profile("flipper_irdb:TVs/Example/Model-1")
        power = profile["commands"][0]
        registry = {
            "locations": {
                "living_room": {
                    "appliances": {
                        "tv": {
                            "commands": {
                                "power": {
                                    "name": "Existing Power",
                                    "code": power["code"],
                                    "current_revision": 3,
                                    "analysis": power["analysis"],
                                }
                            }
                        }
                    }
                }
            }
        }

        preview = catalog.prepare_profile_import(
            profile["profile_id"],
            registry_data=registry,
            location_id="living_room",
            appliance_id="tv",
        )

        self.assertEqual(
            preview["import_plan"]["starter_command_ids"],
            ["power", "volume_up"],
        )
        self.assertEqual(preview["import_plan"]["conflict_count"], 1)
        self.assertEqual(preview["import_plan"]["duplicate_count"], 1)
        self.assertEqual(preview["import_plan"]["unsupported_count"], 1)
        self.assertEqual(
            preview["commands"][0]["import"]["target_conflict"]["current_revision"],
            3,
        )
        self.assertEqual(
            preview["commands"][0]["import"]["duplicates"][0]["match_basis"],
            "normalized_50us",
        )
        self.assertEqual(
            preview["commands"][0]["import"]["provenance"]["source_path"],
            "TVs/Example/Model-1.ir",
        )

    def test_guided_candidates_deduplicate_power_signals(self) -> None:
        result = catalog.guided_candidates(category="tv", brand="Example")
        self.assertEqual(len(result["candidates"]), 1)
        candidate = result["candidates"][0]
        self.assertEqual(candidate["profile_ids"], ["flipper_irdb:TVs/Example/Model-1"])
        self.assertEqual(candidate["command"]["command_id"], "power")

    def test_match_signal_returns_exact_artifact_reference(self) -> None:
        signal = catalog.IRSignal([9000, 4500, 560, 560], 38_000)
        result = catalog.match_signal(signal)

        self.assertEqual(result["match_count"], 1)
        self.assertEqual(result["matches"][0]["command"]["command_id"], "power")
        self.assertEqual(result["matches"][0]["match_basis"]["type"], "normalized_50us")
        self.assertIn("normalized_50us", result["fingerprints"])

        from_analysis = catalog.match_signal(
            {"analysis": catalog.analyze_signal(signal)}
        )
        self.assertEqual(from_analysis["fingerprints"], result["fingerprints"])

    def test_missing_artifact_is_reported_without_fallback(self) -> None:
        catalog.catalog_status.cache_clear()
        with (
            patch.object(
                catalog,
                "bundled_catalog",
                side_effect=catalog.CatalogArtifactError("missing"),
            ),
            self.assertRaisesRegex(catalog.CatalogUnavailableError, "not installed"),
        ):
            catalog.match_signal(catalog.IRSignal([560, 560]))


if __name__ == "__main__":
    unittest.main()
