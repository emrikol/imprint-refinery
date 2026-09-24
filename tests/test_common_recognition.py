"""Focused vectors for the dependency-free common protocol recognizer."""

import unittest

from custom_components.imprint_refinery import ir_formats
from custom_components.imprint_refinery.ir_formats.analysis import (
    _apply_binary_consensus,
)


def _parsed_signal(
    protocol: str = "NEC",
    address: int = 0x10,
    command: int = 0x20,
) -> ir_formats.IRSignal:
    profile = "\n".join(
        (
            "Filetype: IR signals file",
            "Version: 1",
            "#",
            "name: Test",
            "type: parsed",
            f"protocol: {protocol}",
            f"address: {address.to_bytes(4, 'little').hex(' ')}",
            f"command: {command.to_bytes(4, 'little').hex(' ')}",
        )
    )
    return ir_formats.decode_flipper(profile)[0].signal


class CommonRecognitionTests(unittest.TestCase):
    def test_equivalent_decoder_rebuilds_collapse_to_one_alignment(self) -> None:
        analysis = ir_formats.analyze_signal(
            _parsed_signal("NEC", 0, 94),
            carrier_source="assumed",
        )

        candidates = analysis["protocol_candidates"]
        self.assertGreaterEqual(len(candidates), 3)
        self.assertEqual(len(analysis["protocol_rebuilds"]), 1)
        self.assertEqual(analysis["protocol_rebuilds"][0]["protocol"], "NEC")
        self.assertEqual(analysis["protocol_rebuilds"][0]["address"], 0)
        self.assertEqual(
            analysis["protocol_rebuilds"][0]["equivalent_interpretation_count"],
            len(candidates),
        )
        self.assertEqual(
            {candidate.get("rebuild_id") for candidate in candidates},
            {analysis["protocol_rebuilds"][0]["id"]},
        )

    def test_nec_exposes_binary_payload_in_transmission_order(self) -> None:
        signal = _parsed_signal(address=0x10, command=0x20)

        analysis = ir_formats.analyze_signal(signal, carrier_source="provided")
        candidate = next(
            item
            for item in analysis["protocol_candidates"]
            if item["protocol"] == "NEC"
        )

        expected = "00001000111101110000010011111011"
        self.assertEqual(candidate["binary_payload"]["value"], expected)
        self.assertEqual(candidate["binary_payload"]["bit_order"], "lsb_first")
        self.assertEqual(candidate["binary_payload"]["encoding"], "pulse_distance")
        self.assertEqual(analysis["binary_payload"]["value"], expected)
        self.assertEqual(
            analysis["binary_payload"]["evidence"],
            "distance_width_model_and_recognized_protocol",
        )
        self.assertEqual(analysis["binary_decoders"]["selected_mode"], "pulse_distance")
        self.assertEqual(analysis["binary_decoders"]["auto"]["status"], "matched")
        self.assertEqual(
            analysis["binary_decoders"]["auto"]["agreement_count"],
            1 + len(analysis["binary_decoders"]["protocol_results"]),
        )
        self.assertEqual(
            analysis["binary_decoders"]["auto"]["evidence_family_count"], 2
        )
        self.assertGreaterEqual(
            analysis["binary_decoders"]["auto"]["confidence_score"], 95
        )

    def test_unknown_pulse_distance_signal_gets_structural_binary_payload(self) -> None:
        bits = "01011010"
        timings = [3000, 1500]
        for bit in bits:
            timings.extend((400, 1200 if bit == "1" else 400))
        timings.append(400)

        analysis = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))

        self.assertEqual(analysis["protocol_candidates"], [])
        self.assertEqual(analysis["binary_payload"]["value"], bits)
        self.assertEqual(analysis["binary_payload"]["bit_order"], "unknown")
        self.assertEqual(analysis["binary_payload"]["encoding"], "pulse_distance")
        self.assertEqual(analysis["binary_payload"]["evidence"], "distance_width_model")
        self.assertEqual(analysis["binary_payload"]["header_timings"], [3000, 1500])
        results = {
            item["mode"]: item for item in analysis["binary_decoders"]["results"]
        }
        self.assertEqual(results["pulse_distance"]["status"], "matched")
        self.assertEqual(results["pulse_width"]["status"], "rejected")
        self.assertEqual(analysis["binary_decoders"]["auto"]["agreement_count"], 1)
        self.assertLess(analysis["binary_decoders"]["auto"]["confidence_score"], 75)

    def test_unknown_pulse_width_signal_gets_structural_binary_payload(self) -> None:
        bits = "10100110"
        timings = [3000, 1000]
        for index, bit in enumerate(bits):
            timings.append(900 if bit == "1" else 300)
            if index < len(bits) - 1:
                timings.append(500)

        payload = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))[
            "binary_payload"
        ]

        self.assertEqual(payload["value"], bits)
        self.assertEqual(payload["encoding"], "pulse_width")
        self.assertEqual(payload["symbol"], "mark_length")

    def test_distance_width_signal_uses_space_symbols_like_universal_decoders(
        self,
    ) -> None:
        bits = "10110010"
        timings = [3000, 1500]
        for bit in bits:
            timings.extend(
                (
                    800 if bit == "0" else 400,
                    1200 if bit == "1" else 400,
                )
            )
        timings.append(400)

        payload = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))[
            "binary_payload"
        ]

        self.assertEqual(payload["value"], bits)
        self.assertEqual(payload["encoding"], "pulse_distance_width")
        self.assertEqual(payload["symbol"], "space_length")

    def test_multilevel_timing_signal_is_not_claimed_as_binary(self) -> None:
        spaces = [400, 800, 1200, 400, 800, 1200, 400, 800]
        timings = [3000, 1500]
        for space in spaces:
            timings.extend((400, space))
        timings.append(400)

        analysis = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))

        self.assertNotIn("binary_payload", analysis)
        self.assertTrue(
            all(
                result["status"] == "rejected"
                for result in analysis["binary_decoders"]["results"]
            )
        )

    def test_auto_withholds_bitstream_when_decoders_disagree(self) -> None:
        decoders = {
            "selected_mode": "pulse_distance",
            "results": [
                {
                    "mode": "pulse_distance",
                    "status": "matched",
                    "fit": 0.99,
                    "payload": {"value": "0101", "bit_count": 4},
                }
            ],
        }
        candidates = [
            {
                "protocol": "Synthetic",
                "binary_payload": {"value": "0111", "bit_count": 4},
            }
        ]

        payload = _apply_binary_consensus(decoders, candidates)

        self.assertIsNone(payload)
        self.assertEqual(decoders["auto"]["status"], "ambiguous")
        self.assertEqual(decoders["auto"]["confidence_score"], 0)
        self.assertEqual(decoders["auto"]["method_count"], 2)

    def test_auto_withholds_when_named_protocol_decoders_disagree(self) -> None:
        decoders = {
            "selected_mode": "pulse_distance",
            "results": [
                {
                    "mode": "pulse_distance",
                    "status": "matched",
                    "fit": 0.99,
                    "payload": {"value": "0101", "bit_count": 4},
                }
            ],
        }
        candidates = [
            {
                "protocol": "Candidate A",
                "binary_payload": {"value": "0101", "bit_count": 4},
            },
            {
                "protocol": "Candidate B",
                "binary_payload": {"value": "0111", "bit_count": 4},
            },
        ]

        payload = _apply_binary_consensus(decoders, candidates)

        self.assertIsNone(payload)
        self.assertEqual(decoders["auto"]["status"], "ambiguous")
        self.assertEqual(decoders["auto"]["method_count"], 3)
        self.assertCountEqual(decoders["auto"]["competing_values"], ["0101", "0111"])

    def test_auto_withholds_when_waveform_models_disagree(self) -> None:
        decoders = {
            "selected_mode": "pulse_distance",
            "results": [
                {
                    "mode": "pulse_distance",
                    "status": "matched",
                    "fit": 0.99,
                    "payload": {"value": "0101", "bit_count": 4},
                },
                {
                    "mode": "pulse_width",
                    "status": "matched",
                    "fit": 0.98,
                    "payload": {"value": "0111", "bit_count": 4},
                },
            ],
        }

        payload = _apply_binary_consensus(decoders, [])

        self.assertIsNone(payload)
        self.assertEqual(decoders["auto"]["status"], "ambiguous")
        self.assertEqual(decoders["auto"]["method_count"], 2)

    def test_all_8_bit_pulse_distance_values_survive_timing_jitter(self) -> None:
        # All-zero/all-one captures expose only one duration class, so their
        # bit polarity is unknowable without a protocol definition.
        for value in range(1, 255):
            bits = f"{value:08b}"
            timings = [3000, 1500]
            for index, bit in enumerate(bits):
                jitter = (-20, 0, 20)[index % 3]
                timings.extend((400 + jitter, (1200 if bit == "1" else 400) - jitter))
            timings.append(400)

            analysis = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))

            self.assertEqual(analysis["binary_payload"]["value"], bits)
            self.assertEqual(
                analysis["binary_decoders"]["selected_mode"], "pulse_distance"
            )

    def test_all_8_bit_pulse_width_values_survive_timing_jitter(self) -> None:
        # All-zero/all-one captures expose only one duration class, so their
        # bit polarity is unknowable without a protocol definition.
        for value in range(1, 255):
            bits = f"{value:08b}"
            timings = [3000, 1000]
            for index, bit in enumerate(bits):
                jitter = (-15, 0, 15)[index % 3]
                timings.append((900 if bit == "1" else 300) + jitter)
                if index < len(bits) - 1:
                    timings.append(500 - jitter)

            analysis = ir_formats.analyze_signal(ir_formats.IRSignal(timings=timings))

            self.assertEqual(analysis["binary_payload"]["value"], bits)
            self.assertEqual(
                analysis["binary_decoders"]["selected_mode"], "pulse_width"
            )

    def test_all_parsed_flipper_protocols_round_trip_with_jitter(self) -> None:
        examples = {
            "NEC": (0x10, 0x20),
            "NECext": (0x87EE, 0xA05D),
            "NEC42": (0x123, 0x45),
            "NEC42ext": (0x123456, 0x789A),
            "Samsung32": (0x07, 0x02),
            "RC6": (0x10, 0x20),
            "RC5": (0x1F, 0x3F),
            "RC5X": (0x1F, 0x7F),
            "SIRC": (0x1F, 0x7F),
            "SIRC15": (0xFF, 0x7F),
            "SIRC20": (0x1FFF, 0x7F),
            "Kaseikyo": (0x3FFFFFF, 0x3FF),
            "RCA": (0x0F, 0xFF),
        }
        for protocol, (address, command) in examples.items():
            with self.subTest(protocol=protocol):
                profile = "\n".join(
                    (
                        "Filetype: IR signals file",
                        "Version: 1",
                        "#",
                        "name: Test",
                        "type: parsed",
                        f"protocol: {protocol}",
                        f"address: {address.to_bytes(4, 'little').hex(' ')}",
                        f"command: {command.to_bytes(4, 'little').hex(' ')}",
                    )
                )
                original = ir_formats.decode_flipper(profile)[0].signal
                jittered = ir_formats.IRSignal(
                    timings=[
                        max(1, round(value * (1.05 if index % 2 else 0.95)))
                        for index, value in enumerate(original.timings)
                    ],
                    carrier_frequency=original.carrier_frequency,
                )

                candidates = ir_formats.recognize_signal(
                    jittered,
                    carrier_source="provided",
                )["protocol_candidates"]

                self.assertIn(
                    (protocol, address, command),
                    [
                        (item["protocol"], item["address"], item["command"])
                        for item in candidates
                    ],
                )

                candidate = next(
                    item
                    for item in candidates
                    if (
                        item["protocol"],
                        item["address"],
                        item["command"],
                    )
                    == (protocol, address, command)
                )
                rebuilt, descriptor = ir_formats.rebuild_recognized_signal(
                    jittered,
                    candidate["rebuild_id"],
                    carrier_source="provided",
                )
                self.assertEqual(descriptor["protocol"], protocol)
                self.assertEqual(
                    rebuilt.carrier_frequency,
                    {
                        "RC5": 36_000,
                        "RC5X": 36_000,
                        "RC6": 36_000,
                        "SIRC": 40_000,
                        "SIRC15": 40_000,
                        "SIRC20": 40_000,
                    }.get(protocol, 38_000),
                )
                rebuilt_candidates = ir_formats.recognize_signal(
                    rebuilt,
                    carrier_source="provided",
                )["protocol_candidates"]
                self.assertIn(
                    (protocol, address, command),
                    [
                        (item["protocol"], item["address"], item["command"])
                        for item in rebuilt_candidates
                    ],
                )

    def test_biphase_rebuild_preserves_the_decoded_toggle(self) -> None:
        for protocol in ("RC5", "RC5X", "RC6"):
            with self.subTest(protocol=protocol):
                command = 0x60 if protocol == "RC5X" else 0x20
                signal = ir_formats.encode_known_protocol(
                    protocol,
                    0x10,
                    command,
                    toggle=1,
                )
                analysis = ir_formats.analyze_signal(
                    signal,
                    carrier_source="provided",
                )
                candidate = next(
                    item
                    for item in analysis["protocol_candidates"]
                    if item["protocol"] == protocol
                )

                rebuilt, _descriptor = ir_formats.rebuild_recognized_signal(
                    signal,
                    candidate["rebuild_id"],
                    carrier_source="provided",
                )
                decoded = next(
                    item
                    for item in ir_formats.recognize_signal(
                        rebuilt,
                        carrier_source="provided",
                    )["protocol_candidates"]
                    if item["protocol"] == protocol
                )

                self.assertEqual(decoded["toggle"], 1)
                self.assertEqual(rebuilt.timings, signal.timings)

    def test_rebuild_id_is_bound_to_the_analyzed_signal(self) -> None:
        source = _parsed_signal("NEC", 0x10, 0x20)
        other = _parsed_signal("NEC", 0x10, 0x21)
        rebuild_id = ir_formats.analyze_signal(source)["protocol_rebuilds"][0]["id"]

        with self.assertRaisesRegex(ValueError, "unavailable"):
            ir_formats.rebuild_recognized_signal(other, rebuild_id)

    def test_sirc_rebuild_adds_the_protocol_required_frames(self) -> None:
        source = ir_formats.encode_known_protocol("SIRC", 16, 18)
        analysis = ir_formats.analyze_signal(source, carrier_source="provided")
        rebuild = next(
            item for item in analysis["protocol_rebuilds"] if item["protocol"] == "SIRC"
        )

        rebuilt, _descriptor = ir_formats.rebuild_recognized_signal(
            source,
            rebuild["id"],
            carrier_source="provided",
        )
        rebuilt_analysis = ir_formats.analyze_signal(
            rebuilt,
            carrier_source="provided",
        )

        self.assertEqual(rebuilt_analysis["frame_count"], 3)
        self.assertTrue(rebuilt_analysis["repeat_requirement_met"])
        self.assertEqual(rebuilt.carrier_frequency, 40_000)

    def test_invalid_kaseikyo_checksum_is_not_claimed(self) -> None:
        profile = """Filetype: IR signals file
Version: 1
#
name: Test
type: parsed
protocol: Kaseikyo
address: 56 34 12 00
command: AB 00 00 00
"""
        signal = ir_formats.decode_flipper(profile)[0].signal
        checksum_bit_space = 3 + 2 * 40
        signal.timings[checksum_bit_space] = (
            432 if signal.timings[checksum_bit_space] > 900 else 1296
        )

        protocols = {
            item["protocol"]
            for item in ir_formats.recognize_signal(signal)["protocol_candidates"]
        }

        self.assertNotIn("Kaseikyo", protocols)

    def test_nec_abbreviated_repeats_are_counted_without_changing_raw(self) -> None:
        original = _parsed_signal()
        timings = [*original.timings, 40000, 9000, 2250, 560, 96000, 9000, 2250, 560]
        signal = ir_formats.IRSignal(timings=list(timings))

        analysis = ir_formats.analyze_signal(signal, carrier_source="provided")
        candidate = next(
            item
            for item in analysis["protocol_candidates"]
            if item["protocol"] == "NEC"
        )

        self.assertEqual(signal.timings, timings)
        self.assertEqual(candidate["repeat_count"], 2)
        self.assertEqual(candidate["required_repeats"], 0)
        self.assertEqual(candidate["repeat_style"], "abbreviated")
        self.assertTrue(candidate["hold_likely"])
        self.assertEqual(
            [frame["role"] for frame in candidate["frame_roles"]],
            ["intro", "repeat", "repeat"],
        )
        self.assertEqual(
            [frame["kind"] for frame in candidate["frame_roles"]],
            ["full", "abbreviated", "abbreviated"],
        )
        self.assertEqual(candidate["residual_timing_ranges"], [])
        self.assertEqual(analysis["repeated_frame_count"], 2)
        self.assertNotIn("possible_incomplete_tail", analysis["warnings"])
        self.assertEqual(
            analysis["single_press_candidate"]["timings"], original.timings
        )

    def test_single_nec_frame_reports_zero_captured_and_required_repeats(self) -> None:
        analysis = ir_formats.analyze_signal(
            _parsed_signal(),
            carrier_source="provided",
        )

        self.assertEqual(analysis["frame_count"], 1)
        self.assertEqual(analysis["repeated_frame_count"], 0)
        self.assertEqual(analysis["repeat_count"], 0)
        self.assertEqual(analysis["required_repeats"], 0)
        self.assertEqual(analysis["repeat_style"], "none")

    def test_nec_full_frame_repeat_keeps_hold_vs_nec2_ambiguity(self) -> None:
        original = _parsed_signal()
        timings = [*original.timings, 40000, *original.timings]

        candidate = next(
            item
            for item in ir_formats.recognize_signal(
                ir_formats.IRSignal(timings=timings)
            )["protocol_candidates"]
            if item["protocol"] == "NEC"
        )

        self.assertEqual(candidate["repeat_count"], 1)
        self.assertEqual(candidate["repeat_style"], "full")
        self.assertIsNone(candidate["hold_likely"])
        self.assertEqual(
            candidate["hold_ambiguity"],
            "full_frame_repeats_may_be_nec2_hold_or_repeated_presses",
        )

    def test_nec_unclassified_tail_is_retained_as_residual_evidence(self) -> None:
        original = _parsed_signal()
        timings = [*original.timings, 40000, 1200, 600, 700]

        candidate = next(
            item
            for item in ir_formats.recognize_signal(
                ir_formats.IRSignal(timings=timings)
            )["protocol_candidates"]
            if item["protocol"] == "NEC"
        )

        self.assertEqual(candidate["repeat_count"], 0)
        self.assertEqual(candidate["frame_roles"][-1]["role"], "unclassified")
        self.assertEqual(candidate["residual_timing_ranges"], [[68, 71]])

    def test_common_full_frame_repeats_share_repeat_evidence(self) -> None:
        examples = {
            "Samsung32": (0x07, 0x02),
            "RCA": (0x0F, 0x20),
            "Kaseikyo": (0x123456, 0x2AB),
            "RC5": (0x10, 0x20),
            "RC5X": (0x10, 0x60),
            "RC6": (0x10, 0x20),
        }
        for protocol, (address, command) in examples.items():
            with self.subTest(protocol=protocol):
                original = _parsed_signal(protocol, address, command)
                signal = ir_formats.IRSignal(
                    timings=[*original.timings, 40000, *original.timings],
                    carrier_frequency=original.carrier_frequency,
                )

                candidate = next(
                    item
                    for item in ir_formats.recognize_signal(signal)[
                        "protocol_candidates"
                    ]
                    if item["protocol"] == protocol
                )

                self.assertEqual(candidate["repeat_count"], 1)
                self.assertEqual(candidate["repeat_style"], "full")
                self.assertEqual(
                    [frame["role"] for frame in candidate["frame_roles"]],
                    ["intro", "repeat"],
                )
                self.assertEqual(
                    candidate["hold_ambiguity"],
                    "full_frame_repeats_may_be_hold_or_repeated_presses",
                )

    def test_sirc_reports_required_and_extra_full_frame_repeats(self) -> None:
        signal = ir_formats.protocols.sony_sirc.encode_sony_sirc(
            command=18,
            device=16,
            repeats=5,
        )

        candidate = next(
            item
            for item in ir_formats.recognize_signal(signal)["protocol_candidates"]
            if item["protocol"] == "SIRC"
        )

        self.assertEqual(candidate["repeat_count"], 4)
        self.assertEqual(candidate["required_repeats"], 2)
        self.assertEqual(candidate["minimum_frame_count"], 3)
        self.assertTrue(candidate["repeat_requirement_met"])
        self.assertEqual(
            candidate["hold_ambiguity"],
            "extra_full_frames_may_be_hold_or_capture_overshoot",
        )

        analysis = ir_formats.analyze_signal(signal)
        self.assertEqual(analysis["required_repeats"], 2)
        self.assertEqual(analysis["single_press_candidate"]["kept_frames"], 3)
        self.assertEqual(
            len(analysis["single_press_candidate"]["timings"]),
            len(signal.timings) * 3 // 5,
        )

    def test_single_sirc_frame_exposes_unmet_repeat_requirement(self) -> None:
        signal = ir_formats.protocols.sony_sirc.encode_sony_sirc(
            command=18,
            device=16,
            repeats=1,
        )

        analysis = ir_formats.analyze_signal(signal, carrier_source="provided")
        candidate = next(
            item
            for item in analysis["protocol_candidates"]
            if item["protocol"] == "SIRC"
        )

        self.assertFalse(candidate["repeat_requirement_met"])
        self.assertFalse(candidate["frame_structure_complete"])
        self.assertEqual(candidate["confidence"], "likely")
        self.assertEqual(candidate["confidence_level"], "medium")
        self.assertFalse(analysis["repeat_requirement_met"])

    def test_minimum_sirc_sequence_is_not_collapsed_to_one_frame(self) -> None:
        signal = ir_formats.protocols.sony_sirc.encode_sony_sirc(
            command=18,
            device=16,
            repeats=3,
        )

        analysis = ir_formats.analyze_signal(signal)

        self.assertTrue(analysis["repeat_requirement_met"])
        self.assertNotIn("single_press_candidate", analysis)


if __name__ == "__main__":
    unittest.main()
