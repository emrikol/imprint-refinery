#!/usr/bin/env python3
"""Build the pinned, offline Flipper-IRDB catalog.

The build verifies one immutable source snapshot, indexes profile labels,
reports malformed records, and stores original ``.ir`` files in a deterministic
ZIP artifact. It has no network dependency.
"""

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any
import unicodedata
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE_LOCK = ROOT / "catalog-sources.json"
DEFAULT_ARTIFACT = ROOT / "custom_components" / "imprint_refinery" / "catalog-v1.ircat"
DEFAULT_REPORT = ROOT / "catalog" / "coverage.json"
ZIP_TIME = (1980, 1, 1, 0, 0, 0)
FINGERPRINT_QUANTUM_US = 50

CATEGORIES = {
    "acs": "climate",
    "air purifiers": "air_purifier",
    "audio and video receivers": "receiver",
    "blu ray": "media_player",
    "cable boxes": "set_top_box",
    "cd players": "media_player",
    "digital signs": "display",
    "dvd players": "media_player",
    "fans": "fan",
    "fireplaces": "fireplace",
    "heaters": "heater",
    "humidifiers": "humidifier",
    "led lighting": "light",
    "monitors": "display",
    "projectors": "projector",
    "soundbars": "audio",
    "speakers": "audio",
    "streaming devices": "media_player",
    "tvs": "tv",
    "universal tv remotes": "tv",
    "vcr": "media_player",
}


def normalize(value: str) -> str:
    """Normalize human labels for punctuation- and spacing-insensitive search."""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def display(value: str) -> str:
    """Turn source path components into readable labels without hiding originals."""
    return re.sub(r"\s+", " ", value.replace("_", " ").strip()) or "Unknown"


def source_tree_hash(root: Path, license_path: Path) -> str:
    """Hash every ingested byte and relative path for snapshot verification."""
    digest = hashlib.sha256()
    paths = sorted(
        [*root.rglob("*.ir"), license_path],
        key=lambda path: path.relative_to(root).as_posix(),
    )
    for path in paths:
        relative = path.relative_to(root).as_posix().encode()
        body = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(body).to_bytes(8, "big"))
        digest.update(body)
    return digest.hexdigest()


def verify_source(root: Path, source: dict[str, Any]) -> None:
    """Accept the exact Git checkout or a byte-identical local snapshot."""
    license_path = root / source["license_file"]
    if not license_path.is_file():
        raise SystemExit(f"missing source license: {license_path}")
    license_hash = hashlib.sha256(license_path.read_bytes()).hexdigest()
    if license_hash != source["license_sha256"]:
        raise SystemExit("source license hash does not match catalog-sources.json")
    if source_tree_hash(root, license_path) != source["tree_sha256"]:
        raise SystemExit("source tree hash does not match catalog-sources.json")
    if (root / ".git").exists():
        revision = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if revision != source["revision"]:
            raise SystemExit(
                f"source revision is {revision}, expected {source['revision']}"
            )


def parse_flipper(text: str) -> tuple[dict[str, str], list[dict[str, str]]]:
    """Parse structure for validation and counts; preserve source verbatim."""
    header: dict[str, str] = {}
    records: list[dict[str, str]] = []
    fields: dict[str, str] = {}
    for line_number, source_line in enumerate(text.splitlines(), start=1):
        line = source_line.strip()
        if not line:
            continue
        if line == "#":
            if fields:
                records.append(fields)
                fields = {}
            continue
        if line.startswith("#"):
            continue
        if ":" not in line:
            raise ValueError(f"line {line_number}: missing field separator")
        key, value = (part.strip() for part in line.split(":", 1))
        target = header if key in {"Filetype", "Version"} and not fields else fields
        key = key if target is header else key.lower()
        if not key or key in target:
            raise ValueError(f"line {line_number}: empty or repeated field")
        target[key] = value
    if fields:
        records.append(fields)
    if header.get("Filetype") not in {"IR signals file", "IR library file"}:
        raise ValueError("unsupported or missing Filetype")
    if header.get("Version") != "1":
        raise ValueError("unsupported or missing Version")
    if not records:
        raise ValueError("file contains no commands")
    for index, record in enumerate(records, start=1):
        if not record.get("name"):
            raise ValueError(f"record {index}: missing name")
        record_type = record.get("type")
        required = (
            ("frequency", "duty_cycle", "data")
            if record_type == "raw"
            else ("protocol", "address", "command")
            if record_type == "parsed"
            else ()
        )
        if not required:
            raise ValueError(f"record {index}: unsupported or missing type")
        for field in required:
            if not record.get(field):
                raise ValueError(
                    f"record {index}: {record_type} command missing {field}"
                )
    return header, records


