"""Tests for the optional ZHA compatibility bridge."""

import asyncio
from dataclasses import replace
import sys
import types as module_types
from types import SimpleNamespace

import pytest

from custom_components.imprint_refinery.const import (
    DEFAULT_CLUSTER_ID,
    ERROR_CLUSTER_NOT_FOUND,
    ERROR_SEND_FAILED,
    ERROR_ZHA_UNAVAILABLE,
)
from custom_components.imprint_refinery.errors import ImprintRefineryError
from custom_components.imprint_refinery.ir_formats import (
    IRSignal,
    broadlink_encode,
    zosung_encode,
)
from custom_components.imprint_refinery.zha_bridge import (
    ZhaBridge,
    cluster_from_proxy,
    discover_zha_driver,
    find_zha_device,
    zha_proxy,
)


def test_registry_lookup_is_scoped_to_a_zha_config_entry(monkeypatch) -> None:
    device = SimpleNamespace(id="zha-device-1")
    calls = []
    registry = SimpleNamespace(
        async_get_device_by_identifier=lambda identifier, entry_id: (
            calls.append((identifier, entry_id)) or device
        )
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(
            async_entries=lambda domain: [SimpleNamespace(entry_id="zha-entry-1")]
        )
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.dr.async_get",
        lambda candidate: registry,
    )

    assert find_zha_device(hass, "aabbccdd") is device
    assert calls == [(("zha", "aabbccdd"), "zha-entry-1")]


def test_registry_lookup_accepts_a_colon_delimited_ieee(monkeypatch) -> None:
    device = SimpleNamespace(id="zha-device-1")
    registry = SimpleNamespace(
        async_get_device_by_identifier=lambda identifier, entry_id: (
            device if identifier == ("zha", "aabbccdd") else None
        )
    )
    hass = SimpleNamespace(
        config_entries=SimpleNamespace(
            async_entries=lambda domain: [SimpleNamespace(entry_id="zha-entry-1")]
        )
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.dr.async_get",
        lambda candidate: registry,
    )

    assert find_zha_device(hass, "AA:BB:CC:DD") is device


def test_proxy_helper_result_is_returned(monkeypatch) -> None:
    helpers = module_types.ModuleType("homeassistant.components.zha.helpers")
    helpers.async_get_zha_device_proxy = lambda hass, device_id: ("proxy", device_id)
    monkeypatch.setitem(sys.modules, "homeassistant.components.zha.helpers", helpers)

    assert zha_proxy(object(), "dev-1") == ("proxy", "dev-1")


def test_proxy_helper_failures_become_public_transport_errors(monkeypatch) -> None:
    helpers = module_types.ModuleType("homeassistant.components.zha.helpers")
    helpers.async_get_zha_device_proxy = lambda hass, device_id: (_ for _ in ()).throw(
        RuntimeError("unavailable")
    )
    monkeypatch.setitem(sys.modules, "homeassistant.components.zha.helpers", helpers)

    with pytest.raises(ImprintRefineryError) as error:
        zha_proxy(object(), "dev-1")
    assert error.value.code == ERROR_ZHA_UNAVAILABLE


def _wrapped_proxy(cluster=None):
    if cluster is None:
        cluster = object()
    endpoint = SimpleNamespace(in_clusters={DEFAULT_CLUSTER_ID: cluster})
    device = SimpleNamespace(endpoints={1: endpoint})
    return SimpleNamespace(device=device), cluster


def test_cluster_resolution_walks_wrapped_device() -> None:
    proxy, cluster = _wrapped_proxy()
    assert cluster_from_proxy(proxy, 1, DEFAULT_CLUSTER_ID) is cluster


def test_cluster_resolution_supports_named_zosung_cluster() -> None:
    cluster = SimpleNamespace(cluster_id=DEFAULT_CLUSTER_ID)
    endpoint = SimpleNamespace(in_clusters={}, zosung_ircontrol=cluster)
    proxy = SimpleNamespace(device=SimpleNamespace(endpoints={1: endpoint}))
    assert cluster_from_proxy(proxy, 1, DEFAULT_CLUSTER_ID) is cluster


def test_cluster_resolution_rejects_missing_cluster() -> None:
    proxy = SimpleNamespace(endpoints={})
    with pytest.raises(ImprintRefineryError) as error:
        cluster_from_proxy(proxy, 1, DEFAULT_CLUSTER_ID)
    assert error.value.code == ERROR_CLUSTER_NOT_FOUND


def test_cluster_resolution_rejects_unknown_proxy_shape() -> None:
    with pytest.raises(ImprintRefineryError) as error:
        cluster_from_proxy(object(), 1, DEFAULT_CLUSTER_ID)
    assert error.value.code == ERROR_ZHA_UNAVAILABLE


def test_driver_discovery_returns_matching_endpoint() -> None:
    proxy, _ = _wrapped_proxy()
    assert discover_zha_driver(proxy) == ("zosung_ts1201", 1, DEFAULT_CLUSTER_ID)


def test_driver_discovery_selects_hobeian_broadlink_variant() -> None:
    proxy, _ = _wrapped_proxy()
    assert discover_zha_driver(
        proxy,
        manufacturer="HOBEIAN",
        model="ZG-IR01",
    ) == ("hobeian_zg_ir01", 1, DEFAULT_CLUSTER_ID)


def _emitter() -> dict:
    return {
        "ieee": "00:11",
        "driver": "zosung_ts1201",
        "transport": "zha_bridge",
        "config": {"endpoint_id": 1, "control_cluster": DEFAULT_CLUSTER_ID},
    }


class _ControlCluster:
    def __init__(self, harness) -> None:
        self._harness = harness
        self.endpoint = None

    async def command(self, command_id, **params) -> None:
        device = self._harness.device
        device.seq = (
            (device.seq + 1) % 0x10000
            if self._harness.send_sequence is None
            else self._harness.send_sequence
        )
        code = params.get("code")
        if code is not None:
            device.ir_msg_to_send[device.seq] = (
                '{"key_num":1,"delay":300,"key1":'
                f'{{"num":1,"freq":38000,"type":1,"key_code":"{code}"}}}}'
            )
        self._harness.calls.append((command_id, params, device.seq))
        if self._harness.complete_during_send:
            self._harness.complete(device.seq)


class _TransmitCluster:
    def __init__(self, harness) -> None:
        self._harness = harness

    def add_listener(self, listener) -> None:
        self._harness.listeners.append(listener)

    def remove_listener(self, listener) -> None:
        self._harness.listeners.remove(listener)


class _ZosungHarness:
    def __init__(
        self,
        start_sequence: int = 0,
        *,
        complete_during_send: bool = False,
        send_sequence: int | None = None,
    ) -> None:
        self.device = SimpleNamespace(seq=start_sequence, ir_msg_to_send={})
        self.calls = []
        self.listeners = []
        self.complete_during_send = complete_during_send
        self.send_sequence = send_sequence
        control = _ControlCluster(self)
        transmit = _TransmitCluster(self)
        endpoint = SimpleNamespace(
            device=self.device,
            in_clusters={DEFAULT_CLUSTER_ID: control, 0xED00: transmit},
        )
        control.endpoint = endpoint
        self.device.endpoints = {1: endpoint}
        self.proxy = SimpleNamespace(device=self.device)

    def install(self, monkeypatch) -> None:
        monkeypatch.setattr(
            "custom_components.imprint_refinery.zha_bridge.find_zha_device",
            lambda hass, ieee: SimpleNamespace(id="dev-1"),
        )
        monkeypatch.setattr(
            "custom_components.imprint_refinery.zha_bridge.zha_proxy",
            lambda hass, device_id: self.proxy,
        )

    def complete(self, sequence: int, command_id: int = 4) -> None:
        for listener in tuple(self.listeners):
            listener.cluster_command(1, command_id, SimpleNamespace(seq=sequence))

    def request_chunk(self, sequence: int, position: int) -> None:
        for listener in tuple(self.listeners):
            listener.cluster_command(
                1,
                2,
                SimpleNamespace(seq=sequence, position=position),
            )

    async def wait_for_calls(self, count: int) -> None:
        async def wait() -> None:
            while len(self.calls) < count:
                await asyncio.sleep(0)

        await asyncio.wait_for(wait(), timeout=1)


def test_send_converts_canonical_timings_only_at_the_driver_boundary(
    monkeypatch,
) -> None:
    harness = _ZosungHarness(0xFFFF, complete_during_send=True)
    harness.install(monkeypatch)
    signal = IRSignal([9000, 4500, 560, 560], 38_000)

    asyncio.run(ZhaBridge(object()).send(_emitter(), signal))

    assert harness.calls == [(2, {"code": zosung_encode(signal)}, 0)]
    assert harness.listeners == []


def test_hobeian_send_uses_broadlink_timing_packets(monkeypatch) -> None:
    harness = _ZosungHarness(0xFFFF, complete_during_send=True)
    harness.install(monkeypatch)
    signal = IRSignal([9000, 4500, 560, 560], 38_000)
    emitter = _emitter() | {"driver": "hobeian_zg_ir01"}

    asyncio.run(ZhaBridge(object()).send(emitter, signal))

    assert harness.calls == [(2, {"code": broadlink_encode(signal)}, 0)]


