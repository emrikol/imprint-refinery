"""Remote controls projected from saved signals."""

import asyncio
from collections.abc import Iterable
from typing import Any

from homeassistant.components.remote import (
    ATTR_DELAY_SECS,
    ATTR_HOLD_SECS,
    ATTR_NUM_REPEATS,
    DEFAULT_DELAY_SECS,
    DEFAULT_HOLD_SECS,
    DEFAULT_NUM_REPEATS,
    RemoteEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .consumer import AssumedPower, LibraryEntity, async_install_projection

REMOTE_DOMAIN = "remote"


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    await async_install_projection(
        hass,
        entry,
        async_add_entities,
        runtime_key="remote_projection",
        entity_domain=REMOTE_DOMAIN,
        build_entity=SignalRemote,
    )


class SignalRemote(
    AssumedPower,
    LibraryEntity,
    RemoteEntity,
    RestoreEntity,
):
    """Optimistic remote that exposes every stored command id."""

    async def async_send_command(self, command: Iterable[str], **kwargs: Any) -> None:
        command_ids = tuple(command)
        if not command_ids:
            return
        repeats = int(kwargs.get(ATTR_NUM_REPEATS, DEFAULT_NUM_REPEATS))
        delay = float(kwargs.get(ATTR_DELAY_SECS, DEFAULT_DELAY_SECS))
        hold = float(kwargs.get(ATTR_HOLD_SECS, DEFAULT_HOLD_SECS))
        if hold:
            raise ServiceValidationError(
                "Imprint Refinery cannot infer hold behavior from a saved waveform; "
                "use Repeats and Delay seconds instead"
            )
        for repetition in range(repeats):
            for saved_signal in command_ids:
                await self.async_send_stored_command(saved_signal)
                self._record_power_command(saved_signal)
            if repetition < repeats - 1:
                await asyncio.sleep(delay)

    def _record_power_command(self, command_id: str) -> None:
        """Keep optimistic power state aligned with native remote sends."""
        roles = self._blueprint.roles
        if command_id == roles.get("power_on") and not self._is_on:
            self._publish_power(True)
        elif command_id == roles.get("power_off") and self._is_on:
            self._publish_power(False)
        elif command_id == roles.get("power_toggle"):
            self._publish_power(not self._is_on)
