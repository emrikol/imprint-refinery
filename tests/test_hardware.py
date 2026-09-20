"""Hardware-neutral Home Assistant infrared routing tests."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from homeassistant.components.infrared import InfraredReceivedSignal

from custom_components.imprint_refinery.hardware import (
    InfraredHardware,
    discover_home_assistant_emitters,
)
from custom_components.imprint_refinery.ir_formats import IRSignal
from custom_components.imprint_refinery.signal_command import RawSignalCommand


def test_native_discovery_pairs_entities_by_device_and_skips_our_bridge(
    monkeypatch,
) -> None:
    emitter = SimpleNamespace(
        id="emitter-uuid",
        entity_id="infrared.living_room_emitter",
        platform="esphome",
        device_id="device-1",
        config_entry_id="config-1",
        name=None,
        original_name="Emitter",
    )
    receiver = SimpleNamespace(
        id="receiver-uuid",
        entity_id="infrared.living_room_receiver",
        platform="esphome",
        device_id="device-1",
        config_entry_id="config-1",
    )
    own_emitter = SimpleNamespace(
        id="own-uuid",
        entity_id="infrared.imprint_bridge",
        platform="imprint_refinery",
        device_id="device-2",
        config_entry_id="config-2",
    )
    entries = {
        emitter.entity_id: emitter,
        receiver.entity_id: receiver,
        own_emitter.entity_id: own_emitter,
    }
    registry = SimpleNamespace(async_get=lambda entity_id: entries.get(entity_id))
    device = SimpleNamespace(
        name_by_user="Living room IR",
        name="Fallback",
        manufacturer="Example",
        model="IR-1",
    )
    devices = SimpleNamespace(
        async_get=lambda device_id: device if device_id == "device-1" else None
    )
    hass = SimpleNamespace(
        states=SimpleNamespace(get=lambda entity_id: SimpleNamespace(name="State name"))
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.er.async_get",
        lambda candidate: registry,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.dr.async_get",
        lambda candidate: devices,
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_get_emitters",
        lambda candidate: [emitter.entity_id, own_emitter.entity_id],
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_get_receivers",
        lambda candidate: [receiver.entity_id],
    )

    assert discover_home_assistant_emitters(hass) == [
        {
            "key": "ha_emitteruuid",
            "transport": "home_assistant_ir",
            "entity_id": "emitter-uuid",
            "receiver_entity_id": "receiver-uuid",
            "name": "Living room IR",
            "name_authoritative": True,
            "manufacturer": "Example",
            "model": "IR-1",
            "can_capture": True,
        }
    ]


def test_native_send_passes_raw_timings_to_home_assistant(monkeypatch) -> None:
    send = AsyncMock()
    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_send_command",
        send,
    )
    signal = IRSignal([9000, 4500, 560, 560], 38_000)
    hass = object()

    asyncio.run(
        InfraredHardware(hass).send(
            {"transport": "home_assistant_ir", "entity_id": "emitter-uuid"},
            signal,
        )
    )

    command = send.await_args.args[2]
    assert send.await_args.args[:2] == (hass, "emitter-uuid")
    assert isinstance(command, RawSignalCommand)
    assert command.get_raw_timings() == [9000, -4500, 560, -560]


def test_native_capture_subscribes_once_and_preserves_measured_carrier(
    monkeypatch,
) -> None:
    unsubscribed: list[bool] = []

    def subscribe(hass, receiver, callback):
        assert receiver == "receiver-uuid"
        asyncio.get_running_loop().call_soon(
            callback,
            InfraredReceivedSignal([9000, -4500, 560, -1690], 40_000),
        )
        return lambda: unsubscribed.append(True)

    monkeypatch.setattr(
        "custom_components.imprint_refinery.hardware.infrared.async_subscribe_receiver",
        subscribe,
    )

    signal, carrier_source = asyncio.run(
        InfraredHardware(object()).capture(
            {
                "transport": "home_assistant_ir",
                "receiver_entity_id": "receiver-uuid",
            },
            timeout=1,
            poll_interval=1,
        )
    )

    assert signal == IRSignal([9000, 4500, 560, 1690], 40_000)
    assert carrier_source == "measured"
    assert unsubscribed == [True]
