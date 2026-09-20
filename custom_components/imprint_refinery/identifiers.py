"""Human-readable stable identifiers."""

import re


def normalize_identifier(value: str) -> str:
    """Convert display text to a lowercase underscore identifier."""
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def unique_identifier(
    value: str,
    used: set[str],
    *,
    fallback: str = "command",
) -> str:
    """Reserve and return a normalized identifier with a numeric suffix if needed."""
    base = normalize_identifier(value) or fallback
    candidate = base
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate
