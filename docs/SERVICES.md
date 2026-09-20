# Home Assistant actions

Imprint Refinery exposes only the controls needed in automations. Capture,
editing, catalog, import, export, and library operations remain in the panel and
do not appear in Home Assistant's action picker.

## Preferred automation action

Each appliance gets one primary entity: `remote`, `media_player`, or `switch`.
Commands that are not already represented by that entity appear as `button`
entities on the same Home Assistant device. Their names and icons come from the
saved commands.

In Home Assistant's automation editor:

1. Add a **Device** action.
2. Select the Imprint appliance.
3. Choose **Send a saved command**.
4. Pick the named command and set **Repeats** and **Delay seconds**.

The resulting action remains readable and portable YAML:

```yaml
device_id: 11111111111141118111111111111111
domain: imprint_refinery
type: send_saved_command
entity_id: remote.wall_light
command_id: warm_white
num_repeats: 3
delay_secs: 0.4
```

`num_repeats` is the total number of transmissions. The delay is inserted only
between transmissions. Every transmission sends the complete saved waveform;
protocol-required internal frames remain part of that waveform. Imprint does
not synthesize protocol-specific hold behavior from a one-press capture.

Projected command buttons remain useful on dashboards and send once when
pressed. Media-player and switch appliances continue to use their normal
domain actions when those actions express the requested behavior.

```yaml
# A mapped media input
action: media_player.select_source
target:
  entity_id: media_player.television
data:
  source: HDMI 1
```

Inspector's **Use in Home Assistant** section copies this named device action
for remote appliances. It also links to the appliance device page. An
Imprint location becomes the device's suggested Home Assistant Area when the
device has no user-selected Area; Imprint never overwrites a user's Area.

## Advanced native remote action

Home Assistant's generic `remote.send_command` action reaches the same send
path and remains available for hand-written YAML. Its editor exposes the full
remote service schema, including fields Imprint does not use, so the named
device action above is the better default.

```yaml
action: remote.send_command
target:
  entity_id: remote.wall_light
data:
  command: warm_white
  num_repeats: 3
  delay_secs: 0.4
```

## One-shot Imprint action

The integration-specific entity action remains available for a direct one-shot
send. Prefer the named device action when an automation needs a send count or
delay:

```yaml
action: imprint_refinery.send_command
target:
  entity_id: remote.wall_light
data:
  command_id: custom_mode
```

The action requires two values:

- `target`: One or more Imprint `remote` entities, devices, or Areas selected
  through Home Assistant's target picker.
- `command_id`: The stable saved command ID on each targeted appliance.

A successful call means the one-shot signal was handed to the selected Home
Assistant infrared emitter or compatibility bridge. Infrared is one-way, so
the appliance does not acknowledge receipt. Duplicate targets are
handled by Home Assistant's entity service machinery; every selected entity
resolves the command from the same library at send time.

## What sends a signal

Opening Inspector, copying an action or entity ID, following the device link,
refreshing a permalink, and exporting data never transmit a signal. Only an
explicit entity action, **Send once**, **Test once**, or guided-match test can
send.
