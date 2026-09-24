# Home Assistant actions

Imprint Refinery projects each configured appliance through standard Home
Assistant entities. Capture, editing, catalog, import, export, and library
operations stay inside the authenticated panel and are not public actions.

## Remote appliances

Use Home Assistant's standard `remote.send_command` action. The command
Inspector copies this YAML for the selected appliance and command:

```yaml
action: remote.send_command
target:
  entity_id: remote.wall_light
data:
  command: warm_white
  num_repeats: 3
  delay_secs: 0.4
```

`num_repeats` is the total number of transmissions. The delay applies only
between transmissions. Each transmission sends the complete stored waveform;
Imprint does not infer protocol-specific hold behavior from a one-press
capture.

## Native entity controls

When a command maps cleanly to a standard `media_player` or `switch` feature,
use that entity's normal action. Commands not represented by the appliance's
primary entity are exposed as buttons and use `button.press`.

```yaml
action: media_player.select_source
target:
  entity_id: media_player.television
data:
  source: HDMI 1
```

```yaml
action: button.press
target:
  entity_id: button.wall_light_warm_white
```

Opening Inspector, copying an action or entity ID, following the device link,
refreshing a permalink, and exporting data never transmit a signal. Only an
explicit entity action or **Test once** can send.
