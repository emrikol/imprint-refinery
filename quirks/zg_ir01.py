"""Custom ZHA quirk for the HOBEIAN ZG-IR01 Tuya Zigbee IR blaster.

Device: HOBEIAN / ZG-IR01 ("Smart IR remote switch")

The device exposes two independent IR interfaces:

* Tuya datapoints provide 6 channels, each with an ON and OFF code stored on
  the device (12 slots total).
* Zosung clusters 0xE004 and 0xED00 learn and transmit raw 38 kHz IR codes.

Raw transport deviations are documented in the project README. The quirk owns
these device-specific details, including translation between the standard
Broadlink timebase and this firmware's slower hardware timer.

Workflow:
  * To TEACH a slot: set the matching "Switch N on/off code" select to
    "study", point the original remote at the blaster and press the button.
    The device stores the code; the select reports back "registered".
  * To FIRE a stored code: toggle the matching "Switch N" switch. ON sends
    that channel's "on" code, OFF sends its "off" code.

Mapped datapoints from zigbee-herdsman-converters (HOBEIAN ZG-IR01):
   1-6     switchN          on/off  -> fire channel
   120-131 switchN_on/off   enum    -> per-slot study control

The device's standard clusters provide temperature, humidity, and battery.
Those native entities are retained because DP 109's unit depends on DP 111.

Install:
  1. Copy this file to /config/custom_zha_quirks/
  2. In configuration.yaml:
       zha:
         custom_quirks_path: /config/custom_zha_quirks/
  3. Restart HA, then on the device click "Reconfigure" (or re-pair).
  4. Confirm the device now exposes Switch 1-6 + the "... code" selects.
"""

import asyncio
import base64
from dataclasses import dataclass, field
import json
import logging
from typing import Any

import zigpy.types as t
from zigpy.zcl import foundation
from zigpy.zcl.clusters.general import OnOff

from zhaquirks.device import CustomZigpyDevice
from zhaquirks.tuya.builder import TuyaQuirkBuilder
from zhaquirks.tuya.ts1201 import Bytes, ZosungIRControl, ZosungIRTransmit

_LOGGER = logging.getLogger(__name__)

_MAX_OUTGOING_CHUNK_LENGTH = 0x32
_MAX_QUEUED_SENDS = 8
_OUTGOING_TRANSFER_TIMEOUT = 10.0
_OUTGOING_TRANSFER_QUIET_PERIOD = 0.25
_OUTGOING_TRANSFER_DRAIN_TIMEOUT = 10.0
# Header + maximum timing payload + terminator + transport padding.
_MAX_LEARN_PACKET_LENGTH = 0x1000C

_STANDARD_BROADLINK_TICK_US = 8192 / 269
# This firmware uses Broadlink's packet syntax, but not its 30.454 us timer.
# Physical reference-device measurements fitted 11 repeated widths from 548 us
# through 15.6 ms. Six held-out widths plus two long gaps through 54.8 ms reduced
# median absolute error from 211 us to 15 us and maximum error from 792 us to
# 74 us; independent capture fits agreed with both slopes within 0.15%.
# Ten non-protocol random waveforms (960 edges) then measured corrected-send
# median absolute errors of 19 us for marks and 14.5 us for spaces, with maxima
# of 28 us and 41 us. Normalized learning had one-tick median and two-tick p95
# error; rare larger edge shifts did not repeat under identical timing context.
# Sending applies the affine inverse; learning applies the forward map. Separate
# mark and space fits preserve the measured edge asymmetry without assuming its
# hardware cause.
_MARK_SLOPE_US = 32.25819277359383
_MARK_INTERCEPT_US = -14.598041656083296
_SPACE_SLOPE_US = 32.20106126330876
_SPACE_INTERCEPT_US = 21.875473711191262


