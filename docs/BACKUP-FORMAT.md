# Imprint Refinery backup format

Imprint Refinery uses a portable JSON document for remote profiles and optional
appliance references. Files conventionally use the `.imprint.json` suffix.

The current document identity is:

```json
{
  "schema": "imprint_refinery.backup",
  "version": 2
}
```

## Top-level object

| Field | Type | Meaning |
| --- | --- | --- |
| `schema` | string | Always `imprint_refinery.backup`. |
| `version` | integer | Currently `2`. |
| `scope` | string | `library` or `remote_profile`. |
| `history` | string | `current` or `full`. |
| `command_count` | integer | Integrity check for included commands. |
| `remote_profiles` | object | Reusable profiles keyed by portable ID. |
| `appliances` | object | Optional names and profile references. |

A remote profile contains `name`, `appliance_type`, and `commands`. An exported
appliance contains only its display name, remote-profile reference, preferred
projection, and optional Area-name suggestion. Hardware routes, Home Assistant
registry IDs, and Area IDs are never portable library data.

## Commands

Commands are keyed by stable command ID and may contain:

- `name`, `icon`, and `role` metadata;
- lossless `code` and `format` source payloads;
- canonical `signal` timings and carrier provenance;
- structural `analysis` and recognition evidence;
- sanitized `source` provenance.

A `full` backup contains immutable revisions, the current revision, and
optional labels. A `current` backup omits historical revisions; the current
command becomes the initial imported revision.

## Privacy and restore behavior

Exports remove emitter and receiver references, entity and device IDs, Zigbee
addresses, endpoints, clusters, hostnames, and other installation-specific
values.

Restored remote profiles are immediately usable for inspection and editing.
Restore reviews every appliance and requires an explicit local IR emitter
selection. An exported Area name is only a mapping suggestion; the user maps it
to a Home Assistant Area, and the Area Registry remains authoritative.

## Compatibility

- Readers accept version 2.
- Readers also accept version 1 and convert every legacy appliance into a
  separate remote profile plus appliance.
- Writers emit version 2 only.
- Unknown newer versions fail clearly rather than being guessed.
