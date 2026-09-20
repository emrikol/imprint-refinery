"""Transport-neutral signal formats and protocol-generation behavior."""

import sys
import types
import unittest
from unittest.mock import patch

import pytest

from custom_components.imprint_refinery import ir_formats
from custom_components.imprint_refinery.ir_formats import IRFormatError, IRSignal
from custom_components.imprint_refinery.ir_formats.protocols.sony_sirc import (
    FRAME_PERIOD_US,
    HEADER_MARK_US,
    UNIT_US,
    encode_sony_sirc,
)
from custom_components.imprint_refinery.ir_formats.zosung import _compress, _decompress


def test_zosung_round_trip_preserves_the_envelope() -> None:
    source = IRSignal([9_000, 4_500, 560, 560, 560, 1_690], 38_000)
    restored = ir_formats.zosung_decode(ir_formats.zosung_encode(source))
    assert restored == source


def test_fastlz_overlap_copy_is_supported() -> None:
    two_literals = bytes((1, ord("A"), ord("B")))
    four_byte_copy_at_distance_two = bytes(((2 << 5), 1))
    assert _decompress(two_literals + four_byte_copy_at_distance_two) == b"ABABAB"


def test_literal_compression_round_trips_binary_input() -> None:
    value = bytes(range(100))
    assert _decompress(_compress(value)) == value


def test_zosung_rejects_text_that_is_not_base64() -> None:
    with pytest.raises(IRFormatError):
        ir_formats.zosung_decode("this is not an encoded signal!")


@pytest.mark.parametrize("invalid", [[], [600, 0, 600], [-1, 700]])
def test_signal_envelope_requires_positive_durations(invalid) -> None:
    with pytest.raises(IRFormatError):
        IRSignal(invalid)


def test_model_retains_a_gap_larger_than_zosung_can_transport() -> None:
    envelope = IRSignal([600, 70_000])
    assert envelope.timings == [600, 70_000]
    with pytest.raises(IRFormatError):
        ir_formats.zosung_encode(envelope)


class GenericAnalysisTests(unittest.TestCase):
    def test_repeated_frames_are_reported_without_naming_a_protocol(self) -> None:
        frame = [9000, 4500, 560, 560, 560, 20000]
        signal = IRSignal(timings=frame + frame + frame)

        analysis = ir_formats.analyze_signal(signal)

        self.assertEqual(analysis["confidence"], "pattern_only")
        self.assertEqual(analysis["frame_count"], 3)
        self.assertEqual(analysis["unique_frame_count"], 1)
        self.assertEqual(analysis["repeated_frame_count"], 2)
        self.assertTrue(analysis["all_frames_equivalent"])
        self.assertEqual(analysis["protocol_candidates"], [])
        self.assertIn("repeated_pattern_unknown_protocol", analysis["warnings"])
        self.assertEqual(analysis["single_press_candidate"]["removed_frames"], 2)

    def test_jittered_repeats_group_but_raw_timings_remain_unchanged(self) -> None:
        first = [2400, 600, 1200, 600, 600, 18000]
        second = [2440, 620, 1160, 590, 630, 18200]
        signal = IRSignal(timings=first + second)

        analysis = ir_formats.analyze_signal(signal)

        self.assertEqual(analysis["unique_frame_count"], 1)
        self.assertEqual(signal.timings, first + second)
        self.assertNotEqual(
            analysis["fingerprints"]["exact"],
            analysis["fingerprints"]["normalized_50us"],
        )

    def test_non_repeating_signal_stays_unknown(self) -> None:
        signal = IRSignal(timings=[9000, 4500, 560, 560, 560, 1690])

        analysis = ir_formats.analyze_signal(signal)

        self.assertEqual(analysis["confidence"], "unknown")
        self.assertEqual(analysis["frame_count"], 1)
        self.assertEqual(analysis["repeated_frame_count"], 0)
        self.assertFalse(analysis["repeated_pattern"])

    def test_mixed_unknown_frames_do_not_invent_repeat_count(self) -> None:
        signal = IRSignal(timings=[1000, 500, 700, 12_000, 2000, 600, 900])

        analysis = ir_formats.analyze_signal(signal)

        self.assertEqual(analysis["frame_count"], 2)
        self.assertFalse(analysis["all_frames_equivalent"])
        self.assertEqual(analysis["protocol_candidates"], [])
        self.assertNotIn("repeated_frame_count", analysis)


class OfficialRecognitionAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module_name = "infrared_protocols.commands.example"
        self.original_module = sys.modules.get(self.module_name)
        module = types.ModuleType(self.module_name)

        class ExampleCommand:
            modulation = 38_000

            def __init__(self) -> None:
                self.address = 7
                self.command = 11
                self.repeat_count = 0

            @classmethod
            def from_raw_timings(cls, timings: list[int]):
                accepted = {
                    (9000, -4500, 560, -560),
                    (9000, -4500, 560, -20000),
                }
                return cls() if tuple(timings) in accepted else None

        module.ExampleCommand = ExampleCommand
        sys.modules[self.module_name] = module
        self.decoder = ir_formats.recognition.DecoderSpec(
            "Example", "example", "ExampleCommand"
        )
        self.decoders = patch.object(
            ir_formats.recognition, "_DECODERS", (self.decoder,)
        )
        self.version = patch.object(
            ir_formats.recognition.metadata,
            "version",
            return_value="9.9.9",
        )
        self.decoders.start()
        self.version.start()
        ir_formats.recognizer_status.cache_clear()
        ir_formats.recognition.clear_recognition_cache()

    def tearDown(self) -> None:
        ir_formats.recognizer_status.cache_clear()
        ir_formats.recognition.clear_recognition_cache()
        self.version.stop()
        self.decoders.stop()
        if self.original_module is None:
            sys.modules.pop(self.module_name, None)
        else:
            sys.modules[self.module_name] = self.original_module

    def test_recognized_fields_and_corpus_version_are_preserved(self) -> None:
        analysis = ir_formats.analyze_signal(
            IRSignal(timings=[9000, 4500, 560, 560], carrier_frequency=38_000),
            carrier_source="provided",
        )

        self.assertEqual(analysis["protocol"], "Example")
        self.assertEqual(analysis["confidence"], "verified")
        self.assertEqual(analysis["protocol_candidates"][0]["address"], 7)
        self.assertEqual(analysis["recognition"]["library_version"], "9.9.9")
        self.assertEqual(
            analysis["recognition"]["decoder_count"],
            len(ir_formats.recognition._BUILTIN_PROTOCOLS) + 1,
        )
        candidate = analysis["protocol_candidates"][0]
        self.assertEqual(candidate["evidence_class"], "verified")
        self.assertEqual(candidate["confidence_level"], "high")
        self.assertEqual(candidate["recognizer_sources"], ["infrared_protocols"])
        self.assertEqual(candidate["frame_roles"][0]["role"], "intro")
        self.assertFalse(candidate["reconstructable"])
        self.assertEqual(analysis["protocol_rebuilds"], [])

    def test_decoder_command_can_supply_its_canonical_rebuild(self) -> None:
        module = sys.modules[self.module_name]

        class EncodableCommand:
            modulation = 40_000
            address = 3
            command = 5

            @classmethod
            def from_raw_timings(cls, timings: list[int]):
                return cls() if timings == [2400, -610, 1210] else None

            def get_raw_timings(self) -> list[int]:
                return [2400, -600, 1200]

        module.EncodableCommand = EncodableCommand
        decoder = ir_formats.recognition.DecoderSpec(
            "Encodable",
            "example",
            "EncodableCommand",
        )
        source = IRSignal([2400, 610, 1210], 40_000)
        with patch.object(ir_formats.recognition, "_DECODERS", (decoder,)):
            ir_formats.recognition.clear_recognition_cache()
            analysis = ir_formats.analyze_signal(source, carrier_source="provided")
            candidate = analysis["protocol_candidates"][0]
            rebuilt, descriptor = ir_formats.rebuild_recognized_signal(
                source,
                candidate["rebuild_id"],
                carrier_source="provided",
            )

        self.assertTrue(candidate["reconstructable"])
        self.assertEqual(descriptor["protocol"], "Encodable")
        self.assertEqual(rebuilt, IRSignal([2400, 600, 1200], 40_000))
        self.assertEqual(source.timings, [2400, 610, 1210])

    def test_decoders_run_on_likely_frames_and_report_exact_repeat_ranges(self) -> None:
        frame = [9000, 4500, 560, 20000]

        analysis = ir_formats.analyze_signal(
            IRSignal(timings=frame + frame, carrier_frequency=38_000),
            carrier_source="provided",
        )

        candidate = analysis["protocol_candidates"][0]
        self.assertEqual(
            [item["role"] for item in candidate["frame_roles"]],
            ["intro", "repeat"],
        )
        self.assertEqual(candidate["consumed_timing_ranges"], [[0, 4], [4, 8]])
        self.assertEqual(candidate["residual_timing_ranges"], [])
        self.assertEqual(candidate["repeat_count"], 1)

    def test_all_credible_decoder_candidates_are_retained_as_ambiguous(self) -> None:
        module = sys.modules[self.module_name]

        class AlternativeCommand:
            modulation = 38_000

            def __init__(self) -> None:
                self.address = 8
                self.command = 12

            @classmethod
            def from_raw_timings(cls, timings: list[int]):
                return cls() if timings == [9000, -4500, 560, -560] else None

        module.AlternativeCommand = AlternativeCommand
        alternative = ir_formats.recognition.DecoderSpec(
            "Alternative", "example", "AlternativeCommand"
        )
        with patch.object(
            ir_formats.recognition,
            "_DECODERS",
            (self.decoder, alternative),
        ):
            ir_formats.recognition.clear_recognition_cache()
            analysis = ir_formats.analyze_signal(
                IRSignal([9000, 4500, 560, 560], 38_000),
                carrier_source="provided",
            )

        self.assertEqual(analysis["confidence"], "ambiguous")
        self.assertEqual(analysis["evidence_class"], "ambiguous")
        self.assertEqual(
            {item["protocol"] for item in analysis["protocol_candidates"]},
            {"Example", "Alternative"},
        )
        self.assertNotIn("single_press_candidate", analysis)
        self.assertEqual(analysis["repeat_count"], 0)
        self.assertEqual(analysis["repeated_frame_count"], 0)
        self.assertEqual(analysis["required_repeats"], 0)
        self.assertNotIn("ambiguous_repeat_semantics", analysis["warnings"])

    def test_equivalent_builtin_and_library_results_merge_provenance(self) -> None:
        module = sys.modules[self.module_name]

        class NECCommand:
            modulation = 38_000

            def __init__(self) -> None:
                self.address = 0x10
                self.command = 0x20

            @classmethod
            def from_raw_timings(cls, _timings: list[int]):
                return cls()

        module.NECCommand = NECCommand
        decoder = ir_formats.recognition.DecoderSpec("NEC", "example", "NECCommand")
        profile = """Filetype: IR signals file
Version: 1
#
name: Test
type: parsed
protocol: NEC
address: 10 00 00 00
command: 20 00 00 00
"""
        signal = ir_formats.decode_flipper(profile)[0].signal
        with patch.object(ir_formats.recognition, "_DECODERS", (decoder,)):
            ir_formats.recognition.clear_recognition_cache()
            result = ir_formats.recognize_signal(
                signal,
                carrier_source="provided",
            )

        nec = [
            item for item in result["protocol_candidates"] if item["protocol"] == "NEC"
        ]
        self.assertEqual(len(nec), 1)
        self.assertEqual(
            nec[0]["recognizer_sources"],
            ["builtin_adapter", "infrared_protocols"],
        )
        self.assertEqual(len(nec[0]["evidence"]), 4)

    def test_oversized_signal_skips_third_party_decoders(self) -> None:
        result = ir_formats.recognition.recognize_signal(
            IRSignal([1] * 4097, 38_000),
            carrier_source="provided",
        )

        self.assertEqual(result["protocol_candidates"], [])
        self.assertEqual(result["recognition_skipped"], "timing_limit_exceeded")


