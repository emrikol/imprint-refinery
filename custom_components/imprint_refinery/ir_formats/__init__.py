"""Reusable import, analysis, conversion, and generation API for IR signals."""

from .analysis import ANALYZER_VERSION, analyze_signal
from .conversion import (
    INPUT_FORMATS,
    OUTPUT_FORMATS,
    PROFILE_OUTPUT_FORMATS,
    convert_signal,
    decode_profile,
    decode_signal,
    encode_profile_format,
    encode_signal_format,
)
from .flipper import (
    FlipperCommand,
    decode_flipper,
    encode_flipper_command,
    encode_flipper_profile,
)
from .girr import GirrCommand, decode_girr, encode_girr_command, encode_girr_profile
from .lirc import LircCommand, decode_lirc, encode_lirc_command, encode_lirc_profile
from .model import DEFAULT_CARRIER_HZ, IRFormatError, IRSignal, signal_document
from .pronto import decode_pronto, encode_pronto
from .protocols import generate as generate_protocol, list_protocols
from .protocols.known import KNOWN_PROTOCOLS, encode_known_protocol
from .raw import decode_raw, encode_raw
from .recognition import (
    RECOGNIZER_VERSION,
    rebuild_recognized_signal,
    recognize_signal,
    recognizer_status,
)
from .zosung import decode as zosung_decode, encode as zosung_encode

__all__ = (
    "ANALYZER_VERSION",
    "DEFAULT_CARRIER_HZ",
    "INPUT_FORMATS",
    "KNOWN_PROTOCOLS",
    "OUTPUT_FORMATS",
    "PROFILE_OUTPUT_FORMATS",
    "RECOGNIZER_VERSION",
    "FlipperCommand",
    "GirrCommand",
    "IRFormatError",
    "IRSignal",
    "LircCommand",
    "analyze_signal",
    "convert_signal",
    "decode_flipper",
    "decode_girr",
    "decode_lirc",
    "decode_profile",
    "decode_pronto",
    "decode_raw",
    "decode_signal",
    "encode_flipper_command",
    "encode_flipper_profile",
    "encode_girr_command",
    "encode_girr_profile",
    "encode_known_protocol",
    "encode_lirc_command",
    "encode_lirc_profile",
    "encode_profile_format",
    "encode_pronto",
    "encode_raw",
    "encode_signal_format",
    "generate_protocol",
    "list_protocols",
    "rebuild_recognized_signal",
    "recognize_signal",
    "recognizer_status",
    "signal_document",
    "zosung_decode",
    "zosung_encode",
)
