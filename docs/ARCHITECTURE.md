# Architecture

Imprint Refinery separates signal-domain code from Home Assistant adapters. The
pure layers can be tested without a running Home Assistant instance; adapters
own framework lifecycle, persistence, registries, and hardware calls.

## Runtime composition

`async_setup_entry` creates one domain runtime containing:

- `SignalLibraryStore`: transactional persistence around the pure library;
- `ActivityStatus`: the latest operation snapshot;
- `InfraredHardware`: routing through Home Assistant infrared entities or an
  optional compatibility bridge;
- `SignalQueue`: bounded, ordered queues keyed by emitter;
- `GuidedCatalogSessionManager`: temporary explicit discovery sessions.

The panel RPC layer, public send action, and entity platforms share those
objects. Unloading the final entry cancels capture tasks, closes queued work,
unregisters the public action, and removes the sidebar panel.

## Library

`library.py` owns validation and mutation of the versioned
`imprint_refinery.library` document. It has no Home Assistant imports.
`storage.py` takes a deep copy before each mutation, saves through Home
Assistant's `Store`, emits one registry-updated signal after a successful
write, and restores the copy if the operation fails.

The hierarchy is:

```text
emitter records
locations
  appliances
    commands
      immutable revisions
```

The product vocabulary is defined once in `product_spec.py`. The persisted
document is an implementation detail; the panel uses validated internal action
names and automations use native Home Assistant entities.

## Capture and send paths

Native capture subscribes to a Home Assistant receiver for a bounded window.
Compatibility drivers can implement the same operation for hardware that does
not expose a receiver entity:

```text
panel RPC → InfraredHardware.capture
           → Home Assistant receiver subscription
             or compatibility-driver capture
           → signal or timeout
           → always release the subscription/capture mode
```

Saved and unsaved sends share the same queue:

```text
panel RPC/entity → SignalQueue.submit
               → per-emitter FIFO + age/capacity checks
               → InfraredHardware.send
               → Home Assistant infrared emitter
                 or compatibility-driver send
               → sent_unconfirmed or failure status
```

Different emitters may transmit concurrently. One emitter processes a single
signal at a time. Queue success means the selected hardware adapter accepted
the operation; IR has no appliance acknowledgement channel.

## Signal model

`ir_formats` converts external representations into `IRSignal`, whose timings
are positive alternating mark/space durations. The library persists signed raw
timings plus carrier provenance, never a vendor transport payload. Analysis
derives frame boundaries, timing clusters, raw bitstream candidates,
fingerprints, and protocol interpretations without changing the source waveform.

Protocol recognition is evidence, not truth. A known decoder can add field
interpretations, while the raw timings and raw bitstream remain available.
Carrier values retain provenance (`measured`, supplied, or assumed).

Signal Lab edits a frontend draft. It sends only the explicit draft during a
one-shot test and creates a new command on save; the source revision is never
overwritten in place. Capture-relative smoothing averages timing clusters in
that draft. Protocol rebuilds are separate, explicit previews produced by a
canonical encoder attached to the selected decoder interpretation; they update
both waveform and carrier only after the user applies the preview.

## Entity projection

`entity_projection.py` converts library records into immutable
`EntityBlueprint` values. `ProjectionController` diffs blueprints on the
registry-updated signal and asks each platform to add or remove only the
affected entities.

Capabilities come from explicit command roles. IDs and display names are not
parsed for behavior. `auto` chooses the narrowest useful platform; users can
request `remote`, `media_player`, or `switch` explicitly when its required
roles exist.

Entities resolve a saved command at send time and pass `RawSignalCommand`
through Home Assistant's infrared helper to the selected emitter. Vendor
encoding is confined to `zha_drivers.py` for devices that need the optional ZHA
bridge.

## Home Assistant boundaries

- `frontend_bridge.py`: static assets, sidebar panel, Lovelace resource.
- `device_bridge.py`: compatibility-bridge device ownership and name
  synchronization.
- `config_flow.py`: the hub entry and optional compatibility-bridge subentries.
- `hardware.py`: native Home Assistant infrared discovery and routing.
- `zha_bridge.py` / `zha_drivers.py`: optional ZHA bridge behavior and its
  declarative vendor facts.
- `services.py`: authenticated panel RPC, validation, workflow orchestration,
  and the single public entity-targeted send action.
- `infrared.py`: physical emitter entities.
- `remote.py`, `media_player.py`, `switch.py`: projected appliances.
- `button.py`: stateless commands not already represented by a native control.
- `sensor.py`: diagnostic status and emitter capabilities.

The frontend calls the authenticated `imprint_refinery/execute` WebSocket
command. Its operations form an internal UI contract, not a public automation
API. The frontend does not traverse hardware objects or mutate storage
directly, and capture, editing, catalog, import, export, and revision operations
stay out of Home Assistant's action picker.

## Offline catalog

The catalog is built ahead of time into a deterministic, checksummed artifact.
Runtime search and matching read that local artifact. Guided discovery stores
ephemeral session state and requires the user to initiate and answer every
candidate test.
