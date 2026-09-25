# Changelog

## 0.3.0 - 2026-09-24

### Added

- Add multi-button catalog identification. Capture up to eight labeled buttons,
  intersect their catalog matches, reject duplicate evidence, and prioritize
  results for the selected appliance type without hiding unclassified profiles.
- Add complete Signal, Code, and History tools to the command Inspector:
  waveform navigation and timing copy; the shared Raw bitstream decoder and
  transmission-order readout; revision metadata, labels, tests, comparisons,
  exports and restores; and full command backups.
- Add Broadlink packet decoding for learned HOBEIAN ZG-IR01 signals, including
  the device's padding-length overcount.

### Changed

- Give receiver capture a separate five-second preparation phase before its
  full listening countdown, and use the same capture feedback in learning and
  catalog identification.
- Open custom signals directly in an editable Signal Lab draft instead of a
  separate dialog.
- Preserve complete Inspector and Signal Lab route context, bulk selection and
  search state across reloads, and retained Signal Lab drafts when another
  command is opened. Continuous pan and zoom now replace browser history
  instead of creating a Back entry for every gesture.
- Report hardware state-update timestamps instead of presenting entity state
  strings as IR activity.
- Refresh the public Signal Lab, catalog, learning, and hardware screenshots
  from deterministic browser fixtures.

### Fixed

- Restore guided catalog matching, profile review and selective imports;
  file-based format detection and import completion; version 1 backup review,
  mapping and restore; and canonical permalink state.
- Preserve captured signals when analysis fails, review duplicate and catalog
  matches, and save original-plus-optimized signals as two revisions without
  duplicating the original when an optimized save is retried.
- Tolerate malformed intermediate HOBEIAN capture payloads and restart learning
  after cancellation followed by immediate resubscription.
- Re-resolve stable emitter registry references after entity-ID renames and
  preserve assumed carrier provenance at the Core infrared boundary.
- Fall back from stale revision permalinks to the current revision, reject
  stale asynchronous backup previews, and remove hidden file inputs from the
  keyboard tab order.
- Replace multiline catalog choices with reusable, auto-height Home Assistant
  action tiles, stack them on narrow dialogs, and prevent dialog and revision
  controls from clipping or overflowing. Selected revisions now inherit Home
  Assistant's semantic foreground color for accessible contrast.

### Removed

- Remove the standalone custom-signal dialog now that Signal Lab owns that
  workflow.

## 0.2.0 - 2026-09-24

### Breaking changes

- Remove the public `imprint_refinery.send_command` action and the custom
  `send_saved_command` device action. Migrate existing automations to
  `remote.send_command`, the appliance's native media-player or switch action,
  or `button.press` before updating.
- Remove the Imprint activity/status sensor and emitter-capability sensors,
  including the dashboard card's `status_entity` configuration.
- Automatically migrate the released version 2 library to schema version 3.
  The migration preserves appliance device and entity identities, commands,
  revisions, and timestamps, but version 0.1.1 cannot read the library after
  version 3 has been saved. Downgrading requires restoring a pre-upgrade Home
  Assistant backup.
- Replace Imprint-managed Locations with Home Assistant Areas. Existing
  location names are mapped to Areas without overwriting a user-selected Area.
- Write portable backups as format version 2. Version 1 backups remain
  importable, but older Imprint releases cannot import the new format.

### Added

- Add separate **Appliances**, **Remote profiles**, and **Infrared hardware**
  workspaces, with Appliances as the default view.
- Add reusable remote profiles that store one command set and revision history
  for any number of appliances. Each appliance retains its own Area, preferred
  IR emitter, Home Assistant device, entities, and projection preference.
- Add appliance categories with catalog-aligned labels and icons, plus direct
  links to the corresponding Home Assistant device.
- Add a live inventory of Core infrared emitters and receivers with
  availability, Area, recent activity, and native entity/device links.
- Add profile and command creation, editing, duplication, bulk selection, and
  moving commands between profiles while preserving revision history.
- Add a staged learning workflow with receiver selection, live capture
  feedback, waveform review, optional one-press optimization, temporary emitter
  testing, and **Save & learn another**.
