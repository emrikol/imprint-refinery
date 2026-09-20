"""Concurrency and failure contract for the bounded signal queue."""

import asyncio
from collections.abc import Callable

import pytest

from custom_components.imprint_refinery.const import (
    ERROR_COMMAND_EXPIRED,
    ERROR_QUEUE_FULL,
    ERROR_QUEUE_STOPPED,
    ERROR_SEND_FAILED,
)
from custom_components.imprint_refinery.errors import ImprintRefineryError
from custom_components.imprint_refinery.product_spec import States
from custom_components.imprint_refinery.transmission import SendRoute, SignalQueue


class EventLog:
    def __init__(self) -> None:
        self.items: list[tuple[str, dict]] = []

    def async_set(self, state: str, **details) -> None:
        self.items.append((state, details))


def route(emitter: str, token: str) -> SendRoute:
    return SendRoute(
        token=token,
        emitter=emitter,
        location="den",
        appliance="fan",
        command="toggle",
    )


async def eventually(condition: Callable[[], bool]) -> None:
    for _ in range(1_000):
        if condition():
            return
        await asyncio.sleep(0)
    raise AssertionError("condition did not become true")


def run(coroutine):
    return asyncio.run(coroutine)


def test_one_emitter_is_serial_while_two_emitters_can_overlap() -> None:
    async def scenario() -> None:
        releases = {"left": asyncio.Event(), "right": asyncio.Event()}
        active: dict[str, int] = {"left": 0, "right": 0}
        peaks: dict[str, int] = {"left": 0, "right": 0}
        global_peak = 0

        class Transport:
            async def send(self, device, payload) -> None:
                nonlocal global_peak
                key = device["key"]
                active[key] += 1
                peaks[key] = max(peaks[key], active[key])
                global_peak = max(global_peak, sum(active.values()))
                await releases[key].wait()
                active[key] -= 1

        queue = SignalQueue(Transport(), EventLog())
        tasks = [
            asyncio.create_task(queue.submit("left", {"key": "left"}, "a")),
            asyncio.create_task(queue.submit("left", {"key": "left"}, "b")),
            asyncio.create_task(queue.submit("right", {"key": "right"}, "c")),
        ]
        await eventually(lambda: active == {"left": 1, "right": 1})
        releases["left"].set()
        releases["right"].set()
        await asyncio.gather(*tasks)

        assert peaks == {"left": 1, "right": 1}
        assert global_peak == 2

    run(scenario())


def test_success_result_and_status_share_trace_metadata() -> None:
    async def scenario() -> None:
        class Transport:
            async def send(self, device, payload) -> None:
                assert device == {"ieee": "00:11"}
                assert payload == "encoded"

        status = EventLog()
        queue = SignalQueue(Transport(), status)
        result = await queue.submit(
            "hall",
            {"ieee": "00:11"},
            "encoded",
            route=route("hall", "trace-7"),
        )

        assert result.to_dict()["request_id"] == "trace-7"
        assert result.state == States.SENT_UNCONFIRMED
        assert result.confirmed is False
        state, details = status.items[-1]
        assert state == States.SENT_UNCONFIRMED
        assert details["location_id"] == "den"
        assert details["delivery_confirmed"] is False

    run(scenario())


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        (RuntimeError("radio refused"), ERROR_SEND_FAILED),
        (ImprintRefineryError("transport_detail", "bad frame"), ERROR_SEND_FAILED),
    ],
)
def test_transport_failures_are_normalized(failure, expected) -> None:
    async def scenario() -> None:
        class Transport:
            async def send(self, device, payload) -> None:
                raise failure

        status = EventLog()
        queue = SignalQueue(Transport(), status)
        with pytest.raises(ImprintRefineryError) as caught:
            await queue.submit("bedroom", {}, "payload")
        assert caught.value.code == expected
        assert status.items[-1][0] == States.DELIVERY_FAILED

    run(scenario())


def test_capacity_counts_active_and_waiting_work() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()

        class Transport:
            async def send(self, device, payload) -> None:
                await gate.wait()

        queue = SignalQueue(Transport(), EventLog(), capacity=2)
        first = asyncio.create_task(queue.submit("one", {}, "first"))
        await asyncio.sleep(0)
        second = asyncio.create_task(queue.submit("one", {}, "second"))
        await asyncio.sleep(0)
        with pytest.raises(ImprintRefineryError) as caught:
            await queue.submit("one", {}, "third")
        assert caught.value.code == ERROR_QUEUE_FULL
        gate.set()
        await asyncio.gather(first, second)

    run(scenario())


def test_expired_waiter_is_never_sent(monkeypatch) -> None:
    async def scenario() -> None:
        sent: list[str] = []

        class Transport:
            async def send(self, device, payload) -> None:
                sent.append(payload)

        monkeypatch.setattr(
            "custom_components.imprint_refinery.transmission._elapsed_ms",
            lambda started: 1_000,
        )
        queue = SignalQueue(Transport(), EventLog(), max_age_seconds=0.25)
        with pytest.raises(ImprintRefineryError) as caught:
            await queue.submit("patio", {}, "stale")
        assert caught.value.code == ERROR_COMMAND_EXPIRED
        assert sent == []

    run(scenario())


def test_close_rejects_waiters_and_future_submissions() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()
        started = asyncio.Event()

        class Transport:
            async def send(self, device, payload) -> None:
                started.set()
                await gate.wait()

        queue = SignalQueue(Transport(), EventLog())
        active = asyncio.create_task(queue.submit("office", {}, "active"))
        await started.wait()
        waiting = asyncio.create_task(queue.submit("office", {}, "waiting"))
        await asyncio.sleep(0)
        queue.close()
        with pytest.raises(ImprintRefineryError) as waiting_error:
            await waiting
        assert waiting_error.value.code == ERROR_QUEUE_STOPPED
        with pytest.raises(ImprintRefineryError) as future_error:
            await queue.submit("office", {}, "future")
        assert future_error.value.code == ERROR_QUEUE_STOPPED
        gate.set()
        assert (await active).state == States.SENT_UNCONFIRMED

    run(scenario())


def test_cancelled_waiter_is_removed_without_reaching_transport() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()
        sent: list[str] = []

        class Transport:
            async def send(self, device, payload) -> None:
                sent.append(payload)
                if payload == "first":
                    await gate.wait()

        queue = SignalQueue(Transport(), EventLog())
        first = asyncio.create_task(queue.submit("kitchen", {}, "first"))
        await asyncio.sleep(0)
        cancelled = asyncio.create_task(queue.submit("kitchen", {}, "cancelled"))
        await asyncio.sleep(0)
        cancelled.cancel()
        with pytest.raises(asyncio.CancelledError):
            await cancelled
        gate.set()
        await first
        await asyncio.sleep(0)
        assert sent == ["first"]

    run(scenario())
