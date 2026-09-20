"""Home Assistant infrared emitters backed by the signal library."""

from uuid import uuid4

from homeassistant.components.infrared import (
    InfraredCommand,
    InfraredDeviceClass,
    InfraredEmitterEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import CONF_IEEE, DOMAIN, EMITTER_SUBENTRY_TYPE
from .emitter_identity import normalize_emitter_ref
from .signal_command import LibraryPath, RawSignalCommand, signal_from_infrared_command
from .storage import SignalLibraryStore
from .transmission import SendRoute, SignalQueue


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    add_entities: AddEntitiesCallback,
) -> None:
    """Create one emitter entity for every configured emitter."""
    runtime = hass.data.get(DOMAIN, {})
    library = runtime.get("store")
    signal_queue = runtime.get("signal_queue")
    if library is None or signal_queue is None:
        add_entities([])
        return

    for subentry in entry.get_subentries_of_type(EMITTER_SUBENTRY_TYPE):
        emitter_id = normalize_emitter_ref(subentry.data[CONF_IEEE])
        add_entities(
            [SignalEmitter(library, signal_queue, emitter_id)],
            config_subentry_id=subentry.subentry_id,
        )


class SignalEmitter(InfraredEmitterEntity):
    """Expose a library emitter through Home Assistant's infrared API."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_device_class = InfraredDeviceClass.EMITTER
    _attr_should_poll = False

    def __init__(
        self,
        library: SignalLibraryStore,
        signal_queue: SignalQueue,
        emitter_id: str,
    ) -> None:
        self._library = library
        self._signal_queue = signal_queue
        self._emitter_id = emitter_id
        self._attr_unique_id = emitter_id
        self._attr_device_info = DeviceInfo(identifiers={(DOMAIN, emitter_id)})

    async def async_send_command(self, command: InfraredCommand) -> None:
        """Queue one canonical Home Assistant infrared command."""
        signal = signal_from_infrared_command(command)
        path = command.path if isinstance(command, RawSignalCommand) else LibraryPath()
        await self._signal_queue.submit(
            self._emitter_id,
            self._library.choose_emitter(self._emitter_id),
            signal,
            route=SendRoute(
                token=uuid4().hex,
                emitter=self._emitter_id,
                location=path.location_id,
                appliance=path.appliance_id,
                command=path.command_id,
                origin="entity",
            ),
        )