def _decode_broadlink_packet(packet: bytes) -> tuple[int, list[int]]:
    """Decode timing ticks from one validated Broadlink IR packet."""
    if len(packet) > _MAX_LEARN_PACKET_LENGTH:
        raise ValueError("ZG-IR01 Broadlink packet exceeds its length limit")
    if len(packet) < 6 or packet[0] != 0x26:
        raise ValueError("ZG-IR01 code is not a Broadlink IR packet")
    payload_length = int.from_bytes(packet[2:4], "little")
    if payload_length == len(packet):
        # Learned ZG-IR01 packets use total packet length and omit the ordinary
        # Broadlink terminator/padding. Normalize this validated device dialect
        # while continuing to require canonical framing from external callers.
        payload = packet[4:]
    else:
        payload_end = 4 + payload_length
        if payload_end + 2 > len(packet):
            raise ValueError("ZG-IR01 Broadlink timing payload is truncated")
        if packet[payload_end : payload_end + 2] != b"\x0d\x05":
            raise ValueError("ZG-IR01 Broadlink packet terminator is missing")
        if any(packet[payload_end + 2 :]):
            raise ValueError("ZG-IR01 Broadlink packet has nonzero trailing data")
        payload = packet[4:payload_end]
    timings: list[int] = []
    position = 0
    while position < len(payload):
        value = payload[position]
        position += 1
        if value == 0:
            if position + 2 > len(payload):
                raise ValueError("ZG-IR01 Broadlink extended timing is truncated")
            value = int.from_bytes(payload[position : position + 2], "big")
            position += 2
        if value <= 0:
            raise ValueError("ZG-IR01 Broadlink timing must be positive")
        timings.append(value)
    if not timings:
        raise ValueError("ZG-IR01 Broadlink packet has no timings")
    return packet[1], timings


def _encode_broadlink_packet(repeat: int, timings: list[int]) -> bytes:
    """Encode timing ticks as one canonical Broadlink IR packet."""
    payload = bytearray()
    for value in timings:
        if not 0 < value <= 0xFFFF:
            raise ValueError("ZG-IR01 Broadlink timing exceeds its 16-bit range")
        if value < 0x100:
            payload.append(value)
        else:
            payload.extend((0, value >> 8, value & 0xFF))
    if len(payload) > 0xFFFF:
        raise ValueError("ZG-IR01 Broadlink timing payload exceeds its length limit")
    packet = bytearray((0x26, repeat, len(payload) & 0xFF, len(payload) >> 8))
    packet.extend(payload)
    packet.extend((0x0D, 0x05))
    while (len(packet) + 4) % 16:
        packet.append(0)
    return bytes(packet)


def _hardware_tick(standard_tick: int, index: int) -> int:
    """Map one standard Broadlink tick to the ZG-IR01 hardware timer."""
    desired_us = standard_tick * _STANDARD_BROADLINK_TICK_US
    if index % 2 == 0:
        slope = _MARK_SLOPE_US
        intercept = _MARK_INTERCEPT_US
    else:
        slope = _SPACE_SLOPE_US
        intercept = _SPACE_INTERCEPT_US
    return max(1, min(0xFFFF, round((desired_us - intercept) / slope)))


def _standard_tick(hardware_tick: int, index: int) -> int:
    """Map one learned ZG-IR01 timer tick to the Broadlink timebase."""
    if index % 2 == 0:
        slope = _MARK_SLOPE_US
        intercept = _MARK_INTERCEPT_US
    else:
        slope = _SPACE_SLOPE_US
        intercept = _SPACE_INTERCEPT_US
    measured_us = intercept + slope * hardware_tick
    return max(
        1,
        min(0xFFFF, round(measured_us / _STANDARD_BROADLINK_TICK_US)),
    )


def _broadlink_code_for_hardware(code: str) -> str:
    """Convert a standard Broadlink code to the ZG-IR01 timer domain."""
    try:
        packet = base64.b64decode(code, validate=True)
    except ValueError as error:
        raise ValueError("ZG-IR01 code is not valid Base64") from error
    repeat, timings = _decode_broadlink_packet(packet)
    transformed = [_hardware_tick(value, index) for index, value in enumerate(timings)]
    return base64.b64encode(_encode_broadlink_packet(repeat, transformed)).decode()


