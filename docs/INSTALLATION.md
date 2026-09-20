# Installation

## Requirements

- Home Assistant 2026.9.0 or newer
- A Home Assistant `infrared` emitter entity or a supported compatibility bridge
- Receiver capability on that hardware if you want to learn commands

The optional ZHA compatibility driver supports a Tuya TS1201 / MOES UFO-R11
with the `zhaquirks.tuya.ts1201.ZosungIRBlaster` quirk.

## Supported hardware

Imprint Refinery works with emitters and receivers exposed through Home
Assistant's `infrared` entity contract. Those devices do not need a separate
Imprint driver. Learning requires a receiver; emit-only devices can send
imported or previously learned commands.

The bundled compatibility driver is confirmed for the ZHA-connected Tuya
TS1201 / MOES UFO-R11 profile listed above. Other devices that do not expose
Home Assistant infrared entities require a compatibility driver before Imprint
Refinery can use them.

## Install with HACS

1. Open HACS in Home Assistant.
2. Open the menu and choose **Custom repositories**.
3. Add `https://github.com/emrikol/imprint-refinery` as an **Integration**.
4. Find **Imprint Refinery** in HACS and select **Download**.
5. Restart Home Assistant.
6. Open **Settings** > **Devices & services** > **Add integration**, then select
   **Imprint Refinery**.

HACS installs the integration under
`custom_components/imprint_refinery`.

## Install manually

1. Download the source archive for the release you want to install.
2. Copy `custom_components/imprint_refinery` into the Home Assistant
   `custom_components` directory.
3. Restart Home Assistant.
4. Open **Settings** > **Devices & services** > **Add integration**, then select
   **Imprint Refinery**.

The installed directory must contain:

```text
custom_components/imprint_refinery/manifest.json
```

## Add the integration

Choose **Use Home Assistant infrared entities** to create the workspace.
Imprint Refinery discovers loaded `infrared` emitter entities automatically and
pairs a receiver on the same Home Assistant device when one is available.

The setup flow also lists supported ZHA devices that do not expose Home
Assistant infrared entities. If automatic ZHA discovery misses a compatible
device, choose manual setup. The confirmed TS1201 driver uses:

```text
Driver: zosung_ts1201
Endpoint: 1
Cluster: 57348 (0xE004)
Learn timeout: 60 seconds
Learn reassert interval: 8 seconds
```

## Check the installation

1. Open **Imprint Refinery** from the sidebar.
2. Confirm that the intended emitter shows **Ready**.
3. If it also has a receiver, select **Learn command** and press one button on
   the original remote.
4. Review and save the capture.
5. Select **Send once** and check that the appliance responds.

The send status confirms delivery to the selected Home Assistant infrared
emitter or compatibility bridge. Infrared appliances do not acknowledge the
command.

## Optional dashboard card

The integration registers the bundled frontend resource automatically. Add the
card to a dashboard with:

```yaml
type: custom:imprint-refinery-card
title: Imprint Refinery
status_entity: sensor.imprint_refinery_status
```

If the card editor cannot find the card, restart Home Assistant and reload the
browser before adding the resource manually. The resource URL is:

```text
/imprint_refinery/imprint-refinery-card.js
```

## Update

For a HACS installation, install the update in HACS and restart Home Assistant.

For a manual installation, replace the complete
`custom_components/imprint_refinery` directory with the files from the new
release, then restart Home Assistant. Do not merge old and new integration
directories.

## Remove

1. Remove Imprint Refinery from **Settings** > **Devices & services**.
2. Remove the HACS repository or delete
   `custom_components/imprint_refinery`.
3. Restart Home Assistant.

The command library is stored in Home Assistant's `.storage` directory. Create
a backup from Imprint Refinery before removing that data manually.