- Add canonical, reloadable routes for workspaces, selected appliances and
  profiles, open commands, Inspector tabs, and Signal Lab views.
- Add a reusable waveform comparison tool with synchronized zoom and hover,
  structural and timing differences, shared time axes, and before/after review
  for transforms, saves, and revision restores.
- Add seven code representations: Zosung Base64, Pronto Hex, GIRR, Flipper,
  LIRC, raw signed, and raw unsigned, with explicit conversion-loss reporting.
- Add file-based import with backend format detection, plus guided catalog
  matching through one-shot appliance tests and captured-button identification.
- Add revision labels, aligned revision comparisons, temporary tests, code
  copying, JSON exports, restores, and downloadable code representations.
- Add model-specific HOBEIAN ZG-IR01 discovery, Broadlink timing encoding, and
  device-consumption completion handling without changing generic
  TS1201/Zosung payloads.

### Changed

- Store commands and revisions on remote profiles in library schema version 3;
  store actual equipment separately as appliances that reference those
  profiles.
- Make Home Assistant's Area Registry and Core infrared entities authoritative
  for appliance placement, hardware inventory, availability, learning, and
  transmission.
- Project appliance entities through Core's infrared consumer API. Temporary
  learning and testing selections no longer change an appliance's saved route.
- Replace custom buttons, fields, dialogs, menus, alerts, tabs, cards, loading
  states, and transient banners with Home Assistant components and global
  notification toasts where equivalent primitives exist.
- Make appliance and command cards accessible primary actions, with secondary
  operations in Home Assistant overflow menus. The command Inspector can
  generate actions for any appliance that shares the selected profile.
- Keep the optional Lovelace card compact and appliance-routed while the
  sidebar panel retains the complete management workspace.
- Split Signal Lab into explicit Edit and Compare views, keep the saved source
  protected, render passive code as selectable `<pre><code>`, and distinguish
  protocol alignment from generic timing smoothing.
- Collapse protocol interpretations that produce identical timing and carrier
  output into one canonical alignment choice while retaining decoder consensus
  and ambiguity information.
- Use upstream `infrared-protocols` Sony SIRC and RC5 encoders where their
  output is parity-equivalent; retain local encoders where timing or semantics
  differ.
- Restore backups through explicit local Area and emitter mapping, and let a
  catalog import create a new appliance or attach its profile to an existing
  appliance.
- Expose optional ZHA compatibility adapters as Core emitter and receiver
  entities on their source device instead of creating parallel wrapper devices.

### Fixed

- Remove every appliance entity-registry row, including disabled entities and
  startup orphans, before deleting its Home Assistant device.
- Recreate an appliance's Core consumer entity when its emitter changes so
  availability follows the new route; keep incomplete appliances as logical
  devices without projecting unusable entities.
- Serialize Zosung sends per physical adapter and match completion to the
  selected transfer sequence, including HOBEIAN firmware that reports device
  consumption instead of the generic completion frame.
- Refresh stale command analysis without creating a revision and avoid showing
  duplicate protocol rebuilds that emit the same signal.
- Fix clipped, overlapping, or horizontally scrolling controls and dialogs;
  align search/select rows; and compact action and metric groups into responsive
  columns at narrow widths.
- Fix command-card activation and icon/name layout, non-scrolling Inspector
  tabs, layout-shifting transient notices, and nested overlays escaping their
  containers.
- Fix compact and comparison waveforms to use one-pixel traces, synchronized
  cursors, complete axis and boundary context, and continuous tails through the
  after-signal gutter.
- Migrate released `screen`, `location`, appliance, command, Inspector, and
  Signal Lab query links to canonical paths while preserving unrelated query
  parameters and URL fragments.
- Refresh the public workspace and Signal Lab screenshots from deterministic
  browser fixtures.

### Removed

- Remove mirrored emitter records, Imprint-owned hardware lifecycle controls,
  wrapper hardware devices, and the integration-wide transmission queue/status
  model in favor of live Core state and delivery APIs.
- Remove the retired custom frontend primitive and monolithic library component
  layers in favor of reusable workflow, workspace, and Home Assistant
  components.

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
