# Imprint Refinery backup format

Imprint Refinery uses a portable JSON document for command, appliance,
location, and complete-library backups. Files conventionally use the
`.imprint.json` suffix.

The current document identity is:

```json
{
  "schema": "imprint_refinery.backup",
  "version": 1
}
```

Importers reject an unknown `version` instead of guessing. New exports always
use the versioned format below.

## Top-level object

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | string | Always `imprint_refinery.backup`. |
| `version` | integer | Currently `1`. |
| `scope` | string | `library`, `location`, or `appliance`. |
| `history` | string | `current` or `full`. |
| `command_count` | integer | Integrity check for the number of commands. |
| `locations` | object | Locations keyed by stable, portable ID. |

Each location contains a display `name` and `appliances`. Each appliance in
`appliances` contains `name`, `appliance_type`, `preferred_platform`, and
`commands`. These IDs are library identifiers, not Home Assistant entity or
device identifiers.

## Commands

Commands are keyed by their stable command ID. A command can contain:

- `name`, `icon`, and `role` display and behavior metadata;
- lossless `code` and `format` source payloads;
- canonical `signal`, including carrier source, timings, and semantic regions;
- `analysis`, including fingerprints, recognition evidence, analyzer version,
  and corpus version when known;
- sanitized `source` provenance and compatibility notes.

A `full` backup also contains immutable `revisions`, `current_revision`, and
optional `revision_labels`. A `current` backup omits historical revisions; its
command becomes revision 1 when imported.

## Privacy and safety

Exports omit emitters and installation-specific values, including Zigbee
addresses, endpoints, clusters, Home Assistant entity IDs, hostnames, and
source-command registry references. Export and preview never transmit or mutate
a command.

Restore validates the complete versioned document before changing the registry.
It recreates missing organization and history but never silently overwrites an
existing command. Ordinary import can instead copy selected commands into a
chosen appliance.

## Compatibility policy

- Readers accept version 1.
- Readers fail clearly on newer versions they do not understand; source text
  remains available to the user for recovery.
- Writers emit only the current version.
- Any future version requires an explicit migration and regression fixture;
  version numbers are never reinterpreted in place.
