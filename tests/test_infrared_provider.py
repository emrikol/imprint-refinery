"""Core infrared provider behavior for compatibility ZHA adapters."""

import asyncio
from types import MappingProxyType, SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.components.infrared import (
    InfraredEmitterEntity,
    InfraredReceivedSignal,
    InfraredReceiverEntity,
)
from homeassistant.config_entries import ConfigSubentry

from custom_components.imprint_refinery import const
from custom_components.imprint_refinery.infrared import (
    SignalEmitter,
    SignalReceiver,
    _adapter_record,
    async_setup_entry,
)
from custom_components.imprint_refinery.ir_formats import IRSignal
from custom_components.imprint_refinery.signal_command import RawSignalCommand


def execute(awaitable):
    return asyncio.run(awaitable)


def adapter() -> dict:
    return {
        "ieee": "aa:bb",
        "driver": "zosung_ts1201",
        "config": {
            "endpoint_id": 1,
            "control_cluster": 0xE004,
            "capture_timeout": 60,
            "capture_reassert_interval": 8,
        },
    }


def subentry() -> ConfigSubentry:
    return ConfigSubentry(
        data=MappingProxyType(
            {
                const.CONF_IEEE: "AA:BB",
                const.CONF_DRIVER: "zosung_ts1201",
                const.CONF_TRANSPORT: const.ZHA_BRIDGE,
                const.CONF_ENDPOINT_ID: 1,
                const.CONF_CLUSTER_ID: 0xE004,
                const.CONF_CAPTURE_TIMEOUT: 60,
                const.CONF_CAPTURE_REASSERT_INTERVAL: 8,
            }
        ),
        subentry_id="adapter-1",
        subentry_type=const.EMITTER_SUBENTRY_TYPE,
        title="Living room IR",
        unique_id="aabb",
    )


def test_setup_exposes_emitter_and_receiver_on_the_source_device(monkeypatch) -> None:
    source = object()
    item = subentry()
    entry = SimpleNamespace(
        get_subentries_of_type=lambda kind: (
            [item] if kind == const.EMITTER_SUBENTRY_TYPE else []
        )
    )
    added = []
    monkeypatch.setattr(
        "custom_components.imprint_refinery.infrared.find_zha_device",
        lambda hass, ieee: source,
    )

    execute(
        async_setup_entry(
            object(),
            entry,
            lambda entities, **kwargs: added.append((entities, kwargs)),
        )
    )

    [(entities, options)] = added
    emitter, receiver = entities
    assert isinstance(emitter, InfraredEmitterEntity)
    assert isinstance(receiver, InfraredReceiverEntity)
    assert emitter.device_entry is source
    assert receiver.device_entry is source
    assert emitter.device_info is None
    assert receiver.device_info is None
    assert options == {"config_subentry_id": "adapter-1"}


def test_existing_generic_adapter_uses_the_hobeian_model_driver() -> None:
    source = SimpleNamespace(manufacturer="HOBEIAN", model="ZG-IR01")

    assert _adapter_record(subentry(), source)["driver"] == "hobeian_zg_ir01"


def test_emitter_delegates_core_command_to_the_vendor_bridge() -> None:
    bridge = SimpleNamespace(send=AsyncMock())
    emitter = SignalEmitter(bridge, adapter(), None)
    signal = IRSignal([9000, 4500, 560, 560], 38_000)

    execute(emitter.async_send_command(RawSignalCommand(signal)))

    bridge.send.assert_awaited_once_with(adapter(), signal)


def test_receiver_preserves_assumed_carrier_provenance_in_core_capture() -> None:
    async def exercise() -> None:
        signal = IRSignal([9000, 4500, 560, 1690], 40_000)
        bridge = SimpleNamespace(capture=AsyncMock(return_value=signal))
        receiver = SignalReceiver(bridge, adapter(), None)
        receiver.entity_id = "infrared.living_room_receiver"
        receiver.async_write_ha_state = lambda: None
        receiver.hass = SimpleNamespace(
            async_create_task=lambda coroutine, name: asyncio.create_task(
                coroutine, name=name
            )
        )
        received = []

        unsubscribe = receiver.async_subscribe_received_signal(received.append)
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        assert received == [InfraredReceivedSignal([9000, -4500, 560, -1690], None)]
        bridge.capture.assert_awaited_once_with(
            adapter(),
            timeout=60 + const.CAPTURE_ARMING_GRACE_SECONDS,
            poll_interval=1,
        )
        unsubscribe()
        unsubscribe()
        assert receiver._subscriber_count == 0

    execute(exercise())


def test_receiver_cancels_vendor_capture_when_the_last_consumer_leaves() -> None:
    async def exercise() -> None:
        started = asyncio.Event()

        async def capture(*args, **kwargs):
            started.set()
            await asyncio.Future()

        receiver = SignalReceiver(
            SimpleNamespace(capture=AsyncMock(side_effect=capture)), adapter(), None
        )
        receiver.entity_id = "infrared.living_room_receiver"
        receiver.hass = SimpleNamespace(
            async_create_task=lambda coroutine, name: asyncio.create_task(
                coroutine, name=name
            )
        )
        unsubscribe = receiver.async_subscribe_received_signal(lambda signal: None)
        await started.wait()
        task = receiver._capture_task

        unsubscribe()
        await asyncio.gather(task, return_exceptions=True)

        assert task.cancelled()

    execute(exercise())


def test_receiver_restarts_after_cancel_and_immediate_resubscribe() -> None:
    async def exercise() -> None:
        first_started = asyncio.Event()
        captured = IRSignal([9000, 4500, 560, 560], 38_000)
        calls = 0

        async def capture(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 1:
                first_started.set()
                await asyncio.Future()
            return captured

        receiver = SignalReceiver(
            SimpleNamespace(capture=AsyncMock(side_effect=capture)), adapter(), None
        )
        receiver.entity_id = "infrared.living_room_receiver"
        receiver.async_write_ha_state = lambda: None
        receiver.hass = SimpleNamespace(
            async_create_task=lambda coroutine, name: asyncio.create_task(
                coroutine, name=name
            )
        )

        remove_first = receiver.async_subscribe_received_signal(lambda signal: None)
        await first_started.wait()
        first_task = receiver._capture_task
        remove_first()

        received = []
        remove_second = receiver.async_subscribe_received_signal(received.append)
        await asyncio.gather(first_task, return_exceptions=True)
        for _ in range(4):
            await asyncio.sleep(0)

        assert calls == 2
        assert received == [InfraredReceivedSignal([9000, -4500, 560, -560], None)]
        remove_second()

    execute(exercise())
