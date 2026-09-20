"""Bounded, per-emitter queues for infrared transmissions."""

import asyncio
from collections import deque
from collections.abc import Awaitable
from dataclasses import dataclass, field
import time
from typing import Any, Literal, Protocol
from uuid import uuid4

from .const import (
    ERROR_COMMAND_EXPIRED,
    ERROR_QUEUE_FULL,
    ERROR_QUEUE_STOPPED,
    ERROR_SEND_FAILED,
)
from .errors import ImprintRefineryError
from .ir_formats import IRSignal
from .product_spec import States
from .status import ActivityStatus


class SignalTransport(Protocol):
    """Minimal transport accepted by the queue."""

    def send(self, emitter: dict[str, Any], signal: IRSignal) -> Awaitable[None]: ...


@dataclass(frozen=True, slots=True)
class SendRoute:
    """Trace one request from a UI or service to an emitter."""

    token: str
    emitter: str
    location: str | None = None
    appliance: str | None = None
    command: str | None = None
    origin: Literal["entity", "service"] = "service"


@dataclass(frozen=True, slots=True)
class SendResult:
    """Report that Home Assistant handed a signal to the selected emitter."""

    token: str
    emitter: str
    wait_ms: int
    age_ms: int
    depth: int

    @property
    def state(self) -> str:
        return States.SENT_UNCONFIRMED

    @property
    def confirmed(self) -> bool:
        return False

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.state,
            "delivery_confirmed": self.confirmed,
            "request_id": self.token,
            "emitter_id": self.emitter,
            "queue_wait_ms": self.wait_ms,
            "command_age_ms": self.age_ms,
            "queue_depth": self.depth,
        }


@dataclass(slots=True)
class _Envelope:
    device: dict[str, Any]
    signal: IRSignal
    route: SendRoute
    enqueued: float
    answer: asyncio.Future[SendResult]


@dataclass(slots=True)
class _Channel:
    backlog: deque[_Envelope] = field(default_factory=deque)
    active: _Envelope | None = None
    runner: asyncio.Task[None] | None = None

    def size(self) -> int:
        return len(self.backlog) + int(self.active is not None)


