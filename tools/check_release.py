"""Enforce changelog updates for release commits and tags."""

import json
import re
import subprocess
import sys

CHANGELOG = "CHANGELOG.md"
MANIFEST = "custom_components/imprint_refinery/manifest.json"
VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")
RELEASE_TAG = re.compile(
    r"^v(?P<version>(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$"
)


def _git(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ("git", *arguments),
        check=check,
        capture_output=True,
        text=True,
    )


def _previous_release(commit: str) -> str | None:
    parents = _git("rev-list", "--parents", "-n", "1", commit).stdout.split()
    if len(parents) < 2:
        return None
    result = _git(
        "describe",
        "--tags",
        "--match",
        "v[0-9]*",
        "--abbrev=0",
        f"{commit}^",
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def _changelog_errors(subject: str, version: str, changelog: str) -> list[str]:
    heading_pattern = re.compile(rf"^## \[?{re.escape(version)}\]?(?:\s+-\s+.+)?$")
    heading = next(
        (line for line in changelog.splitlines() if heading_pattern.fullmatch(line)),
        None,
    )
    if heading is None:
        return [f"{subject}: {CHANGELOG} has no section for {version}"]
    if "unreleased" in heading.casefold():
        return [f"{subject}: the {version} changelog section is still unreleased"]
    return []


def _manifest_version(content: str) -> str | None:
    try:
        version = json.loads(content).get("version")
    except AttributeError, json.JSONDecodeError:
        return None
    return version if isinstance(version, str) and VERSION.fullmatch(version) else None


def validate_release_commit() -> list[str]:
    """Return errors when a staged version bump lacks a changelog update."""
    staged_manifest = _git("show", f":{MANIFEST}", check=False)
    if staged_manifest.returncode != 0:
        return []
    new_version = _manifest_version(staged_manifest.stdout)
    if new_version is None:
        return [f"staged {MANIFEST} has no valid semantic version"]

    head_manifest = _git("show", f"HEAD:{MANIFEST}", check=False)
    old_version = (
        _manifest_version(head_manifest.stdout)
        if head_manifest.returncode == 0
        else None
    )
    if old_version == new_version:
        return []

    staged_changelog = _git("show", f":{CHANGELOG}", check=False)
    if staged_changelog.returncode != 0:
        return [f"release {new_version}: staged commit does not contain {CHANGELOG}"]
    head_changelog = _git("show", f"HEAD:{CHANGELOG}", check=False)
    if (
        head_changelog.returncode == 0
        and head_changelog.stdout == staged_changelog.stdout
    ):
        return [
            f"release {new_version}: stage a {CHANGELOG} change with the version bump"
        ]
    return _changelog_errors("release commit", new_version, staged_changelog.stdout)


def validate_release_tag(tag: str) -> list[str]:
    """Return validation errors for one release tag."""
    match = RELEASE_TAG.fullmatch(tag)
    if match is None:
        return [f"{tag}: release tags must use vMAJOR.MINOR.PATCH"]

    commit_result = _git("rev-parse", "--verify", f"{tag}^{{commit}}", check=False)
    if commit_result.returncode != 0:
        return [f"{tag}: tag does not resolve to a commit"]
    commit = commit_result.stdout.strip()

    changelog_result = _git("show", f"{commit}:{CHANGELOG}", check=False)
    if changelog_result.returncode != 0:
        return [f"{tag}: tagged commit does not contain {CHANGELOG}"]

    errors = _changelog_errors(tag, match.group("version"), changelog_result.stdout)

    previous = _previous_release(commit)
    if previous is not None:
        diff = _git("diff", "--quiet", previous, commit, "--", CHANGELOG, check=False)
        if diff.returncode == 0:
            errors.append(f"{tag}: {CHANGELOG} did not change since {previous}")
        elif diff.returncode != 1:
            errors.append(f"{tag}: could not compare {CHANGELOG} with {previous}")
    return errors


def main(arguments: list[str]) -> int:
    if arguments == ["--staged"]:
        errors = validate_release_commit()
        if errors:
            print("Release commit validation failed:", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        return 0

    tags = (
        arguments
        or _git("tag", "--list", "v[0-9]*", "--sort=version:refname").stdout.split()
    )
    errors = [error for tag in tags for error in validate_release_tag(tag)]
    if errors:
        print("Release tag validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    if tags:
        print(f"Validated {len(tags)} release tag{'s' if len(tags) != 1 else ''}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