def _broadlink_packet_from_hardware(packet: bytes) -> bytes:
    """Convert a learned ZG-IR01 packet to the standard Broadlink timebase."""
    repeat, timings = _decode_broadlink_packet(packet)
    transformed = [_standard_tick(value, index) for index, value in enumerate(timings)]
    return _encode_broadlink_packet(repeat, transformed)


class _LearnPacket:
    """Assemble bytes at fixed positions until one packet is complete."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.length = 0
        self.data = bytearray()
        self.received = bytearray()

    @property
    def active(self) -> bool:
        return self.length > 0

    @property
    def first_missing(self) -> int:
        try:
            return self.received.index(0)
        except ValueError:
            return self.length

    @property
    def complete(self) -> bool:
        return self.active and self.first_missing == self.length

    def start(self, length: int) -> str | None:
        self.reset()
        if length <= 0:
            return "the announced length is empty"
        if length > _MAX_LEARN_PACKET_LENGTH:
            return "the announced length exceeds the Broadlink packet limit"
        self.length = length
        self.data = bytearray(length)
        self.received = bytearray(length)
        return None

    def append(self, position: int, part: bytes, checksum: int) -> str | None:
        if not self.active:
            return "no learned packet is being assembled"
        if not part:
            return "the packet part is empty"
        if checksum != sum(part) % 0x100:
            return "the packet part checksum does not match"
        if position < 0 or position + len(part) > self.length:
            return "the packet part exceeds the announced length"
        for offset, value in enumerate(part, start=position):
            if self.received[offset] and self.data[offset] != value:
                return "the packet part conflicts with bytes already received"
        self.data[position : position + len(part)] = part
        self.received[position : position + len(part)] = b"\x01" * len(part)
        return None

    def finish(self) -> bytes | None:
        return bytes(self.data) if self.complete else None


@dataclass(eq=False, slots=True)
class _OutgoingTransfer:
    """One serialized fixed-sequence transfer owned by the quirk."""

    sequence: int
    message: str
    completed: asyncio.Future[None]
    served: bytearray = field(init=False)
    response_tasks: set[asyncio.Task[None]] = field(default_factory=set)
    activity: int = 0
    request_activity: int = 0
    accepting_requests: bool = True

    def __post_init__(self) -> None:
        """Allocate exact byte-coverage tracking for this transfer."""
        self.served = bytearray(len(self.message))

    @property
    def fully_served(self) -> bool:
        """Return whether every wrapper byte reached the device."""
        return bool(self.served) and 0 not in self.served

    def note_activity(self) -> None:
        """Reset the inactivity deadline after valid firmware progress."""
        self.activity += 1

    def note_request(self) -> None:
        """Record device traffic used only to establish a quiet boundary."""
        self.request_activity += 1

    def mark_served(self, position: int, length: int) -> bool:
        """Record newly delivered bytes and report whether coverage advanced."""
        end = position + length
        advanced = self.served.find(0, position, end) != -1
        self.served[position:end] = b"\x01" * length
        if advanced:
            self.note_activity()
        return advanced


class ZGIR01Device(CustomZigpyDevice):
    """Device state required by the ZG-IR01 Zosung transport."""

    last_learned_ir_code = t.CharacterString("")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initialize per-device transfer state."""
        self.seq = 0
        self.ir_msg_to_send: dict[int, str] = {}
        self._ir_send_lock = asyncio.Lock()
        self._ir_send_callers = 0
        self._ir_send_transfer: _OutgoingTransfer | None = None
        super().__init__(*args, **kwargs)

    def next_seq(self) -> int:
        """Return the fixed transfer sequence required by this firmware."""
        return 0

    def begin_ir_send(self, message: str) -> _OutgoingTransfer:
        """Register the only transfer that may use the fixed sequence."""
        if self._ir_send_transfer is not None:
            raise RuntimeError("a ZG-IR01 transfer is already active")
        transfer = _OutgoingTransfer(
            sequence=self.next_seq(),
            message=message,
            completed=asyncio.get_running_loop().create_future(),
        )
        self._ir_send_transfer = transfer
        self.ir_msg_to_send[transfer.sequence] = message
        return transfer

    def finish_ir_send(
        self,
        transfer: _OutgoingTransfer,
        error: Exception | None = None,
    ) -> None:
        """Complete one transfer without touching a newer sequence-zero send."""
        if self._ir_send_transfer is not transfer:
            return
        if transfer.completed.done():
            return
        if error is None:
            transfer.completed.set_result(None)
        else:
            transfer.completed.set_exception(error)

    def abandon_ir_send(self, transfer: _OutgoingTransfer) -> None:
        """Discard a failed, cancelled, or timed-out transfer."""
        if self._ir_send_transfer is transfer:
            self._ir_send_transfer = None
            if self.ir_msg_to_send.get(transfer.sequence) == transfer.message:
                self.ir_msg_to_send.pop(transfer.sequence, None)
        if not transfer.completed.done():
            transfer.completed.cancel()


