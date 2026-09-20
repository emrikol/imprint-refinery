"""Read the bundled, versioned offline IR catalog."""

from collections.abc import Iterable
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import re
from typing import Any
import unicodedata
import zipfile

DEFAULT_CATALOG_PATH = Path(__file__).with_name("catalog-v1.ircat")


class CatalogArtifactError(RuntimeError):
    """Raised when a bundled catalog is missing or invalid."""


def normalize_search(value: str) -> str:
    """Match the builder's punctuation- and accent-insensitive normalization."""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(char for char in value if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


class OfflineCatalog:
    """Lazy reader for the catalog index and original Flipper profiles."""

    def __init__(
        self, path: Path = DEFAULT_CATALOG_PATH, *, verify: bool = True
    ) -> None:
        self.path = path
        if verify:
            self._verify_checksum()
        try:
            with zipfile.ZipFile(self.path) as archive:
                self._manifest = json.loads(archive.read("manifest.json"))
        except (OSError, KeyError, ValueError, zipfile.BadZipFile) as err:
            raise CatalogArtifactError(f"cannot read offline catalog: {err}") from err
        if self._manifest.get("schema_version") != 1:
            raise CatalogArtifactError("unsupported offline catalog schema")
        self._profiles = {
            item["profile_id"]: item for item in self._manifest.get("profiles", [])
        }
        self._matches: dict[str, Any] | None = None

    def _verify_checksum(self) -> None:
        checksum_path = self.path.with_suffix(self.path.suffix + ".sha256")
        try:
            expected = checksum_path.read_text(encoding="ascii").split()[0]
            actual = hashlib.sha256(self.path.read_bytes()).hexdigest()
        except (OSError, IndexError) as err:
            raise CatalogArtifactError(f"cannot verify offline catalog: {err}") from err
        if expected != actual:
            raise CatalogArtifactError("offline catalog checksum does not match")

    def status(self) -> dict[str, Any]:
        """Return immutable artifact and source metadata."""
        return {
            "installed": True,
            "version": self._manifest["catalog_version"],
            "counts": dict(self._manifest["counts"]),
            "source": dict(self._manifest["source"]),
        }

    def search(
        self,
        *,
        category: str = "",
        brand: str = "",
        model: str = "",
        query: str = "",
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Search normalized local metadata without opening profile documents."""
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be a positive integer")
        category_key = normalize_search(category)
        if category_key == "television":
            category_key = "tv"
        brand_key = normalize_search(brand)
        model_key = normalize_search(model)
        query_key = normalize_search(query)
        matches = []
        for profile in self._profiles.values():
            normalized = profile["normalized"]
            if category_key and category_key != normalized["category"]:
                continue
            if brand_key and brand_key not in normalized["brand"]:
                continue
            model_haystack = " ".join(
                (normalized["model"], normalized["remote_model"], normalized["aliases"])
            )
            if model_key and model_key not in model_haystack:
                continue
            haystack = " ".join(
                (
                    normalized["category"],
                    normalized["brand"],
                    model_haystack,
                    normalized["commands"],
                )
            )
            if query_key and query_key not in haystack:
                continue
            matches.append(
                {
                    key: value
                    for key, value in profile.items()
                    if key not in {"entry", "normalized"}
                }
            )
        matches.sort(
            key=lambda item: (
                item["brand"].casefold(),
                item["model"].casefold(),
                item["profile_id"],
            )
        )
        return matches[:limit]

    def get_profile(self, profile_id: str) -> dict[str, Any]:
        """Return indexed metadata plus the exact upstream Flipper document."""
        try:
            summary = self._profiles[profile_id]
        except KeyError as err:
            raise KeyError(profile_id) from err
        entry = summary["entry"]
        if not entry.startswith("profiles/") or ".." in entry:
            raise CatalogArtifactError("catalog profile entry is unsafe")
        try:
            with zipfile.ZipFile(self.path) as archive:
                document = archive.read(entry).decode("utf-8")
        except (OSError, UnicodeError, KeyError, zipfile.BadZipFile) as err:
            raise CatalogArtifactError(f"cannot read catalog profile: {err}") from err
        return {
            **{
                key: value
                for key, value in summary.items()
                if key not in {"entry", "normalized"}
            },
            "format": "flipper",
            "document": document,
            "catalog_version": self._manifest["catalog_version"],
            "source": dict(self._manifest["source"]),
        }

    def match(
        self,
        *,
        normalized_50us: str | None = None,
        parsed: Iterable[tuple[str, int, int]] = (),
        limit: int = 25,
    ) -> dict[str, Any]:
        """Look up exact raw fingerprints and parsed protocol fields."""
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be a positive integer")
        index = self._load_matches()
        requested: list[tuple[str, str, dict[str, Any]]] = []
        if normalized_50us:
            requested.append(
                (
                    "normalized_50us",
                    normalized_50us.lower(),
                    {
                        "type": "normalized_50us",
                        "fingerprint": normalized_50us.lower(),
                    },
                )
            )
        for protocol, address, command in parsed:
            key = f"{protocol.strip().casefold()}|{address:x}|{command:x}"
            requested.append(
                (
                    "parsed",
                    key,
                    {
                        "type": "protocol_address_command",
                        "protocol": protocol,
                        "address": address,
                        "command": command,
                    },
                )
            )

        profile_ids = index["profiles"]
        seen: set[tuple[int, int]] = set()
        matches: list[dict[str, Any]] = []
        total = 0
        for section, key, basis in requested:
            for profile_index, record_index, name in index[section].get(key, []):
                identity = (profile_index, record_index)
                if identity in seen:
                    continue
                seen.add(identity)
                total += 1
                if len(matches) >= limit:
                    continue
                profile_id = profile_ids[profile_index]
                profile = self._profiles[profile_id]
                matches.append(
                    {
                        "profile": {
                            key: value
                            for key, value in profile.items()
                            if key not in {"entry", "normalized"}
                        },
                        "command": {
                            "name": name,
                            "record_index": record_index,
                            "record_type": "raw"
                            if section == "normalized_50us"
                            else "parsed",
                        },
                        "match_basis": dict(basis),
                    }
                )
        return {
            "match_count": total,
            "truncated": total > len(matches),
            "matches": matches,
        }

    def _load_matches(self) -> dict[str, Any]:
        """Load the compact match index only when matching is requested."""
        if self._matches is not None:
            return self._matches
        try:
            with zipfile.ZipFile(self.path) as archive:
                matches = json.loads(archive.read("matches.json"))
        except (OSError, KeyError, ValueError, zipfile.BadZipFile) as err:
            raise CatalogArtifactError(
                f"cannot read catalog match index: {err}"
            ) from err
        if matches.get("schema_version") != 1:
            raise CatalogArtifactError("unsupported catalog match index schema")
        self._matches = matches
        return matches


@lru_cache(maxsize=1)
def bundled_catalog() -> OfflineCatalog:
    """Open and cache the shipped artifact."""
    return OfflineCatalog()
