# Contributing

Bug reports and focused pull requests are welcome. Imprint Refinery uses Home
Assistant's native infrared entity contract. Please keep changes hardware
neutral and usable without a vendor cloud account.

## Report a problem

Include the following information when it is relevant:

- Home Assistant version
- Device model and manufacturer string
- Infrared integration and device model
- Active ZHA quirk, when using the optional ZHA bridge
- What you expected and what happened
- A short, relevant log excerpt

Do not post access tokens, Zigbee addresses, complete Home Assistant logs, or
exported command libraries.

## Development setup

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-dev.txt
npm ci --ignore-scripts
git config core.hooksPath .githooks
```

Use Python 3.14.2 or newer, which matches Home Assistant 2026.9.

Copy or mount `custom_components/imprint_refinery` into a Home Assistant test
instance. Restart Home Assistant and add the integration through the UI.

## Checks

Run the complete local suite before opening a pull request:

```bash
python3 -m ruff check .
python3 -m ruff format --check .
python3 tools/check_repository.py
npm run typecheck
python3 -m pytest -q
npm run build
npm run smoke:browser
```

The committed Git hook enforces the release gate without installing a hook
framework. A commit that changes the integration version must include a staged,
dated `CHANGELOG.md` entry for that version. CI checks the same changelog
requirements again when a version tag is pushed.

Python follows the Home Assistant Core Ruff profile where it applies to a
standalone custom integration. User-facing documentation follows the
[Home Assistant documentation style guide](https://developers.home-assistant.io/docs/documenting/general-style-guide/):
use American English, sentence-style capitalization, and platform-neutral
instructions.

Check UI changes in Home Assistant at desktop and phone widths. Hardware or
transport changes also need a real learn-and-send check on the affected device.

## Project boundaries

- Keep vendor-specific ZHA facts in `zha_drivers.py` and bridge behavior in
  `zha_bridge.py`.
- Keep stored commands independent of hardware transports.
- Keep the library model independent of Home Assistant.
- Preserve command IDs across ordinary edits so automations remain stable.
- Keep capture, catalog, and editing operations inside the authenticated panel
  API. The public Home Assistant action surface should stay small.
- Do not add cloud services to the normal capture, storage, or send path.
- Do not commit site data, credentials, device addresses, captured household
  commands, or Home Assistant storage files.

See [Architecture](docs/ARCHITECTURE.md) for the runtime boundaries.

## Pull requests

Keep each pull request focused. Add or update tests for behavior changes and
explain any user-visible change in the changelog. New hardware support should
use Home Assistant infrared entities when possible. Add a compatibility driver
only when the device cannot expose that contract.

The source language is English. Community translations are welcome when a
speaker can review them in Home Assistant; machine-generated translations are
not accepted.

## Release checklist

Before publishing a release:

1. Update the version in `manifest.json`, `package.json`, the frontend banner,
   and `CHANGELOG.md`.
2. Run the complete test and build suite.
3. Check the repository for secrets, private data, and unexpected generated
   files.
4. Tag the release commit as `vX.Y.Z`.
5. Create a non-draft GitHub Release from the same tag.

HACS uses the latest GitHub Release as the released version. A tag by itself is
not enough.
