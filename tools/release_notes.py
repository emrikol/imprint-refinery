#!/usr/bin/env python3
"""Print the changelog section for one released version."""

from pathlib import Path
import re
import sys

CHANGELOG = Path(__file__).resolve().parents[1] / "CHANGELOG.md"
VERSION = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$")


def release_notes(version: str, changelog: str) -> str:
    """Return the changelog section headed by version, heading included."""
    heading = re.compile(rf"^## \[?{re.escape(version)}\]?(?:\s+-\s+.+)?$")
    lines = changelog.splitlines()
    start = next(
        (index for index, line in enumerate(lines) if heading.fullmatch(line)),
        None,
    )
    if start is None:
        raise ValueError(f"CHANGELOG.md has no section for {version}")
    end = next(
        (
            index
            for index in range(start + 1, len(lines))
            if lines[index].startswith("## ")
        ),
        len(lines),
    )
    return "\n".join(lines[start:end]).strip() + "\n"


def main(arguments: list[str]) -> int:
    if len(arguments) != 1:
        print("usage: release_notes.py VERSION", file=sys.stderr)
        return 2
    version = arguments[0].removeprefix("v")
    if VERSION.fullmatch(version) is None:
        print(f"{arguments[0]}: not a MAJOR.MINOR.PATCH version", file=sys.stderr)
        return 2
    try:
        notes = release_notes(version, CHANGELOG.read_text(encoding="utf-8"))
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    sys.stdout.write(notes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