class PortableFormatTests(unittest.TestCase):
    def setUp(self) -> None:
        self.signal = IRSignal(
            timings=[9000, 4500, 560, 560, 560, 1690, 560, 40000],
            carrier_frequency=38000,
        )

    def test_signed_raw_roundtrip(self) -> None:
        encoded = ir_formats.encode_raw(self.signal)
        decoded = ir_formats.decode_raw(encoded, carrier_frequency=38000)
        self.assertEqual(decoded, self.signal)

    def test_signed_raw_rejects_bad_parity(self) -> None:
        with self.assertRaises(IRFormatError):
            ir_formats.decode_raw("+9000 +4500")

    def test_pronto_roundtrip_with_expected_rounding(self) -> None:
        encoded = ir_formats.encode_pronto(self.signal)
        decoded = ir_formats.decode_pronto(encoded)
        self.assertLess(abs(decoded.carrier_frequency - 38000), 200)
        self.assertEqual(len(decoded.timings), len(self.signal.timings))
        for expected, actual in zip(self.signal.timings, decoded.timings, strict=True):
            self.assertLessEqual(abs(expected - actual), 15)

    def test_pronto_pads_open_ended_capture_without_mutating_source(self) -> None:
        signal = IRSignal(
            timings=[9000, 4500, 560],
            carrier_frequency=38000,
        )

        encoded = ir_formats.encode_pronto(signal)
        decoded = ir_formats.decode_pronto(encoded)

        self.assertEqual(signal.timings, [9000, 4500, 560])
        self.assertEqual(len(decoded.timings), 4)
        self.assertLessEqual(abs(decoded.timings[-1] - signal.timings[-1]), 15)

    def test_girr_pads_open_ended_capture_without_mutating_source(self) -> None:
        signal = IRSignal(
            timings=[9000, 4500, 560],
            carrier_frequency=38000,
        )

        encoded = ir_formats.encode_girr_command(signal, name="Power")
        decoded = ir_formats.decode_girr(encoded)[0].signal

        self.assertEqual(signal.timings, [9000, 4500, 560])
        self.assertEqual(decoded.timings, [9000, 4500, 560, 560])

    def test_pronto_rejects_non_raw_type(self) -> None:
        with self.assertRaises(IRFormatError):
            ir_formats.decode_pronto("0100 006D 0001 0000 0010 0010")

    def test_girr_roundtrip_preserves_name_and_signal(self) -> None:
        encoded = ir_formats.encode_girr_command(self.signal, name="Power")
        decoded = ir_formats.decode_girr(encoded)
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0].name, "Power")
        self.assertEqual(decoded[0].signal, self.signal)
        self.assertEqual(decoded[0].intro_timing_count, len(self.signal.timings))

    def test_girr_rejects_doctype(self) -> None:
        with self.assertRaises(IRFormatError):
            ir_formats.decode_girr("<!DOCTYPE foo><command />")

    def test_lirc_roundtrip_preserves_trailing_gap(self) -> None:
        encoded = ir_formats.encode_lirc_command(
            self.signal,
            name="KEY_POWER",
            remote_name="Example",
        )
        decoded = ir_formats.decode_lirc(encoded)
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0].name, "KEY_POWER")
        self.assertEqual(decoded[0].signal, self.signal)

    def test_flipper_raw_roundtrip_preserves_name_and_signal(self) -> None:
        encoded = ir_formats.encode_flipper_command(self.signal, name="Power")
        decoded = ir_formats.decode_flipper(encoded)
        self.assertEqual(len(decoded), 1)
        self.assertEqual(decoded[0].name, "Power")
        self.assertEqual(decoded[0].signal, self.signal)
        self.assertAlmostEqual(decoded[0].duty_cycle, 0.33)

    def test_flipper_profile_preserves_every_raw_command(self) -> None:
        profile = """Filetype: IR signals file
Version: 1
#
name: Power
type: raw
frequency: 38000
duty_cycle: 0.33
data: 9000 4500 560 560
#
name: Mute
type: raw
frequency: 40000
duty_cycle: 0.25
data: 2400 600
"""
        decoded = ir_formats.decode_profile(profile, "flipper")
        self.assertEqual([item.name for item in decoded], ["Power", "Mute"])
        self.assertEqual(decoded[0].signal.timings, [9000, 4500, 560, 560])
        self.assertEqual(decoded[1].signal.carrier_frequency, 40000)

    def test_flipper_parsed_protocols_encode_to_canonical_timings(self) -> None:
        examples = {
            "NEC": (0x10, 0x20, 38000),
            "NECext": (0x87EE, 0xA05D, 38000),
            "NEC42": (0x123, 0x45, 38000),
            "NEC42ext": (0x123456, 0x789A, 38000),
            "Samsung32": (0x07, 0x02, 38000),
            "RC6": (0x10, 0x20, 36000),
            "RC5": (0x1F, 0x3F, 36000),
            "RC5X": (0x1F, 0x7F, 36000),
            "SIRC": (0x1F, 0x7F, 40000),
            "SIRC15": (0xFF, 0x7F, 40000),
            "SIRC20": (0x1FFF, 0x7F, 40000),
            "Kaseikyo": (0x3FFFFFF, 0x3FF, 38000),
            "RCA": (0x0F, 0xFF, 38000),
        }
        for protocol, (address, command, carrier) in examples.items():
            with self.subTest(protocol=protocol):
                address_hex = address.to_bytes(4, "little").hex(" ").upper()
                command_hex = command.to_bytes(4, "little").hex(" ").upper()
                profile = f"""Filetype: IR signals file
Version: 1
#
name: Power
type: parsed
protocol: {protocol}
address: {address_hex}
command: {command_hex}
"""
                decoded = ir_formats.decode_flipper(profile)[0]
                self.assertEqual(decoded.record_type, "parsed")
                self.assertEqual(decoded.protocol, protocol)
                self.assertEqual(decoded.address, address)
                self.assertEqual(decoded.command, command)
                self.assertEqual(decoded.signal.carrier_frequency, carrier)
                self.assertLessEqual(len(decoded.signal.timings), 1024)
                self.assertTrue(all(value > 0 for value in decoded.signal.timings))

        imported = ir_formats.decode_profile(profile, "flipper")[0]
        self.assertEqual(imported.metadata["record_type"], "parsed")
        self.assertEqual(imported.metadata["protocol"], "RCA")

    def test_flipper_unknown_parsed_protocol_is_explicit(self) -> None:
        profile = """Filetype: IR signals file
Version: 1
#
name: Power
type: parsed
protocol: Unsupported42
address: 00 00 00 00
command: 01 00 00 00
"""
        with self.assertRaisesRegex(IRFormatError, "Unsupported42"):
            ir_formats.decode_flipper(profile)

    def test_partial_flipper_import_preserves_unsupported_records(self) -> None:
        profile = """Filetype: IR signals file
Version: 1
#
name: Power
type: raw
frequency: 38000
duty_cycle: 0.33
data: 9000 4500 560 560
#
name: Vendor Button
type: parsed
protocol: Unsupported42
address: 00 00 00 00
command: 01 00 00 00
"""

        decoded, unsupported = ir_formats.conversion.decode_profile_partial(
            profile, "flipper"
        )

        self.assertEqual([item.name for item in decoded], ["Power"])
        self.assertEqual([item["name"] for item in unsupported], ["Vendor Button"])
        self.assertIn("protocol: Unsupported42", unsupported[0]["source"])
        self.assertIn("Unsupported42", unsupported[0]["error"])

    def test_single_signal_conversion_reports_embedded_carrier(self) -> None:
        pronto = ir_formats.encode_pronto(self.signal)
        decoded, raw = ir_formats.convert_signal(
            pronto,
            "pronto",
            "raw_signed",
        )
        self.assertEqual(decoded.carrier_source, "embedded")
        self.assertTrue(raw.startswith("+"))

    def test_conversion_loss_report_names_rounding_and_external_carrier(self) -> None:
        pronto = ir_formats.conversion.conversion_loss_report(self.signal, "pronto")
        zosung = ir_formats.conversion.conversion_loss_report(
            self.signal, "zosung_base64"
        )

        self.assertIn("timings_rounded", pronto["losses"])
        self.assertGreater(pronto["maximum_timing_error_us"], 0)
        self.assertTrue(zosung["timings_exact"])
        self.assertEqual(zosung["losses"], ["carrier_requires_external_metadata"])

    def test_conversion_loss_report_discloses_synthetic_trailing_space(self) -> None:
        signal = IRSignal(
            timings=[9000, 4500, 560],
            carrier_frequency=38000,
        )

        report = ir_formats.conversion.conversion_loss_report(signal, "pronto")

        self.assertIn("trailing_space_added", report["losses"])
        self.assertEqual(report["timing_count_before"], 3)
        self.assertEqual(report["timing_count_after"], 4)
        self.assertLessEqual(abs(report["trailing_space_added_us"] - 560), 15)
        self.assertEqual(report["trailing_space_source"], "matched_final_mark")

    def test_single_profile_conversion_keeps_format_specific_metadata(self) -> None:
        girr = ir_formats.encode_girr_command(self.signal, name="Power")
        decoded_girr = ir_formats.decode_signal(girr, "girr")
        self.assertEqual(decoded_girr.name, "Power")
        self.assertEqual(
            decoded_girr.metadata["intro_timing_count"], len(self.signal.timings)
        )

        flipper = ir_formats.encode_flipper_command(self.signal, name="Power")
        decoded = ir_formats.decode_signal(flipper, "flipper")
        self.assertEqual(decoded.metadata["record_type"], "raw")
        self.assertAlmostEqual(decoded.metadata["duty_cycle"], 0.33)

    def test_single_signal_conversion_refuses_multi_command_profile(self) -> None:
        one = ir_formats.encode_girr_command(self.signal, name="Power")
        two = one.replace(
            "<command ",
            '<remotes xmlns="http://www.harctoolbox.org/Girr"><command ',
            1,
        ).replace("</command>", "</command>" + one.split("?>", 1)[1] + "</remotes>", 1)
        with self.assertRaises(IRFormatError):
            ir_formats.decode_signal(two, "girr")

    def test_profile_decode_preserves_every_girr_command(self) -> None:
        profile = """<?xml version="1.0"?>
<remoteSet xmlns="http://www.harctoolbox.org/Girr">
  <command name="Power"><raw frequency="38000"><intro>+9000 -4500</intro></raw></command>
  <command name="Mute"><raw frequency="40000"><intro>+2400 -600</intro></raw></command>
</remoteSet>"""

        decoded = ir_formats.decode_profile(profile, "girr")

        self.assertEqual([item.name for item in decoded], ["Power", "Mute"])
        self.assertEqual(decoded[0].signal.timings, [9000, 4500])
        self.assertEqual(decoded[1].signal.carrier_frequency, 40000)

    def test_portable_profile_exports_preserve_names_carriers_and_timings(self) -> None:
        commands = [
            ("Power", self.signal),
            (
                "Mute",
                IRSignal(
                    timings=[2400, 600, 1200, 600, 600, 22000],
                    carrier_frequency=40000,
                ),
            ),
        ]

        for output_format in ir_formats.PROFILE_OUTPUT_FORMATS:
            with self.subTest(output_format=output_format):
                encoded = ir_formats.encode_profile_format(
                    commands,
                    output_format,
                    profile_name="Living Room",
                )
                decoded = ir_formats.decode_profile(encoded, output_format)
                self.assertEqual([item.name for item in decoded], ["Power", "Mute"])
                self.assertEqual(
                    [item.signal for item in decoded],
                    [signal for _name, signal in commands],
                )