class ZGIR01Control(ZosungIRControl):
    """Own and serialize the complete ZG-IR01 send exchange."""

    async def command(self, command_id: Any, *args: Any, **kwargs: Any) -> Any:
        """Wait until the device consumes every byte of an IR send."""
        if command_id == self.ServerCommandDefs.IRLearn.id:
            # This firmware often omits the default response for the study
            # data command. Waiting for it blocks learning for the full
            # request timeout, so send the same payload without that wait.
            payload = Bytes(b'{"study":0}' if kwargs["on_off"] else b'{"study":1}')
            return await super(ZosungIRControl, self).command(
                self.ServerCommandDefs.data.id,
                payload,
                expect_reply=False,
                tsn=kwargs.get("tsn"),
            )
        if command_id != self.ServerCommandDefs.IRSend.id:
            return await super().command(command_id, *args, **kwargs)

        device = self.endpoint.device
        if device._ir_send_callers > _MAX_QUEUED_SENDS:
            raise RuntimeError("ZG-IR01 send queue is full")
        device._ir_send_callers += 1
        try:
            async with device._ir_send_lock:
                return await self._send_ir_code(kwargs)
        finally:
            device._ir_send_callers -= 1

    async def _send_ir_code(self, kwargs: dict[str, Any]) -> foundation.Status:
        """Run one complete, serialized fixed-sequence transfer."""
        device = self.endpoint.device
        code = _broadlink_code_for_hardware(str(kwargs["code"]))
        message = json.dumps(
            {
                "key_num": 1,
                "delay": 300,
                "key1": {
                    "num": 1,
                    "freq": 38000,
                    "type": 1,
                    "key_code": code,
                },
            },
            separators=(",", ":"),
        )
        transfer = device.begin_ir_send(message)
        succeeded = False
        try:
            status = await self.endpoint.zosung_irtransmit.command(
                self.endpoint.zosung_irtransmit.ServerCommandDefs.receive_ir_frame_00.id,
                seq=transfer.sequence,
                length=len(message),
                unk1=0x00000000,
                clusterid=self.cluster_id,
                unk2=0x01,
                cmd=self.ServerCommandDefs.IRSend.id,
                unk3=0x0000,
                expect_reply=False,
                tsn=kwargs.get("tsn"),
            )
            if isinstance(status, foundation.Status) and (
                status != foundation.Status.SUCCESS
            ):
                raise RuntimeError(f"ZG-IR01 send start failed: {status.name}")
            await self._wait_for_completion(transfer)
            succeeded = True
            return foundation.Status.SUCCESS
        finally:
            try:
                await self._drain_transfer(transfer, cancel_pending=not succeeded)
            finally:
                device.abandon_ir_send(transfer)

    @staticmethod
    async def _wait_for_completion(transfer: _OutgoingTransfer) -> None:
        """Wait for completion while progress resets the inactivity deadline."""
        while not transfer.completed.done():
            activity = transfer.activity
            try:
                await asyncio.wait_for(
                    asyncio.shield(transfer.completed),
                    timeout=_OUTGOING_TRANSFER_TIMEOUT,
                )
            except TimeoutError as error:
                if transfer.activity != activity:
                    continue
                raise TimeoutError(
                    "ZG-IR01 did not consume the complete IR transmission"
                ) from error
        await transfer.completed

    @staticmethod
    async def _drain_transfer(
        transfer: _OutgoingTransfer, *, cancel_pending: bool
    ) -> None:
        """Bound cleanup while waiting for a quiet fixed-sequence boundary."""
        transfer.accepting_requests = False
        if cancel_pending:
            for task in tuple(transfer.response_tasks):
                task.cancel()
        try:
            async with asyncio.timeout(_OUTGOING_TRANSFER_DRAIN_TIMEOUT):
                while True:
                    if transfer.response_tasks:
                        await asyncio.gather(
                            *tuple(transfer.response_tasks), return_exceptions=True
                        )
                    request_activity = transfer.request_activity
                    await asyncio.sleep(_OUTGOING_TRANSFER_QUIET_PERIOD)
                    if (
                        request_activity == transfer.request_activity
                        and not transfer.response_tasks
                    ):
                        return
        except TimeoutError:
            _LOGGER.warning("Timed out draining ZG-IR01 transfer responses")
        finally:
            pending = tuple(transfer.response_tasks)
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)