def test_send_waits_for_the_matching_zosung_completion_frame(monkeypatch) -> None:
    async def scenario() -> None:
        harness = _ZosungHarness(40)
        harness.install(monkeypatch)
        task = asyncio.create_task(
            ZhaBridge(object()).send(
                _emitter(), IRSignal([9000, 4500, 560, 560], 38_000)
            )
        )
        await harness.wait_for_calls(1)
        assert not task.done()

        harness.complete(40)
        harness.complete(41, command_id=3)
        await asyncio.sleep(0)
        assert not task.done()

        harness.complete(41)
        await task
        assert harness.listeners == []

    asyncio.run(scenario())


def test_send_uses_the_sequence_chosen_by_a_fixed_sequence_device(monkeypatch) -> None:
    async def scenario() -> None:
        harness = _ZosungHarness(40, send_sequence=0)
        harness.install(monkeypatch)
        task = asyncio.create_task(
            ZhaBridge(object()).send(
                _emitter(), IRSignal([9000, 4500, 560, 560], 38_000)
            )
        )
        await harness.wait_for_calls(1)
        assert harness.calls[0][2] == 0
        harness.complete(0)
        await task

    asyncio.run(scenario())


def test_hobeian_send_completes_after_the_device_consumes_the_message(
    monkeypatch,
) -> None:
    async def scenario() -> None:
        harness = _ZosungHarness(40, send_sequence=0)
        harness.install(monkeypatch)
        emitter = _emitter() | {"driver": "hobeian_zg_ir01"}
        task = asyncio.create_task(
            ZhaBridge(object()).send(
                emitter,
                IRSignal([9000, 4500, 560, 560], 38_000),
            )
        )
        await harness.wait_for_calls(1)
        message_length = len(harness.device.ir_msg_to_send[0])
        harness.request_chunk(0, message_length - 1)
        await asyncio.sleep(0)
        assert not task.done()

        harness.request_chunk(0, message_length)
        await task
        assert harness.listeners == []

    asyncio.run(scenario())


def test_send_timeout_is_visible_and_removes_the_completion_listener(
    monkeypatch,
) -> None:
    harness = _ZosungHarness(7)
    harness.install(monkeypatch)
    driver = ZhaBridge.driver(_emitter())
    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.get_zha_driver",
        lambda driver_id: replace(driver, send_completion_timeout=0.01),
    )

    with pytest.raises(ImprintRefineryError) as error:
        asyncio.run(
            ZhaBridge(object()).send(
                _emitter(), IRSignal([9000, 4500, 560, 560], 38_000)
            )
        )

    assert error.value.code == ERROR_SEND_FAILED
    assert "did not confirm" in error.value.message
    assert harness.listeners == []


def test_provider_holds_the_next_send_until_zosung_completion(
    monkeypatch,
) -> None:
    async def scenario() -> None:
        harness = _ZosungHarness()
        harness.install(monkeypatch)
        bridge = ZhaBridge(object())
        signal = IRSignal([9000, 4500, 560, 560], 38_000)

        first = asyncio.create_task(bridge.send(_emitter(), signal))
        await harness.wait_for_calls(1)
        second = asyncio.create_task(bridge.send(_emitter(), signal))
        await asyncio.sleep(0)
        assert [call[2] for call in harness.calls] == [1]

        harness.complete(1)
        await harness.wait_for_calls(2)
        assert [call[2] for call in harness.calls] == [1, 2]
        assert not second.done()

        harness.complete(2)
        await asyncio.gather(first, second)

    asyncio.run(scenario())


def test_read_last_signal_falls_back_to_attribute_name(monkeypatch) -> None:
    source = IRSignal([9000, 4500, 560, 560], 38_000)

    class Cluster:
        async def read_attributes(self, attributes):
            return (
                ({"last_learned_ir_code": zosung_encode(source)}, {})
                if attributes == ["last_learned_ir_code"]
                else ({}, {0: "unsupported"})
            )

    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.find_zha_device",
        lambda hass, ieee: SimpleNamespace(id="dev-1"),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.zha_proxy",
        lambda hass, device_id: object(),
    )
    monkeypatch.setattr(
        "custom_components.imprint_refinery.zha_bridge.cluster_from_proxy",
        lambda *args, **kwargs: Cluster(),
    )

    result = asyncio.run(ZhaBridge(object()).read_last_signal(_emitter()))

    assert result == source
