"""Build an importable Sony STR-DB840 command profile."""

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sys
from typing import Any

COMPONENT = (
    Path(__file__).resolve().parents[1] / "custom_components" / "imprint_refinery"
)
sys.path.insert(0, str(COMPONENT))

from ir_formats import generate_protocol, zosung_encode
from ir_formats.protocols.sony_sirc import DEFAULT_REPEATS, FRAME_PERIOD_US, MAX_REPEATS


@dataclass(frozen=True, slots=True)
class Command:
    key: str
    name: str
    value: int
    icon: str


COMMANDS = (
    Command("power_toggle", "Power", 21, "mdi:power"),
    Command("volume_up", "Volume Up", 18, "mdi:volume-plus"),
    Command("volume_down", "Volume Down", 19, "mdi:volume-minus"),
    Command("mute", "Mute", 20, "mdi:volume-mute"),
    Command("tuner", "Tuner / FM-AM", 33, "mdi:radio"),
    Command("video_1", "Video 1", 34, "mdi:video-input-component"),
    Command("video_2", "Video 2", 30, "mdi:video-input-component"),
    Command("video_3", "Video 3", 66, "mdi:video-input-component"),
    Command("cd", "CD", 37, "mdi:disc-player"),
    Command("md_tape", "MD/Tape", 105, "mdi:cassette"),
    Command("dvd_ld", "DVD/LD", 107, "mdi:disc"),
    Command("dvd", "DVD", 125, "mdi:disc"),
    Command("tv_sat", "TV/SAT", 106, "mdi:satellite-variant"),
)


def encode_command(
    command: Command, *, device: int, bits: int, repeats: int, verified: bool
) -> dict[str, Any]:
    """Encode one declarative command as a Hub registry record."""
    params = {
        "command": command.value,
        "device": device,
        "bits": bits,
        "extended": 0,
        "repeats": repeats,
        "frame_period_us": FRAME_PERIOD_US,
    }
    signal = generate_protocol("sony_sirc", params)
    return {
        "name": command.name,
        "icon": command.icon,
        "code": zosung_encode(signal),
        "format": "zosung_base64",
        "verified": verified,
        "source": {
            "type": "protocol",
            "protocol": "sony_sirc",
            "carrier_frequency": signal.carrier_frequency,
            "params": params,
        },
    }


def build_profile(
    *, device: int, bits: int, repeats: int, verified: bool, profile_name: str
) -> dict[str, Any]:
    """Return the complete portable device profile."""
    return {
        "_profile": "imprint_refinery",
        "version": 1,
        "name": profile_name,
        "type": "receiver",
        "commands": {
            command.key: encode_command(
                command,
                device=device,
                bits=bits,
                repeats=repeats,
                verified=verified,
            )
            for command in COMMANDS
        },
    }


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Generate a Sony STR-DB840 profile for Imprint Refinery."
    )
    result.add_argument("--device", type=int, default=16)
    result.add_argument("--bits", type=int, choices=(12, 15, 20), default=12)
    result.add_argument(
        "--repeats",
        type=int,
        choices=range(1, MAX_REPEATS + 1),
        default=DEFAULT_REPEATS,
        metavar=f"1..{MAX_REPEATS}",
    )
    result.add_argument("--verified", action="store_true")
    result.add_argument("--name", default="Sony STR-DB840")
    result.add_argument("--output", type=Path)
    return result


def main() -> int:
    args = parser().parse_args()
    options = {
        "device": args.device,
        "bits": args.bits,
        "repeats": args.repeats,
        "verified": args.verified,
        "profile_name": args.name,
    }
    profile = build_profile(**options)
    payload = json.dumps(profile, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        args.output.write_text(payload, encoding="utf-8")
        print(f"Wrote {args.output} ({len(profile['commands'])} commands)")
    else:
        print(payload, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
