"""Stable identifiers for physical infrared emitters."""

_ENTITY_STEM = "ir_emitter_"
_SEPARATOR_TABLE = str.maketrans("", "", ":_-")


def normalize_emitter_ref(value: str) -> str:
    """Normalize an IEEE address, stored key, or emitter entity ID."""
    candidate = str(value).strip().casefold().rsplit(".", maxsplit=1)[-1]
    return candidate.removeprefix(_ENTITY_STEM).translate(_SEPARATOR_TABLE)


def emitter_entity_id(emitter_id: str) -> str:
    """Return the default entity ID for an emitter storage key."""
    key = normalize_emitter_ref(emitter_id)
    grouped = "_".join(key[index : index + 2] for index in range(0, len(key), 2))
    return f"infrared.{_ENTITY_STEM}{grouped}"
