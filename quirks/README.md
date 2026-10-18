# Custom ZHA quirks

This directory holds custom [ZHA](https://www.home-assistant.io/integrations/zha/) quirks that some supported hardware needs before Home Assistant can expose it as an infrared emitter or receiver.

**These files are not part of Imprint Refinery.** The integration does not load them, HACS does not install them, and Home Assistant does not apply them automatically. They are optional companion files for ZHA users, published in this repository only so the hardware setup stays in one place. Each file keeps its own license; see `LICENSE` in this directory.

## Which devices need a file here

- **HOBEIAN ZG-IR01** — needs `zg_ir01.py` from this directory. Without it, ZHA pairs the device as a generic on/off device plus temperature, humidity, and battery sensors, and none of its infrared channels are usable.
- **Tuya TS1201 / MOES UFO-R11** — needs nothing from this directory. It uses the `zhaquirks.tuya.ts1201.ZosungIRBlaster` quirk that ships with Home Assistant, so there is no custom file to install.

## Install the ZG-IR01 quirk

1. Copy `zg_ir01.py` into a custom quirks folder on your Home Assistant instance, for example `/config/custom_zha_quirks/zg_ir01.py`. Keep the file name exactly `zg_ir01.py`.
2. Tell ZHA where to find it in `configuration.yaml`:

```yaml
zha:
  custom_quirks_path: /config/custom_zha_quirks/
```

3. Restart Home Assistant. Custom quirks load at startup; a device reconfigure alone does not load new quirk code.
4. Open the ZG-IR01 device page and choose **Reconfigure** if the new entities do not appear on their own.

To confirm the quirk applied, open the device page, then **Zigbee info**. The **Quirk** field names the `zg_ir01` quirk class. If it is blank, check the Home Assistant log for `zhaquirks` errors.

## What the ZG-IR01 quirk does

The device has 6 infrared channels, each with an on and an off code stored on the device (12 slots). Set a channel's `... code` select to `study`, press the original remote button, and the device stores the code and reports `registered`. Toggle the matching switch to fire a stored code.

The quirk also exposes raw-code learning and transmission through Zosung clusters `0xE004` and `0xED00`. That raw path is what Imprint Refinery's `hobeian_zg_ir01` compatibility driver uses. The quirk owns the device-specific transfer behavior, including its Broadlink timing conversion, so learned codes replay at the correct speed on other emitters.

The built-in temperature, humidity, and battery sensors stay available as native entities.

## Notes

- Infrared is one-way. The device never hears back from the target, so a switch state in Home Assistant is an assumption and can drift when the original remote is also used. Fire codes with explicit `switch.turn_on` or `switch.turn_off` actions when the current state matters.
- Air conditioner remotes send the complete state in every press. Learn the few full states you actually use instead of trying to clone the whole remote.
- This quirk intentionally matches only the tested `HOBEIAN` / `ZG-IR01` identity. Similar-looking devices need their own validation.
- `zg_ir01.py` is vendored here byte for byte from its development repository so users can diff the installed file against the published one. Behavior changes land there first and are copied here unchanged.
