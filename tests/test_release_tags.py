"""Tests for the release changelog gates."""

from pathlib import Path
import subprocess
import sys

SCRIPT = Path(__file__).parents[1] / "tools" / "check_release.py"
MANIFEST = Path("custom_components/imprint_refinery/manifest.json")


def _git(*arguments: str) -> None:
    subprocess.run(("git", *arguments), check=True, capture_output=True, text=True)


def _commit(message: str) -> None:
    _git("add", "--all")
    _git("commit", "-m", message)


def _validate(tag: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        (sys.executable, str(SCRIPT), tag),
        check=False,
        capture_output=True,
        text=True,
    )


def _repository(tmp_path, monkeypatch, changelog: str) -> None:
    monkeypatch.chdir(tmp_path)
    _git("init", "--initial-branch=main")
    _git("config", "user.name", "Release Test")
    _git("config", "user.email", "release@example.invalid")
    (tmp_path / "CHANGELOG.md").write_text(changelog, encoding="utf-8")
    manifest = tmp_path / MANIFEST
    manifest.parent.mkdir(parents=True)
    manifest.write_text('{"version": "0.1.0"}\n', encoding="utf-8")
    _commit("Initial release")


def test_release_commit_requires_staged_changelog_change(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - 2026-09-22\n")
    (tmp_path / MANIFEST).write_text('{"version": "0.2.0"}\n', encoding="utf-8")
    _git("add", str(MANIFEST))

    result = _validate("--staged")

    assert result.returncode == 1
    assert "stage a CHANGELOG.md change with the version bump" in result.stderr


def test_release_commit_accepts_staged_changelog_change(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - 2026-09-22\n")
    (tmp_path / MANIFEST).write_text('{"version": "0.2.0"}\n', encoding="utf-8")
    (tmp_path / "CHANGELOG.md").write_text(
        "# Changelog\n\n## 0.2.0 - 2026-09-23\n\n## 0.1.0 - 2026-09-22\n",
        encoding="utf-8",
    )
    _git("add", str(MANIFEST), "CHANGELOG.md")

    assert _validate("--staged").returncode == 0


def test_first_release_requires_dated_changelog(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - Unreleased\n")
    _git("tag", "v0.1.0")

    result = _validate("v0.1.0")

    assert result.returncode == 1
    assert "the 0.1.0 changelog section is still unreleased" in result.stderr


def test_first_release_accepts_matching_changelog(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - 2026-09-22\n")
    _git("tag", "v0.1.0")

    assert _validate("v0.1.0").returncode == 0


def test_later_release_requires_changelog_change(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - 2026-09-22\n")
    _git("tag", "v0.1.0")
    (tmp_path / "other.txt").write_text("changed\n", encoding="utf-8")
    _git("add", "other.txt")
    _git("commit", "-m", "Change without changelog")
    _git("tag", "v0.2.0")

    result = _validate("v0.2.0")

    assert result.returncode == 1
    assert "CHANGELOG.md has no section for 0.2.0" in result.stderr
    assert "CHANGELOG.md did not change since v0.1.0" in result.stderr


def test_later_release_accepts_changed_changelog(tmp_path, monkeypatch) -> None:
    _repository(tmp_path, monkeypatch, "# Changelog\n\n## 0.1.0 - 2026-09-22\n")
    _git("tag", "v0.1.0")
    (tmp_path / "CHANGELOG.md").write_text(
        "# Changelog\n\n## 0.2.0 - 2026-09-23\n\n## 0.1.0 - 2026-09-22\n",
        encoding="utf-8",
    )
    _commit("Prepare 0.2.0")
    _git("tag", "v0.2.0")

    assert _validate("v0.2.0").returncode == 0