class ZGIR01Transmit(ZosungIRTransmit):
    """Apply the outgoing transfer behavior required by ZG-IR01."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        """Initialize per-cluster outgoing response state."""
        super().__init__(*args, **kwargs)
        self._outgoing_parts_in_flight: set[tuple[int, int]] = set()
        self._learn_packet = _LearnPacket()

    async def command(self, command_id: Any, *args: Any, **kwargs: Any) -> Any:
        """Suppress default responses for coordinator-to-device frames."""
        kwargs.setdefault("disable_default_response", True)
        return await super().command(command_id, *args, **kwargs)

    def handle_cluster_request(
        self,
        hdr: foundation.ZCLHeader,
        args: Any,
        *,
        dst_addressing: t.AddrMode | None = None,
    ) -> None:
        """Handle validated learning and the model-specific send lifecycle."""
        command_id = hdr.command_id
        if command_id == self.ServerCommandDefs.receive_ir_frame_00.id:
            self._start_learn_transfer(hdr, args)
            return
        if command_id == self.ServerCommandDefs.receive_ir_frame_02.id:
            self._send_message_part(hdr, args)
            return
        if command_id == self.ServerCommandDefs.receive_ir_frame_03.id:
            self._append_learn_transfer(hdr, args)
            return
        if command_id == self.ServerCommandDefs.receive_ir_frame_05.id:
            self._finish_learn_transfer(hdr, args)
            return

        super().handle_cluster_request(hdr, args, dst_addressing=dst_addressing)
        if command_id == self.ServerCommandDefs.receive_ir_frame_04.id:
            self._finish_outgoing_transfer(int(args.seq))

    def _send_default_response(
        self,
        hdr: foundation.ZCLHeader,
        status: foundation.Status = foundation.Status.SUCCESS,
    ) -> None:
        """Send a default response only when the incoming frame requested one."""
        if not hdr.frame_control.disable_default_response:
            self.send_default_rsp(hdr, status=status)

    def _request_learn_part(
        self,
        sequence: int,
        position: int,
        *,
        expect_reply: bool,
    ) -> None:
        """Request the first missing learned-code part."""
        self.create_catching_task(
            super().command(
                self.ServerCommandDefs.receive_ir_frame_02.id,
                seq=sequence,
                position=position,
                maxlen=0x38,
                expect_reply=expect_reply,
                disable_default_response=False,
            )
        )

    def _start_learn_transfer(self, hdr: foundation.ZCLHeader, args: Any) -> None:
        """Start assembling the announced packet, or keep the current one."""
        sequence = int(args.seq)
        expected_length = int(args.length)
        if (
            self._learn_packet.active
            and not self._learn_packet.complete
            and expected_length == self._learn_packet.length
        ):
            self._send_default_response(hdr)
            self._request_learn_part(
                sequence,
                self._learn_packet.first_missing,
                expect_reply=False,
            )
            return
        error = self._learn_packet.start(expected_length)
        if error is not None:
            _LOGGER.warning("Rejecting ZG-IR01 learned packet: %s", error)
            self._send_default_response(hdr, foundation.Status.FAILURE)
            return

        self._send_default_response(hdr)
        self.create_catching_task(
            super().command(
                self.ServerCommandDefs.receive_ir_frame_01.id,
                zero=0,
                seq=sequence,
                length=expected_length,
                unk1=args.unk1,
                clusterid=args.clusterid,
                unk2=args.unk2,
                cmd=args.cmd,
                unk3=args.unk3,
                expect_reply=True,
                disable_default_response=False,
            )
        )
        self._request_learn_part(sequence, 0, expect_reply=True)

    def _append_learn_transfer(self, hdr: foundation.ZCLHeader, args: Any) -> None:
        """Add one part at its position and ask for the next missing part."""
        sequence = int(args.seq)
        position = int(args.position)
        part = bytes(args.msgpart)
        checksum = int(args.msgpartcrc)
        if not self._learn_packet.active:
            self._send_default_response(hdr)
            return
        error = self._learn_packet.append(position, part, checksum)
        if error is not None:
            _LOGGER.warning(
                "Rejecting ZG-IR01 learned packet part: %s "
                "(position=%s, bytes=%s)",
                error,
                position,
                len(part),
            )
            self._send_default_response(hdr, foundation.Status.FAILURE)
            self._request_learn_part(
                sequence,
                self._learn_packet.first_missing,
                expect_reply=False,
            )
            return

        self._send_default_response(hdr)
        if not self._learn_packet.complete:
            self._request_learn_part(
                sequence,
                self._learn_packet.first_missing,
                expect_reply=False,
            )
            return

        self.create_catching_task(
            super().command(
                self.ServerCommandDefs.receive_ir_frame_04.id,
                zero0=0,
                seq=sequence,
                zero1=0,
                expect_reply=False,
                disable_default_response=False,
            )
        )

    def _finish_learn_transfer(self, hdr: foundation.ZCLHeader, args: Any) -> None:
        """Publish the assembled packet only when every byte is present."""
        sequence = int(args.seq)
        if not self._learn_packet.active:
            self._send_default_response(hdr)
            return
        packet = self._learn_packet.finish()
        if packet is None:
            _LOGGER.warning(
                "ZG-IR01 learned packet is incomplete "
                "(first_missing=%s, announced_length=%s)",
                self._learn_packet.first_missing,
                self._learn_packet.length,
            )
            self._send_default_response(hdr, foundation.Status.FAILURE)
            self._request_learn_part(
                sequence,
                self._learn_packet.first_missing,
                expect_reply=False,
            )
            return

        try:
            normalized_packet = _broadlink_packet_from_hardware(packet)
        except ValueError as error:
            _LOGGER.warning("Rejecting invalid ZG-IR01 learned packet: %s", error)
            self._send_default_response(hdr, foundation.Status.FAILURE)
            self._learn_packet.reset()
            return
        self._send_default_response(hdr)
        self.endpoint.device.last_learned_ir_code = base64.b64encode(
            normalized_packet
        ).decode()
        self._learn_packet.reset()
        self.create_catching_task(
            self.endpoint.zosung_ircontrol.command(
                self.endpoint.zosung_ircontrol.ServerCommandDefs.IRLearn.id,
                on_off=False,
                expect_reply=False,
            )
        )

    def _send_message_part(self, hdr: foundation.ZCLHeader, args: Any) -> None:
        self._send_default_response(hdr)
        sequence = int(args.seq)
        transfer = self.endpoint.device._ir_send_transfer
        if transfer is None or transfer.sequence != sequence:
            _LOGGER.warning(
                "Ignoring ZG-IR01 transfer request for unknown sequence %s "
                "at position %s",
                sequence,
                int(args.position),
            )
            return
        transfer.note_request()
        if not transfer.accepting_requests:
            return
        message = transfer.message

        position = int(args.position)
        max_length = min(int(args.maxlen), _MAX_OUTGOING_CHUNK_LENGTH)
        if position < 0 or position > len(message) or max_length <= 0:
            _LOGGER.warning(
                "Ignoring invalid ZG-IR01 transfer request "
                "(sequence=%s, position=%s, max_length=%s)",
                sequence,
                position,
                max_length,
            )
            return

        if position == len(message) and not transfer.fully_served:
            _LOGGER.warning(
                "Ignoring premature ZG-IR01 transfer completion (sequence=%s)",
                sequence,
            )
            return

        part = message[position : position + max_length].encode()
        request_key = (id(transfer), position)
        if request_key in self._outgoing_parts_in_flight:
            return
        self._outgoing_parts_in_flight.add(request_key)
        task = asyncio.create_task(
            self._send_outgoing_part(request_key, transfer, part)
        )
        transfer.response_tasks.add(task)

        def forget_response_task(done_task: asyncio.Task[None]) -> None:
            transfer.response_tasks.discard(done_task)
            self._outgoing_parts_in_flight.discard(request_key)

        task.add_done_callback(forget_response_task)

    async def _send_outgoing_part(
        self,
        request_key: tuple[int, int],
        transfer: _OutgoingTransfer,
        part: bytes,
    ) -> None:
        """Send one requested part without queueing duplicate device retries."""
        _, position = request_key
        try:
            status = await super().command(
                self.ClientCommandDefs.resp_ir_frame_03.id,
                zero=0,
                seq=transfer.sequence,
                position=position,
                msgpart=part,
                msgpartcrc=sum(part) % 0x100,
                expect_reply=False,
                disable_default_response=True,
            )
            if isinstance(status, foundation.Status) and (
                status != foundation.Status.SUCCESS
            ):
                raise RuntimeError(
                    f"ZG-IR01 send part failed at position {position}: {status.name}"
                )
            transfer.mark_served(position, len(part))
            # This firmware does not send frame 0x04 after a transmission. Its
            # exact-end request is the observable signal that it consumed the
            # complete wrapper, so acknowledge that empty part before success.
            if position == len(transfer.message):
                self._finish_outgoing_transfer(transfer.sequence, transfer)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            self.endpoint.device.finish_ir_send(transfer, error)
        finally:
            self._outgoing_parts_in_flight.discard(request_key)

    def _finish_outgoing_transfer(
        self,
        sequence: int,
        transfer: _OutgoingTransfer | None = None,
    ) -> None:
        """Complete a send after the device consumes it or confirms it."""
        if transfer is None:
            transfer = self.endpoint.device._ir_send_transfer
        if transfer is None or transfer.sequence != sequence:
            return
        if not transfer.fully_served:
            _LOGGER.warning(
                "Ignoring premature ZG-IR01 transfer confirmation (sequence=%s)",
                sequence,
            )
            return
        self.endpoint.device.finish_ir_send(transfer)


class IRStudyState(t.enum8):
    """Per-slot IR code study state."""

    Study = 0x00
    Registered = 0x01
    Unregistered = 0x02


(
    TuyaQuirkBuilder("HOBEIAN", "ZG-IR01")
    # Preserve every interviewed cluster, then replace the two raw-IR clusters
    # with ZHA's tested Zosung protocol implementation.
    .zigpy_device_class(ZGIR01Device)
    .replace_cluster_occurrences(
        ZGIR01Control,
        replace_client_instances=False,
    )
    .replace_cluster_occurrences(
        ZGIR01Transmit,
        replace_client_instances=False,
    )
    # ---- Fire channels: ON sends the "on" code, OFF sends the "off" code ----
    .tuya_switch(
        dp_id=1,
        attribute_name="switch_1",
        translation_key="switch_1",
        fallback_name="Switch 1",
    )
    .tuya_switch(
        dp_id=2,
        attribute_name="switch_2",
        translation_key="switch_2",
        fallback_name="Switch 2",
    )
    .tuya_switch(
        dp_id=3,
        attribute_name="switch_3",
        translation_key="switch_3",
        fallback_name="Switch 3",
    )
    .tuya_switch(
        dp_id=4,
        attribute_name="switch_4",
        translation_key="switch_4",
        fallback_name="Switch 4",
    )
    .tuya_switch(
        dp_id=5,
        attribute_name="switch_5",
        translation_key="switch_5",
        fallback_name="Switch 5",
    )
    .tuya_switch(
        dp_id=6,
        attribute_name="switch_6",
        translation_key="switch_6",
        fallback_name="Switch 6",
    )
    # ---- Per-slot study controls (set to "study" to teach a code) ----
    .tuya_enum(
        dp_id=120,
        attribute_name="switch_1_on_code",
        enum_class=IRStudyState,
        translation_key="switch_1_on_code",
        fallback_name="Switch 1 on code",
    )
    .tuya_enum(
        dp_id=121,
        attribute_name="switch_1_off_code",
        enum_class=IRStudyState,
        translation_key="switch_1_off_code",
        fallback_name="Switch 1 off code",
    )
    .tuya_enum(
        dp_id=122,
        attribute_name="switch_2_on_code",
        enum_class=IRStudyState,
        translation_key="switch_2_on_code",
        fallback_name="Switch 2 on code",
    )
    .tuya_enum(
        dp_id=123,
        attribute_name="switch_2_off_code",
        enum_class=IRStudyState,
        translation_key="switch_2_off_code",
        fallback_name="Switch 2 off code",
    )
    .tuya_enum(
        dp_id=124,
        attribute_name="switch_3_on_code",
        enum_class=IRStudyState,
        translation_key="switch_3_on_code",
        fallback_name="Switch 3 on code",
    )
    .tuya_enum(
        dp_id=125,
        attribute_name="switch_3_off_code",
        enum_class=IRStudyState,
        translation_key="switch_3_off_code",
        fallback_name="Switch 3 off code",
    )
    .tuya_enum(
        dp_id=126,
        attribute_name="switch_4_on_code",
        enum_class=IRStudyState,
        translation_key="switch_4_on_code",
        fallback_name="Switch 4 on code",
    )
    .tuya_enum(
        dp_id=127,
        attribute_name="switch_4_off_code",
        enum_class=IRStudyState,
        translation_key="switch_4_off_code",
        fallback_name="Switch 4 off code",
    )
    .tuya_enum(
        dp_id=128,
        attribute_name="switch_5_on_code",
        enum_class=IRStudyState,
        translation_key="switch_5_on_code",
        fallback_name="Switch 5 on code",
    )
    .tuya_enum(
        dp_id=129,
        attribute_name="switch_5_off_code",
        enum_class=IRStudyState,
        translation_key="switch_5_off_code",
        fallback_name="Switch 5 off code",
    )
    .tuya_enum(
        dp_id=130,
        attribute_name="switch_6_on_code",
        enum_class=IRStudyState,
        translation_key="switch_6_on_code",
        fallback_name="Switch 6 on code",
    )
    .tuya_enum(
        dp_id=131,
        attribute_name="switch_6_off_code",
        enum_class=IRStudyState,
        translation_key="switch_6_off_code",
        fallback_name="Switch 6 off code",
    )
    # The device already exposes standard temperature, humidity, and battery
    # clusters. Keep those native entities and suppress only the useless generic
    # OnOff entity; DP 109's unit depends on another datapoint.
    .prevent_default_entity_creation(endpoint_id=1, cluster_id=OnOff.cluster_id)
    .skip_configuration()
    .add_to_registry()
)
