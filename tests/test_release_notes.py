"""Tests for the release-notes extraction tool."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[1] / "tools" / "release_notes.py"
SPEC = importlib.util.spec_from_file_location("release_notes", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
release_notes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_notes)

CHANGELOG = """# Changelog

## Unreleased

### Added

- Unreleased work.

## 0.3.1 - 2026-10-18

### Fixed

- Fixed capture.

## 0.3.0 - 2026-09-24

### Added

- Added profiles.
"""


def test_release_notes_returns_only_the_matching_section() -> None:
    assert release_notes.release_notes("0.3.1", CHANGELOG) == (
        "## 0.3.1 - 2026-10-18\n\n### Fixed\n\n- Fixed capture.\n"
    )


def test_release_notes_returns_last_section() -> None:
    assert release_notes.release_notes("0.3.0", CHANGELOG) == (
        "## 0.3.0 - 2026-09-24\n\n### Added\n\n- Added profiles.\n"
    )


def test_release_notes_rejects_unknown_version() -> None:
    with pytest.raises(ValueError, match="no section for 9.9.9"):
        release_notes.release_notes("9.9.9", CHANGELOG)
