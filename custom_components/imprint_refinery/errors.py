"""Errors shared by the integration's service and platform boundaries."""

from collections.abc import Mapping

from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN


class ImprintRefineryError(HomeAssistantError):
    """A user-presentable integration error with a machine-readable code."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        placeholders: Mapping[str, str] | None = None,
    ) -> None:
        translation = dict(placeholders) if placeholders else None
        error_options = {
            "translation_domain": DOMAIN,
            "translation_key": code,
            "translation_placeholders": translation,
        }
        super().__init__(message, **error_options)
        self.code = code
        self.message = message
