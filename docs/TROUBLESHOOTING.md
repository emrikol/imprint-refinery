# Troubleshooting

## `code_empty` after a TS1201 restart

This is expected for the TS1201. The last-learned-code attribute is volatile
and can be empty after Home Assistant or device restart.

Saved commands are stored separately in Home Assistant storage and remain
available in the panel and through their projected Home Assistant entities.

## `capture_timeout`

The integration did not observe a new non-empty code before timeout.

Check:

- the physical remote is pointed at the receiver;
- the remote has working batteries;
- the receiver is available in Home Assistant;
- `timeout` is long enough;
- `poll_interval` is not too large;
- the selected infrared device exposes a receiver.

Try `timeout: 60` and `poll_interval: 1` for validation.

## `zha_device_not_found`

This applies only to the optional ZHA compatibility bridge.

The configured IEEE address could not be matched to a ZHA device registry entry.

Check:

- the TS1201 is paired with ZHA;
- the IEEE address in the config entry is correct;
- the device has not been removed and re-paired under a different address;
- ZHA is loaded before Imprint Refinery starts.

## `cluster_not_found`

This applies only to the optional ZHA compatibility bridge. The integration
could not find the expected control cluster on the configured endpoint.

Check:

- the device is the supported TS1201 / MOES UFO-R11 profile;
- the active quirk is `zhaquirks.tuya.ts1201.ZosungIRBlaster`;
- endpoint is `1`;
- control cluster is `0xE004` / `57348`.

## `send_failed`

The selected Home Assistant emitter or compatibility bridge rejected the send.

Check:

- the saved command has a non-empty `code`;
- the selected infrared emitter is available in Home Assistant;
- the target IR device is in range;
- the underlying integration or network is healthy.

## `command_expired` / `expired`

The command waited too long in the per-emitter queue and was not sent. This
protects against stale clicks being replayed after a delayed Zigbee send path
recovers.

Check:

- whether the same emitter is receiving many commands at once;
- whether hardware sends are slow or timing out;
- automations that may be repeating a service call too aggressively.

## `queue_full`

The emitter already has the maximum number of active plus queued commands.
The newest command was rejected instead of growing an unbounded backlog.

Check:

- dashboards or automations that can fire repeated sends rapidly;
- stuck sends for the same emitter;
- whether separate rooms/devices should use separate physical emitters.

## `queue_stopped`

The integration was unloaded or restarted while a command was still pending in
the dispatcher queue. Pending commands are failed during teardown; commands
already handed to a hardware adapter are allowed to finish.

Check:

- whether Home Assistant or the integration was restarted during the service call;
- whether the error appeared during reload/update rather than normal use.

## `delivery_failed`

The dispatcher tried to hand the command to the selected Home Assistant
infrared emitter or compatibility bridge, but the transport returned an error.
The physical IR delivery is not confirmed.

Check the same items as for `send_failed`, then review Home Assistant logs for
the wrapped integration error message.

## Command does not control the target device

A service call can succeed even if the target IR device does not react. Imprint
Refinery can report that the command reached the infrared send path, but it cannot
confirm that the IR receiver accepted it.

Try:

- relearning the command closer to the receiver;
- sending the command once and checking the appliance response;
- moving the emitter for better IR line of sight;
- checking whether the original remote uses a long press or repeated frame behavior.

## Generated Sony code does not control the receiver

First confirm that normal learned commands work with the same emitter placement.

For Sony receivers, start with:

```yaml
protocol: sony_sirc
device: 16
bits: "12"
repeats: 3
```

If the receiver is configured for an alternate Sony AV mode, try:

```yaml
protocol: sony_sirc
device: 48
bits: "15"
repeats: 3
```

Generate the signal in Signal Lab, use **Test once**, and save it only after the
receiver responds as expected.

## Lovelace card does not load

Check:

- Home Assistant was restarted after installing the integration;
- the resource URL is `/imprint_refinery/imprint-refinery-card.js`;
- the resource type is `module`;
- Home Assistant was restarted after updating the integration;
- the file exists at `custom_components/imprint_refinery/www/imprint-refinery-card.js`.

The card logs its loaded version in the browser console:

```text
IMPRINT REFINERY 0.1.0
```

If the console shows an older version after updating, restart Home Assistant
and reload the dashboard. The integration keeps the Lovelace resource URL in
sync after startup, so manual `?v=` edits are not needed.

## Export profile copy does not put JSON on the clipboard

The card first uses the browser Clipboard API and then falls back to the export
text area. If neither path works, use the download button.

Check:

- the browser allows clipboard access for the Home Assistant site;
- the export textarea contains JSON;
- the card version in the browser console is current;
- another browser extension is not blocking clipboard writes.

## IDs are rejected

Registry IDs must match:

```text
[a-z0-9_]+
```

Use IDs such as `cabinet`, `cd_player`, and `open_close`. Put human-friendly
labels in the `name` field.

## Enable debug logging

Add this to Home Assistant logging configuration when investigating integration
behavior:

```yaml
logger:
  default: info
  logs:
    custom_components.imprint_refinery: debug
```

When troubleshooting the optional TS1201 bridge, also enable
`zhaquirks.tuya.ts1201` and `zigpy`. Disable verbose logging afterward because
it can produce a large amount of output.
