"""Focused tests for the deterministic offline catalog reader."""

import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

_MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "custom_components"
    / "imprint_refinery"
    / "catalog_artifact.py"
)
spec = importlib.util.spec_from_file_location(
    "irhub_catalog_artifact_test", _MODULE_PATH
)
assert spec and spec.loader
catalog_artifact = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catalog_artifact
spec.loader.exec_module(catalog_artifact)


class CatalogArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "catalog.ircat"
        profile = {
            "profile_id": "flipper_irdb:TVs/Vizio/VX-1",
            "name": "Vizio VX-1",
            "category": "tv",
            "brand": "Vizio",
            "model": "VX 1 (US)",
            "remote_model": "VX-1",
            "aliases": ["VX_1"],
            "normalized": {
                "category": "tv",
                "brand": "vizio",
                "model": "vx 1 us",
                "remote_model": "vx 1",
                "aliases": "vx 1",
                "commands": "power volume up",
            },
            "command_count": 2,
            "formats": {"parsed": 2},
            "source_path": "TVs/Vizio/VX-1.ir",
            "entry": "profiles/example.ir",
        }
        manifest = {
            "schema_version": 1,
            "catalog_version": "test-1",
            "source": {"name": "Flipper-IRDB", "license": "CC0-1.0"},
            "counts": {"profiles": 1, "commands": 2},
            "profiles": [profile],
        }
        matches = {
            "schema_version": 1,
            "profiles": ["flipper_irdb:TVs/Vizio/VX-1"],
            "normalized_50us": {
                "a" * 64: [[0, 0, "Power"]],
            },
            "parsed": {
                "nec|10|20": [[0, 1, "Volume Up"]],
            },
        }
        with zipfile.ZipFile(self.path, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("matches.json", json.dumps(matches))
            archive.writestr(
                "profiles/example.ir", "Filetype: IR signals file\nVersion: 1\n"
            )
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        self.path.with_suffix(".ircat.sha256").write_text(f"{digest}  catalog.ircat\n")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_search_normalizes_punctuation_aliases_and_category(self) -> None:
        catalog = catalog_artifact.OfflineCatalog(self.path)
        matches = catalog.search(category="Television", brand="VIZIO", model="VX_1")
        self.assertEqual(
            [item["profile_id"] for item in matches], ["flipper_irdb:TVs/Vizio/VX-1"]
        )
        self.assertEqual(catalog.search(query="volume-up")[0]["command_count"], 2)

    def test_profile_is_loaded_lazily_with_provenance(self) -> None:
        catalog = catalog_artifact.OfflineCatalog(self.path)
        profile = catalog.get_profile("flipper_irdb:TVs/Vizio/VX-1")
        self.assertEqual(profile["catalog_version"], "test-1")
        self.assertEqual(profile["source"]["license"], "CC0-1.0")
        self.assertTrue(profile["document"].startswith("Filetype: IR signals file"))

    def test_match_index_is_lazy_exact_and_limited(self) -> None:
        catalog = catalog_artifact.OfflineCatalog(self.path)
        self.assertIsNone(catalog._matches)
        result = catalog.match(
            normalized_50us="a" * 64,
            parsed=[("NEC", 0x10, 0x20)],
            limit=1,
        )
        self.assertEqual(result["match_count"], 2)
        self.assertTrue(result["truncated"])
        self.assertEqual(result["matches"][0]["command"]["name"], "Power")
        self.assertEqual(result["matches"][0]["match_basis"]["type"], "normalized_50us")
        self.assertIsNotNone(catalog._matches)


if __name__ == "__main__":
    unittest.main()
