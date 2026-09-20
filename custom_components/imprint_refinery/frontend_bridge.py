"""Mount and unmount the bundled Imprint Refinery frontend in Home Assistant."""

from dataclasses import dataclass
import logging
from pathlib import Path
from typing import Any

from homeassistant.components.lovelace.const import CONF_RESOURCE_TYPE_WS, LOVELACE_DATA
from homeassistant.const import CONF_ID, CONF_TYPE, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.helpers.start import async_at_start

from .const import HUB_TITLE

_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class FrontendAsset:
    url: str
    path: Path
    cache_headers: bool


CARD_URL = "/imprint_refinery/imprint-refinery-card.js"
ICON_URL = "/imprint_refinery/icon.png"
PANEL_PATH = "imprint-refinery"
PANEL_ELEMENT = "imprint-refinery-panel"


def _assets() -> tuple[FrontendAsset, FrontendAsset]:
    root = Path(__file__).parent
    icon = root / "icon.png"
    if not icon.exists():
        icon = root / "brand" / "icon.png"
    return (
        FrontendAsset(CARD_URL, root / "www" / "imprint-refinery-card.js", False),
        FrontendAsset(ICON_URL, icon, True),
    )


async def async_mount_frontend(hass: HomeAssistant) -> bool:
    """Serve frontend assets, register the panel, and reconcile Lovelace."""
    assets = _assets()
    try:
        from homeassistant.components.http import StaticPathConfig

        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(asset.url, str(asset.path), asset.cache_headers)
                for asset in assets
            ]
        )
    except Exception as error:  # noqa: BLE001 - optional frontend surface
        _LOGGER.warning("Could not serve Imprint Refinery assets: %s", error)

    mounted = False
    try:
        from homeassistant.components import panel_custom

        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_PATH,
            webcomponent_name=PANEL_ELEMENT,
            module_url=CARD_URL,
            sidebar_title=HUB_TITLE,
            sidebar_icon="mdi:remote",
            require_admin=False,
            config={"title": HUB_TITLE, "workspace": True},
            handle_safe_area=False,
        )
        mounted = True
    except Exception as error:  # noqa: BLE001 - optional frontend surface
        _LOGGER.warning("Could not mount Imprint Refinery panel: %s", error)

    async def reconcile(_: Any = None) -> None:
        try:
            await async_sync_resource(hass, assets[0].path)
        except Exception as error:  # noqa: BLE001 - optional Lovelace storage
            _LOGGER.debug("Could not reconcile Imprint Refinery resource: %s", error)

    async_at_start(hass, reconcile)
    return mounted


def unmount_frontend(hass: HomeAssistant) -> None:
    """Remove the sidebar panel when the final config entry unloads."""
    try:
        from homeassistant.components import frontend

        frontend.async_remove_panel(hass, PANEL_PATH, warn_if_unknown=False)
    except Exception as error:  # noqa: BLE001 - HA shutdown boundary
        _LOGGER.debug("Could not remove Imprint Refinery panel: %s", error)


def resource_url(_card_path: Path) -> str:
    """Return the one stable resource URL owned by this integration."""
    return CARD_URL


def canonical_resource_url(url: str) -> str:
    return url.partition("?")[0]


async def async_sync_resource(hass: HomeAssistant, card_path: Path) -> None:
    """Ensure Lovelace stores one module entry for the bundled card."""
    lovelace = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace, "resources", None)
    if resources is None or not hasattr(resources, "async_update_item"):
        return
    await resources.async_get_info()
    candidates = [
        item
        for item in tuple(resources.async_items() or ())
        if item.get(CONF_TYPE) == "module"
        and canonical_resource_url(str(item.get(CONF_URL, ""))) == CARD_URL
    ]
    desired = resource_url(card_path)
    if not candidates:
        await resources.async_create_item(
            {CONF_RESOURCE_TYPE_WS: "module", CONF_URL: desired}
        )
        return
    keeper, *extras = candidates
    if keeper.get(CONF_URL) != desired:
        await resources.async_update_item(keeper[CONF_ID], {CONF_URL: desired})
    for item in extras:
        await resources.async_delete_item(item[CONF_ID])
