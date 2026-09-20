"""Publish the latest Imprint Refinery operation to interested entities."""

from collections.abc import Callable
from typing import Any

from homeassistant.core import callback
from homeassistant.util import dt as dt_util

from .product_spec import States

Listener = Callable[[], None]

_DETAIL_FIELDS = {
    "action": "last_action",
    "location_id": "last_location_id",
    "appliance_id": "last_appliance_id",
    "command_id": "last_command_id",
    "error": "last_error",
    "error_message": "last_error_message",
    "request_id": "last_request_id",
    "dispatch_status": "last_dispatch_status",
    "emitter_id": "last_emitter_id",
    "queue_wait_ms": "last_queue_wait_ms",
    "command_age_ms": "last_command_age_ms",
    "queue_depth": "last_queue_depth",
    "delivery_confirmed": "delivery_confirmed",
}


class ActivityStatus:
    """Observable snapshot of the most recent operation."""

    def __init__(self) -> None:
        self._state = States.IDLE
        self._attributes = dict.fromkeys(_DETAIL_FIELDS.values())
        self._attributes["last_updated"] = None
        self._listeners: set[Listener] = set()

    @property
    def state(self) -> str:
        return self._state

    @property
    def attributes(self) -> dict[str, Any]:
        return dict(self._attributes)

    @callback
    def async_subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners.add(listener)

        @callback
        def unsubscribe() -> None:
            self._listeners.discard(listener)

        return unsubscribe

    @callback
    def async_set(self, state: str, **details: Any) -> None:
        """Replace the snapshot and notify every subscriber once."""
        unknown = details.keys() - _DETAIL_FIELDS.keys()
        if unknown:
            raise TypeError(f"Unknown status details: {', '.join(sorted(unknown))}")
        self._state = state
        self._attributes = {
            target: details.get(source) for source, target in _DETAIL_FIELDS.items()
        }
        self._attributes["last_updated"] = dt_util.utcnow().isoformat()
        for listener in tuple(self._listeners):
            listener()
