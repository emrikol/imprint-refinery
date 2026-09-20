# Security policy

## Supported versions

Security fixes are provided for the latest published release.

## Report a vulnerability

Use GitHub's **Security** > **Report a vulnerability** form. If private
reporting is unavailable, open an issue asking for a private contact channel
without including vulnerability details.

Please include the affected version, impact, reproduction steps, and any known
workaround. Do not include Home Assistant access tokens, Zigbee addresses, or
exported command libraries.

## Stored data

Imprint Refinery stores learned infrared payloads in Home Assistant. An exported
library may control devices within range of a compatible transmitter, so treat
backups and Home Assistant `.storage` data as private.

The integration does not require Tuya Cloud credentials, Smart Life
credentials, or external API tokens.
