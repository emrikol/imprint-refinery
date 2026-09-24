# Installation

## Requirements

- Home Assistant 2026.9.0 or newer
- A Home Assistant `infrared` emitter entity or a supported compatibility bridge
- Receiver capability on that hardware if you want to learn commands

The optional ZHA compatibility drivers support a Tuya TS1201 / MOES UFO-R11
with the `zhaquirks.tuya.ts1201.ZosungIRBlaster` quirk and a HOBEIAN ZG-IR01
with its model-specific custom quirk.

## Supported hardware

Imprint Refinery works with emitters and receivers exposed through Home
Assistant's `infrared` entity contract. Those devices do not need a separate
Imprint driver. Learning requires a receiver; emit-only devices can send
imported or previously learned commands.

The bundled compatibility drivers are confirmed for the ZHA-connected Tuya
TS1201 / MOES UFO-R11 and HOBEIAN ZG-IR01 profiles listed above. Other devices
that do not expose Home Assistant infrared entities require a compatibility
driver before Imprint Refinery can use them.

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

Add **Imprint Refinery** once to create the command-library workspace. Existing
Home Assistant `infrared` emitter and receiver entities appear automatically;
they do not need to be registered with Imprint.

If Imprint detects supported hardware that does not expose Home Assistant
infrared entities, **Add compatibility adapter** appears in **Infrared
hardware**. Discovery selects the model-specific driver automatically. Manual
setup uses:

```text
Driver: zosung_ts1201
Endpoint: 1
Cluster: 57348 (0xE004)
Learn timeout: 60 seconds
Learn reassert interval: 8 seconds
```

For a HOBEIAN ZG-IR01, choose `hobeian_zg_ir01`. Existing adapters stored with
the generic driver are upgraded at runtime when the source ZHA device reports
the HOBEIAN manufacturer and ZG-IR01 model.

## Set up remote profiles and appliances

The workspace has three views:

- **Remote profiles** store reusable command sets and revision history.
- **Appliances** connect a remote profile to one actual target, Home Assistant
  Area, preferred IR emitter, and projected Home Assistant entity type.
- **Infrared hardware** lists live Core emitter and receiver entities.

Use **Open entity** or **Open device** in Infrared hardware for native hardware
naming, Area, enable/disable, removal, and provider configuration. Removing
hardware never deletes a remote profile or appliance; affected appliances stay
unavailable until reassigned.

## Check the installation

1. Open **Imprint Refinery** from the sidebar.
2. Open **Infrared hardware** and confirm that the intended emitter and, if
   needed, receiver are available.
3. Create a **Remote profile**.
4. Select **Learn command**, choose the receiver for this learning session, and
   press one button on the original remote.
5. Choose **Test with IR emitter** and test the command once.
6. Create an **Appliance** and assign its Area, remote profile, preferred IR
   emitter, and entity type.

Catalog imports end with the same assignment choice: create a new appliance
from the imported remote profile or assign the profile to an existing
appliance.

The send status confirms delivery to the selected Home Assistant infrared
emitter or compatibility bridge. Infrared appliances do not acknowledge the
command.

## Optional dashboard card

The integration registers the bundled frontend resource automatically. Add the
card to a dashboard with:

```yaml
type: custom:imprint-refinery-card
title: Imprint Refinery
```

The compact card lists up to 12 commands routed through their assigned
appliances. To limit it to one appliance, add its Imprint appliance ID:

```yaml
type: custom:imprint-refinery-card
title: Living room remote
appliance_id: living_room_remote
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

The command library is stored in Home Assistant's `.storage` directory. Use
**Backup & restore** in Remote profiles before removing that data manually.
