# Architecture

Imprint Refinery separates reusable infrared knowledge, actual controlled
equipment, and connected hardware.

## Domain model

The version 3 library has two top-level collections:

```text
remote_profiles
  commands
    immutable revisions

appliances
  remote_profile_id
  infrared_emitter_ref
  preferred_platform
```

A remote profile is a reusable command set for a product or remote family. It
contains no Home Assistant device, entity, Area, or emitter identifiers. An
appliance is one actual target in the home. Several appliances may reference
the same remote profile, while each keeps its own name, Area, emitter route,
Home Assistant device, and entity state.

Home Assistant's Device and Area Registries are authoritative for appliance
placement. Moving an appliance between Areas does not change its library ID,
device identifier, or projected entity IDs.

## Core infrared boundary

Imprint consumes Home Assistant's Core Infrared contract directly:

```text
appliance entity
  → resolve appliance, remote profile, command, and emitter
  → infrared.async_send_command(...)
  → Core Infrared emitter entity
```

Projected appliance entities inherit `InfraredEmitterConsumerEntity`, so Core
owns emitter lookup, availability tracking, context propagation, and command
delivery. The panel uses the same helper for an explicit, session-only test
emitter.

Learning uses the matching receive contract:

```text
learning session
  → infrared.async_subscribe_receiver(...)
  → Core Infrared receiver entity
  → InfraredReceivedSignal
  → always unsubscribe on success, timeout, cancellation, or unload
```

`hardware.py` is read-only live inventory. It enumerates emitters and receivers
from Core and resolves their current names, availability, Areas, and registry
links. The library does not mirror this information.

## Compatibility provider

Hardware that lacks a native Core Infrared provider can use an Imprint config
subentry. `infrared.py` exposes one standard emitter and receiver entity on the
existing source hardware device. `zha_bridge.py` contains the vendor-specific
ZHA commands and serializes transmissions per physical adapter when required.

No Imprint wrapper hardware device, capability sensor, global activity sensor,
or application-wide send queue sits above Core Infrared.

## Entity projection

`entity_projection.py` derives immutable blueprints from appliances and their
assigned remote profiles. Depending on command roles, the primary projection
is a standard `remote`, `media_player`, or `switch`; unrepresented commands are
standard `button` entities.

An incomplete appliance—missing a profile or emitter—keeps its logical Home
Assistant device but does not project a usable entity. A removed or disabled
emitter makes only appliances routed through it unavailable. Reassigning an
emitter recreates the consumer entity with the same unique ID so Core does not
keep an availability subscription to the old emitter.

## Persistence and migration

`library.py` owns the pure versioned model. `storage.py` wraps each mutation in
a copy-on-write transaction, saves through Home Assistant's `Store`, and emits
one projection update after a successful write.

The v2-to-v3 migration creates one profile and one appliance for every legacy
location/appliance pair. It preserves the old combined appliance identifier,
all commands, raw signals, revisions, timestamps, display names, and preferred
platform. Legacy locations become Home Assistant Area assignments; the
location hierarchy is not retained in the library. Legacy emitter keys are
resolved to stable Entity Registry UUIDs where possible.

## Panel and automations

The frontend uses the authenticated `imprint_refinery/execute` WebSocket
command for library workflows. These operations are private panel RPC, not
public Home Assistant actions.

The panel URL is the source of truth for stable workspace navigation. Appliance
and remote-profile selections use path segments. Command detail routes record
the open Inspector tab, representation, decoder, waveform viewport, and
selected revision. Signal Lab routes record the source profile, command (or a
new custom signal), edit/compare view, active representation tab, decoder,
waveform viewport, overlays, and save pane. Reload and browser Back/Forward
restore those states without transmitting a signal. Unsaved timing values and
undo history are too large for a shareable URL, so they are kept in tab-scoped
session storage with explicit Resume and Discard actions.

Automations use standard projected entity actions: normally
`remote.send_command`, with native `media_player`, `switch`, or `button.press`
actions where those semantics fit. Imprint registers no public send action and
no custom device automation.

## Signal model

The library stores hardware-neutral alternating mark/space timings with
carrier provenance. `RawSignalCommand` is the minimal concrete
`infrared_protocols.commands.Command` adapter used at the Core boundary.
Import/export, lossless storage, structural analysis, recognition, and formats
not supplied by `infrared-protocols` remain Imprint responsibilities. Local
waveform generators are retained only where the installed upstream library
does not provide an equivalent encoder.
