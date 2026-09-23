#!/usr/bin/env python3
"""Check repository hygiene without downloading a hook framework."""

import json
from pathlib import Path
import stat
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CONFLICT_MARKERS = (b"<<<<<<< ", b"=======", b">>>>>>> ")
GENERATED_TEXT_FILES = {
    Path("custom_components/imprint_refinery/www/imprint-refinery-card.js")
}


def _tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    paths = [ROOT / item.decode() for item in result.stdout.split(b"\0") if item]
    return [path for path in paths if path.is_file()]


def _text_errors(path: Path, content: bytes) -> list[str]:
    if b"\0" in content:
        return []
    relative = path.relative_to(ROOT)
    if relative in GENERATED_TEXT_FILES:
        return []
    errors: list[str] = []
    if content and not content.endswith(b"\n"):
        errors.append(f"{relative}: missing final newline")
    for number, line in enumerate(content.splitlines(), start=1):
        if line.endswith((b" ", b"\t")):
            errors.append(f"{relative}:{number}: trailing whitespace")
        if line.startswith(CONFLICT_MARKERS):
            errors.append(f"{relative}:{number}: merge-conflict marker")
    if path.suffix == ".json":
        try:
            json.loads(content)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            errors.append(f"{relative}: invalid JSON: {error}")
    if path.stat().st_mode & stat.S_IXUSR and not content.startswith(b"#!"):
        errors.append(f"{relative}: executable file has no shebang")
    return errors


def main() -> int:
    errors = [
        error
        for path in _tracked_files()
        for error in _text_errors(path, path.read_bytes())
    ]
    if errors:
        print("\n".join(errors))
        return 1
    print("Repository hygiene checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