def profile_labels(relative: Path) -> tuple[str, str, str]:
    """Derive searchable labels while retaining the source path in the index."""
    parts = relative.parts
    if parts[0] == "_Converted_" and len(parts) > 3:
        category_raw, brand_raw = parts[1], parts[2]
    else:
        category_raw = parts[0]
        brand_raw = parts[1] if len(parts) > 2 else "Unknown"
    category = CATEGORIES.get(
        normalize(category_raw), normalize(category_raw).replace(" ", "_")
    )
    return category, display(brand_raw), display(relative.stem)


def json_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def raw_fingerprint(record: dict[str, str]) -> str | None:
    """Return the runtime-compatible normalized fingerprint for a raw record."""
    try:
        frequency = int(record["frequency"])
        timings = [int(value) for value in record["data"].split()]
    except KeyError, ValueError:
        return None
    if frequency <= 0 or not timings or len(timings) > 1024:
        return None
    if any(value <= 0 for value in timings):
        return None
    normalized = [
        max(
            FINGERPRINT_QUANTUM_US,
            round(value / FINGERPRINT_QUANTUM_US) * FINGERPRINT_QUANTUM_US,
        )
        for value in timings
    ]
    body = json.dumps([frequency, normalized], separators=(",", ":")).encode()
    return hashlib.sha256(body).hexdigest()


def parsed_key(record: dict[str, str]) -> str | None:
    """Return an exact protocol/address/command key for a parsed record."""
    try:
        address_bytes = record["address"].split()
        command_bytes = record["command"].split()
        if len(address_bytes) != 4 or len(command_bytes) != 4:
            return None
        address = int.from_bytes(
            bytes(int(value, 16) for value in address_bytes), "little"
        )
        command = int.from_bytes(
            bytes(int(value, 16) for value in command_bytes), "little"
        )
    except KeyError, ValueError:
        return None
    protocol = record.get("protocol", "").strip().casefold()
    if not protocol:
        return None
    return f"{protocol}|{address:x}|{command:x}"


