"""Registry of protocol-level waveform generators."""

from collections.abc import Callable, Mapping
from typing import Any

from ..model import IRFormatError, IRSignal
from .sony_sirc import encode_sony_sirc

Generator = Callable[..., IRSignal]
_GENERATORS: Mapping[str, Generator] = {"sony_sirc": encode_sony_sirc}


def list_protocols() -> list[str]:
    """List available generator identifiers in stable order."""
    return sorted(_GENERATORS)


def generate(protocol: str, params: dict[str, Any]) -> IRSignal:
    """Generate a signal with a registered protocol implementation."""
    generator = _GENERATORS.get(protocol)
    if generator is None:
        raise IRFormatError(f"unknown protocol: {protocol!r}")
    try:
        return generator(**params)
    except TypeError as error:
        raise IRFormatError(f"invalid parameters for {protocol!r}: {error}") from error
