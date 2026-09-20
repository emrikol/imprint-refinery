"""Small, loss-aware Girr raw command importer and exporter."""

from dataclasses import dataclass
from xml.etree import ElementTree as ET

from defusedxml import ElementTree as DefusedET

from .model import IRFormatError, IRSignal
from .raw import decode_raw, encode_raw

GIRR_NAMESPACE = "http://www.harctoolbox.org/Girr"
GIRR_VERSION = "1.2"
_MAX_XML_CHARS = 2_000_000


@dataclass(frozen=True)
class GirrCommand:
    """One named raw command read from a Girr document."""

    name: str
    signal: IRSignal
    intro_timing_count: int
    repeat_timing_count: int
    ending_timing_count: int


def decode_girr(text: str) -> list[GirrCommand]:
    """Read every command containing a thin-format raw signal."""
    if len(text) > _MAX_XML_CHARS:
        raise IRFormatError("Girr document is too large")
    if "<!DOCTYPE" in text.upper() or "<!ENTITY" in text.upper():
        raise IRFormatError("Girr documents with DTDs or entities are not accepted")
    try:
        root = DefusedET.fromstring(text)
    except ET.ParseError as err:
        raise IRFormatError("Girr XML is invalid") from err

    command_elements = (
        [root]
        if _local_name(root.tag) == "command"
        else [
            element for element in root.iter() if _local_name(element.tag) == "command"
        ]
    )
    commands: list[GirrCommand] = []
    for index, command in enumerate(command_elements, start=1):
        raw = next(
            (child for child in command if _local_name(child.tag) == "raw"),
            None,
        )
        if raw is None:
            continue
        if any(
            list(sequence)
            for sequence in raw
            if _local_name(sequence.tag) in {"intro", "repeat", "ending"}
        ):
            raise IRFormatError("Girr fat-format raw timings are not yet supported")
        try:
            frequency = int(raw.attrib.get("frequency", "38000"))
        except ValueError as err:
            raise IRFormatError("Girr raw frequency must be an integer") from err
        parts: list[list[int]] = []
        for sequence_name in ("intro", "repeat", "ending"):
            sequence = next(
                (child for child in raw if _local_name(child.tag) == sequence_name),
                None,
            )
            if sequence is None or not (sequence.text or "").strip():
                parts.append([])
                continue
            parts.append(
                decode_raw(
                    sequence.text or "",
                    carrier_frequency=frequency,
                ).timings
            )
        timings = [value for part in parts for value in part]
        if not timings:
            continue
        commands.append(
            GirrCommand(
                name=command.attrib.get("name") or f"command_{index}",
                signal=IRSignal(
                    timings=timings,
                    carrier_frequency=frequency,
                ),
                intro_timing_count=len(parts[0]),
                repeat_timing_count=len(parts[1]),
                ending_timing_count=len(parts[2]),
            )
        )
    if not commands:
        raise IRFormatError("Girr document contains no raw commands")
    return commands


def encode_girr_command(
    signal: IRSignal,
    *,
    name: str,
    intro_timing_count: int | None = None,
    repeat_timing_count: int = 0,
    ending_timing_count: int = 0,
) -> str:
    """Write one raw command as a standalone Girr 1.2 document."""
    timings = list(signal.timings)
    if intro_timing_count is None:
        if len(timings) % 2:
            timings.append(timings[-1])
        intro_timing_count = len(timings)
    counts = (intro_timing_count, repeat_timing_count, ending_timing_count)
    if any(count < 0 for count in counts) or sum(counts) != len(timings):
        raise IRFormatError("Girr sequence lengths do not cover the signal")
    if any(count % 2 for count in counts if count):
        raise IRFormatError("Girr sequences must contain complete mark/space pairs")

    ET.register_namespace("", GIRR_NAMESPACE)
    command = ET.Element(
        f"{{{GIRR_NAMESPACE}}}command",
        {
            "name": name,
            "master": "raw",
            "girrVersion": GIRR_VERSION,
        },
    )
    raw = ET.SubElement(
        command,
        f"{{{GIRR_NAMESPACE}}}raw",
        {"frequency": str(signal.carrier_frequency)},
    )
    offset = 0
    for sequence_name, count in zip(
        ("intro", "repeat", "ending"),
        counts,
        strict=True,
    ):
        if not count:
            continue
        sequence = ET.SubElement(raw, f"{{{GIRR_NAMESPACE}}}{sequence_name}")
        sequence.text = encode_raw(
            IRSignal(
                timings=timings[offset : offset + count],
                carrier_frequency=signal.carrier_frequency,
            ),
            signed=True,
        )
        offset += count
    ET.indent(command, space="  ")
    return ET.tostring(command, encoding="unicode", xml_declaration=True)


def encode_girr_profile(
    commands: list[tuple[str, IRSignal]],
    *,
    name: str = "Imprint Refinery",
) -> str:
    """Write named raw commands as one portable Girr 1.2 command set."""
    if not commands:
        raise IRFormatError("Girr profile must contain at least one command")
    command_names = [command_name for command_name, _signal in commands]
    if len(set(command_names)) != len(command_names):
        raise IRFormatError("Girr command names must be unique")

    ET.register_namespace("", GIRR_NAMESPACE)
    command_set = ET.Element(
        f"{{{GIRR_NAMESPACE}}}commandSet",
        {"name": name, "girrVersion": GIRR_VERSION},
    )
    for command_name, signal in commands:
        command = DefusedET.fromstring(encode_girr_command(signal, name=command_name))
        command.attrib.pop("girrVersion", None)
        command_set.append(command)
    ET.indent(command_set, space="  ")
    return ET.tostring(command_set, encoding="unicode", xml_declaration=True)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]