def test_sirc_serializes_command_then_device_least_significant_bit_first() -> None:
    envelope = encode_sony_sirc(command=18, device=16, bits=12, repeats=1)
    assert len(envelope.timings) == 26
    assert envelope.timings[:2] == [HEADER_MARK_US, UNIT_US]
    assert envelope.carrier_frequency == 40_000
    marks = envelope.timings[2::2]
    observed = [int(duration == 2 * UNIT_US) for duration in marks]
    assert observed == [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]


def test_sirc_repetition_preserves_a_fixed_frame_period() -> None:
    single = encode_sony_sirc(command=18, device=16, bits=12, repeats=1)
    repeated = encode_sony_sirc(command=18, device=16, bits=12, repeats=3)
    width = len(single.timings)
    assert len(repeated.timings) == width * 3
    assert sum(single.timings) == FRAME_PERIOD_US
    assert sum(repeated.timings[:width]) == FRAME_PERIOD_US


def test_generated_sirc_can_be_carried_by_zosung() -> None:
    source = encode_sony_sirc(command=21, device=16, bits=12)
    restored = ir_formats.zosung_decode(ir_formats.zosung_encode(source))
    assert restored.timings == source.timings


@pytest.mark.parametrize(
    "parameters",
    [
        {"command": 200, "device": 16, "bits": 12},
        {"command": 18, "device": 16, "bits": 12, "repeats": 100_000},
    ],
)
def test_sirc_refuses_values_outside_its_declared_shape(parameters) -> None:
    with pytest.raises(IRFormatError):
        encode_sony_sirc(**parameters)


def test_protocol_registry_generates_sirc() -> None:
    assert "sony_sirc" in ir_formats.list_protocols()
    envelope = ir_formats.generate_protocol(
        "sony_sirc", {"command": 18, "device": 16, "bits": 12}
    )
    assert envelope.carrier_frequency == 40_000


if __name__ == "__main__":
    unittest.main()