class SignalQueue:
    """Keep one ordered queue per emitter and run emitters concurrently."""

    def __init__(
        self,
        transport: SignalTransport,
        status: ActivityStatus,
        *,
        max_age_seconds: float = 3.0,
        capacity: int = 8,
    ) -> None:
        self._transport = transport
        self._status = status
        self._max_age_ms = max_age_seconds * 1_000
        self._capacity = capacity
        self._channels: dict[str, _Channel] = {}
        self._closed = False

    async def submit(
        self,
        emitter: str,
        device: dict[str, Any],
        signal: IRSignal,
        *,
        route: SendRoute | None = None,
    ) -> SendResult:
        """Wait until a payload has been handed to the transport."""
        route = route or SendRoute(uuid4().hex, emitter)
        if self._closed:
            raise ImprintRefineryError(ERROR_QUEUE_STOPPED, "Signal queue is closed")

        channel = self._channels.setdefault(emitter, _Channel())
        if channel.size() >= self._capacity:
            error = ImprintRefineryError(
                ERROR_QUEUE_FULL, f"Signal queue for {emitter} is full"
            )
            self._publish(States.QUEUE_FULL, route, channel.size(), error=error)
            raise error

        envelope = _Envelope(
            device,
            signal,
            route,
            time.monotonic(),
            asyncio.get_running_loop().create_future(),
        )
        channel.backlog.append(envelope)
        self._publish(States.QUEUED, route, channel.size(), age_ms=0)
        if channel.runner is None or channel.runner.done():
            channel.runner = asyncio.create_task(self._drain(emitter, channel))

        try:
            return await envelope.answer
        except asyncio.CancelledError:
            if envelope in channel.backlog:
                channel.backlog.remove(envelope)
            if channel.active is None and not channel.backlog:
                self._discard_idle(emitter, channel)
            raise

    def close(self) -> None:
        """Reject queued work while allowing an in-flight transmission to finish."""
        self._closed = True
        error = ImprintRefineryError(ERROR_QUEUE_STOPPED, "Signal queue was closed")
        for emitter, channel in tuple(self._channels.items()):
            while channel.backlog:
                envelope = channel.backlog.popleft()
                if not envelope.answer.done():
                    envelope.answer.set_exception(error)
                self._publish(
                    States.STOPPED,
                    envelope.route,
                    channel.size(),
                    error=error,
                )
            if channel.active is None:
                self._discard_idle(emitter, channel)

    async def _drain(self, emitter: str, channel: _Channel) -> None:
        try:
            while channel.backlog:
                await asyncio.sleep(0)
                while channel.backlog and channel.backlog[0].answer.cancelled():
                    channel.backlog.popleft()
                if not channel.backlog:
                    return
                channel.active = channel.backlog.popleft()
                await self._deliver(channel.active, channel.size())
                channel.active = None
        finally:
            if self._channels.get(emitter) is channel:
                if channel.backlog and not self._closed:
                    channel.runner = asyncio.create_task(self._drain(emitter, channel))
                elif channel.active is None:
                    self._channels.pop(emitter, None)

    async def _deliver(self, envelope: _Envelope, depth: int) -> None:
        waited = _elapsed_ms(envelope.enqueued)
        if waited > self._max_age_ms:
            error = ImprintRefineryError(
                ERROR_COMMAND_EXPIRED, "Signal expired while waiting to transmit"
            )
            self._publish(
                States.EXPIRED, envelope.route, depth, age_ms=waited, error=error
            )
            _reject(envelope, error)
            return

        self._publish(
            States.DISPATCHING,
            envelope.route,
            depth,
            wait_ms=waited,
            age_ms=waited,
        )
        try:
            await self._transport.send(envelope.device, envelope.signal)
        except Exception as caught:  # noqa: BLE001 - transport normalization boundary
            detail = (
                caught.message
                if isinstance(caught, ImprintRefineryError)
                else str(caught)
            )
            error = ImprintRefineryError(ERROR_SEND_FAILED, f"IR send failed: {detail}")
            self._publish(
                States.DELIVERY_FAILED,
                envelope.route,
                depth,
                age_ms=_elapsed_ms(envelope.enqueued),
                error=error,
            )
            _reject(envelope, error)
            return

        result = SendResult(
            envelope.route.token,
            envelope.route.emitter,
            waited,
            _elapsed_ms(envelope.enqueued),
            depth,
        )
        self._publish(
            result.state,
            envelope.route,
            depth,
            wait_ms=result.wait_ms,
            age_ms=result.age_ms,
            confirmed=result.confirmed,
        )
        if not envelope.answer.done():
            envelope.answer.set_result(result)

    def _discard_idle(self, emitter: str, channel: _Channel) -> None:
        if channel.runner is not None and not channel.runner.done():
            channel.runner.cancel()
        if self._channels.get(emitter) is channel:
            self._channels.pop(emitter, None)

    def _publish(
        self,
        state: str,
        route: SendRoute,
        depth: int,
        *,
        wait_ms: int | None = None,
        age_ms: int | None = None,
        confirmed: bool | None = None,
        error: ImprintRefineryError | None = None,
    ) -> None:
        self._status.async_set(
            state,
            action="dispatch",
            location_id=route.location,
            appliance_id=route.appliance,
            command_id=route.command,
            error=error.code if error else None,
            error_message=error.message if error else None,
            request_id=route.token,
            dispatch_status=state,
            emitter_id=route.emitter,
            queue_wait_ms=wait_ms,
            command_age_ms=age_ms,
            queue_depth=depth,
            delivery_confirmed=confirmed,
        )


def _reject(envelope: _Envelope, error: ImprintRefineryError) -> None:
    if not envelope.answer.done():
        envelope.answer.set_exception(error)


def _elapsed_ms(started: float) -> int:
    return max(0, round((time.monotonic() - started) * 1_000))