def write_entry(archive: zipfile.ZipFile, name: str, body: bytes) -> None:
    info = zipfile.ZipInfo(name, ZIP_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    archive.writestr(info, body, compresslevel=9)


def build(
    source_root: Path, artifact: Path, report_path: Path, lock: dict[str, Any]
) -> dict[str, Any]:
    source = lock["sources"][0]
    verify_source(source_root, source)
    profiles: list[dict[str, Any]] = []
    quarantine: list[dict[str, str]] = []
    entries: dict[str, bytes] = {}
    formats: Counter[str] = Counter()
    raw_matches: dict[str, list[tuple[str, int, str]]] = defaultdict(list)
    parsed_matches: dict[str, list[tuple[str, int, str]]] = defaultdict(list)

    for path in sorted(
        source_root.rglob("*.ir"),
        key=lambda item: item.relative_to(source_root).as_posix(),
    ):
        relative = path.relative_to(source_root)
        source_path = relative.as_posix()
        try:
            text = path.read_text(encoding="utf-8")
            _, records = parse_flipper(text)
        except (OSError, UnicodeError, ValueError) as err:
            quarantine.append({"path": source_path, "reason": str(err)})
            continue
        category, brand, model = profile_labels(relative)
        profile_id = f"flipper_irdb:{source_path[:-3]}"
        entry = f"profiles/{hashlib.sha256(profile_id.encode()).hexdigest()}.ir"
        command_names = [record["name"] for record in records]
        record_formats = Counter(record["type"] for record in records)
        formats.update(record_formats)
        for record_index, record in enumerate(records):
            key = (
                raw_fingerprint(record)
                if record["type"] == "raw"
                else parsed_key(record)
            )
            if key is not None:
                target = raw_matches if record["type"] == "raw" else parsed_matches
                target[key].append((profile_id, record_index, record["name"]))
        profiles.append(
            {
                "profile_id": profile_id,
                "name": f"{brand} {model}",
                "category": category,
                "brand": brand,
                "model": model,
                "remote_model": model,
                "aliases": [display(relative.stem), display(relative.parent.name)],
                "normalized": {
                    "category": normalize(category),
                    "brand": normalize(brand),
                    "model": normalize(model),
                    "remote_model": normalize(model),
                    "aliases": normalize(f"{relative.stem} {relative.parent.name}"),
                    "commands": normalize(" ".join(command_names)),
                },
                "command_count": len(records),
                "formats": dict(sorted(record_formats.items())),
                "source_path": source_path,
                "entry": entry,
            }
        )
        entries[entry] = text.encode("utf-8")

    profiles.sort(key=lambda item: item["profile_id"])
    quarantine.sort(key=lambda item: item["path"])
    manifest = {
        "schema_version": 1,
        "catalog_version": lock["catalog_version"],
        "source": source,
        "counts": {
            "profiles": len(profiles),
            "commands": sum(item["command_count"] for item in profiles),
            "quarantined_files": len(quarantine),
            **{f"{key}_commands": value for key, value in sorted(formats.items())},
        },
        "profiles": profiles,
    }
    profile_indexes = {
        profile["profile_id"]: index for index, profile in enumerate(profiles)
    }
    matches = {
        "schema_version": 1,
        "profiles": [profile["profile_id"] for profile in profiles],
        "normalized_50us": {
            key: [
                [profile_indexes[profile_id], record_index, name]
                for profile_id, record_index, name in references
            ]
            for key, references in sorted(raw_matches.items())
        },
        "parsed": {
            key: [
                [profile_indexes[profile_id], record_index, name]
                for profile_id, record_index, name in references
            ]
            for key, references in sorted(parsed_matches.items())
        },
    }
    entries["manifest.json"] = json_bytes(manifest)
    entries["matches.json"] = json_bytes(matches)
    entries["quarantine.json"] = json_bytes(quarantine)
    entries["LICENSES/flipper_irdb.txt"] = (
        source_root / source["license_file"]
    ).read_bytes()

    artifact.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(
        artifact, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
    ) as archive:
        for name in sorted(entries):
            write_entry(archive, name, entries[name])
    artifact_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
    artifact.with_suffix(artifact.suffix + ".sha256").write_text(
        f"{artifact_hash}  {artifact.name}\n",
        encoding="ascii",
    )
    report = {
        "catalog_version": lock["catalog_version"],
        "artifact": artifact.name,
        "artifact_sha256": artifact_hash,
        "artifact_bytes": artifact.stat().st_size,
        "source": source,
        "counts": manifest["counts"],
        "quarantine": quarantine,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    counts = report["counts"]
    report_path.with_name("COVERAGE.md").write_text(
        "\n".join(
            (
                "# Offline catalog coverage",
                "",
                f"Catalog version: `{report['catalog_version']}`  ",
                f"Artifact SHA-256: `{report['artifact_sha256']}`  ",
                f"Artifact size: {report['artifact_bytes']:,} bytes",
                "",
                "| Metric | Count |",
                "| --- | ---: |",
                f"| Profiles | {counts['profiles']:,} |",
                f"| Commands | {counts['commands']:,} |",
                f"| Parsed commands | {counts.get('parsed_commands', 0):,} |",
                f"| Raw commands | {counts.get('raw_commands', 0):,} |",
                f"| Quarantined files | {counts['quarantined_files']:,} |",
                "",
                "Malformed files and their reasons are retained in `coverage.json` and `quarantine.json` inside the artifact.",
                "",
            )
        ),
        encoding="utf-8",
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-root", type=Path, default=ROOT / ".catalog-work" / "Flipper-IRDB"
    )
    parser.add_argument("--source-lock", type=Path, default=SOURCE_LOCK)
    parser.add_argument("--output", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    lock = json.loads(args.source_lock.read_text(encoding="utf-8"))
    report = build(args.source_root, args.output, args.report, lock)
    print(json.dumps(report["counts"], indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
