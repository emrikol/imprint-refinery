# Protocol recognition

Imprint Refinery keeps the captured timings as the protected source of truth.
Protocol recognition adds an explanation and never changes a capture
automatically. Unknown signals remain inspectable, editable, exportable, and
sendable.

## Analysis

Each signal passes through two forms of analysis:

- Protocol decoders check timing rules, field widths, complements, checksums,
  repeat frames, and other family-specific invariants.
- Protocol-neutral analysis finds timing clusters, likely frames, repeated
  shapes, and incomplete tails without assigning a protocol name.

The Inspector shows all credible candidates. A decoder does not win because it
ran first.

## Confidence labels

- **Verified:** Protocol invariants and supplied carrier evidence pass.
- **Likely:** Strong timing and field evidence exists, but required carrier or
  another fact is unavailable.
- **Ambiguous:** More than one interpretation remains credible.
- **Pattern only:** The analyzer found useful structure without a defensible
  protocol name.
- **Unknown:** No supported interpretation fits the signal.

These labels describe the evidence in a capture. They do not confirm that a
particular appliance accepted a transmitted command.

## Raw bitstreams

A raw bitstream is an interpretation of pulse timings under a line-code model.
Imprint Refinery clusters mark and space durations, then runs every applicable
pulse-distance, pulse-width, and named-protocol decoder.

Automatic mode shows a bitstream only when every decoder that returned bits
returned the same sequence. A disagreement produces an ambiguous result rather
than a majority vote. The support score combines timing fit with independent
protocol corroboration; it is an evidence score, not a probability.

Manual mode can show one decoder's result when automatic mode cannot choose.
The selected decoder changes only the view. It does not alter the stored
signal.

Fixed-rate serial decoding is a different model and is not applied to ordinary
pulse-coded IR captures without a compatible waveform and symbol interval.

## Smoothing and protocol rebuilds

Signal Lab provides two refinements:

- **Smooth timing jitter** groups similar measured mark and space durations and
  replaces each group with its average. It uses only the current draft and does
  not apply protocol rules or change the carrier.
- **Protocol rebuild** decodes the selected interpretation and re-encodes its
  fields with that protocol's defined timings, carrier, frame shape, and
  required repeats. It is offered only when the decoder can produce a complete
  canonical waveform.

Built-in canonical encoders cover NEC, extended NEC and NEC42 variants,
Samsung32, SIRC 12/15/20, RC5, RC5X, RC6, Kaseikyo, and RCA. Optional Home
Assistant protocol adapters get the same rebuild capability when their decoder
provides a canonical waveform. Stateful formats are rebuilt from the decoder's
own command object rather than guessed from a few displayed fields.

Every change opens a comparison preview first. Applying it updates only the
editable draft, including the canonical carrier when applicable. The protected
source revision remains unchanged, and ambiguous interpretations must be
selected explicitly.

## Repeats

The UI keeps two different facts separate:

- **Captured repeats** counts repeat frames present in the saved waveform.
- **Required repeats** reports the protocol's minimum after the initial frame.

For example, one complete NEC frame has zero captured repeats and requires none
for a one-press command. A held button may still emit additional frames; the
protocol does not imply a fixed total for an unknown hold duration.

The stored transport payload is never shortened silently. **Optimize for one
press** appears only when the analyzer finds removable repeated frames. A
recognized protocol keeps its required minimum frame count. Unknown patterns
show the proposed change before it is applied.

## Carrier provenance

Some receivers, including the optional TS1201/Zosung bridge, report alternating
pulse durations but not carrier frequency. Imprint Refinery labels its 38 kHz
fallback as assumed. Receivers and imported formats may provide a carrier
frequency; that provenance is preserved. An assumed carrier does not count as
protocol evidence.

## References

The bitstream analysis follows the duration clustering and model selection used
by established IR tooling:

- [Arduino-IRremote distance/width decoding](https://github.com/Arduino-IRremote/Arduino-IRremote/blob/master/src/ir_DistanceWidthProtocol.hpp)
- [HarcToolbox IrpTransmogrifier](https://www.harctoolbox.org/IrpTransmogrifier.pdf)
- [LIRC](https://www.lirc.org/)
- [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266)

`protocol-corpus.json` records the pinned HARCToolbox research corpus used for
comparison. The integration does not bundle or execute that corpus.
