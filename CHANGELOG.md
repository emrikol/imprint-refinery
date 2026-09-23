# Changelog

## 0.1.1 - 2026-09-23

- Remove the standalone XML and hook-runner dependencies while preserving
  bounded GIRR parsing, the release commit guard, and direct lint checks.
- Disable npm dependency lifecycle scripts and pin JavaScript tooling exactly.
- Test against Home Assistant 2026.9.2 and update esbuild to 0.28.2.
- Keep the infrared protocol test library pinned to Home Assistant's version.

## 0.1.0 - 2026-09-22

Initial public release.

- Discover and use Home Assistant 2026.9 infrared emitters and receivers.
- Include an optional compatibility driver for ZHA-connected TS1201/Zosung
  bridges.
- Wait for Zosung device completion before dispatching another transmission,
  preventing repeated commands from overlapping in the blaster.
- Store commands as hardware-neutral raw timings and convert vendor payloads
  only at transport boundaries.
- Organize commands by appliance and location, with search, bulk move, icons,
  and revision history.
- Use appliances and stateless commands through native Home Assistant entities.
- Configure named saved commands, transmission counts, and inter-command delays
  through a native Home Assistant device action.
- Inspect and edit timing envelopes in Signal Lab without changing the source
  command.
- Smooth capture jitter from measured timing clusters or preview a canonical
  protocol rebuild before applying it to an editable draft.
- Distinguish captured repeat frames from protocol-required repeats, and honor
  Home Assistant's native remote repeat and delay fields when transmitting.
- Import and export Imprint backups, Girr, Flipper IR, LIRC raw, Pronto Hex,
  raw timings, and Zosung Base64.
- Search and import from a bundled, offline Flipper-IRDB catalog.
- Decode common protocol candidates and infer raw bitstreams when independent
  decoders agree.
- Restore open inspectors and Signal Lab views from their URLs.
- Support keyboard, touch, narrow screens, Home Assistant themes, and reduced
  motion.
