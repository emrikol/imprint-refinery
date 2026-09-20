import type { ApplianceData, CommandData, RegistryData } from "../../types";

export interface SendFeedback {
  kind: "pending" | "success" | "error";
  message: string;
  detail?: string;
}

export type SendFeedbackCollection =
  | Record<string, SendFeedback>
  | Map<string, SendFeedback>;

export const itemKey = (
  locId: string,
  applianceId: string,
  cmdId: string,
): string => `${locId}\u0000${applianceId}\u0000${cmdId}`;

export const feedbackFor = (
  feedback: SendFeedbackCollection | undefined,
  locId: string,
  applianceId: string,
  cmdId: string,
): SendFeedback | undefined => {
  const key = itemKey(locId, applianceId, cmdId);
  return feedback instanceof Map ? feedback.get(key) : feedback?.[key];
};

export const emitterAvailability = (
  registry: RegistryData,
  selected = "",
): {
  hasEmitter: boolean;
  available: boolean;
} => {
  const enabled = (registry.emitters || []).filter(
    (emitter) => emitter.enabled !== false,
  );
  if (!enabled.length) return { hasEmitter: false, available: false };
  const candidates = selected
    ? enabled.filter((emitter) => emitter.key === selected)
    : enabled;
  const available = (candidates.length ? candidates : enabled).some(
    (emitter) => {
      const detail = emitter as unknown as Record<string, unknown>;
      const state = String(
        detail.state || detail.availability || "",
      ).toLocaleLowerCase();
      return (
        detail.available !== false &&
        !["offline", "unavailable", "disconnected"].includes(state)
      );
    },
  );
  return { hasEmitter: true, available };
};

export const safeFilename = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ir-command";

export interface HomeAssistantUse {
  action: string;
  entityId: string;
  yaml: string;
  deviceUrl?: string;
  advanced: boolean;
}

const nativeRoleAction = (
  platform: string,
  role: string,
  commandName: string,
): { action: string; data?: Record<string, unknown> } | null => {
  if (role === "power_on") return { action: "homeassistant.turn_on" };
  if (role === "power_off") return { action: "homeassistant.turn_off" };
  if (role === "power_toggle") return { action: "homeassistant.toggle" };
  if (platform !== "media_player") return null;
  const actions: Record<
    string,
    { action: string; data?: Record<string, unknown> }
  > = {
    play: { action: "media_player.media_play" },
    pause: { action: "media_player.media_pause" },
    play_pause_toggle: { action: "media_player.media_play_pause" },
    stop: { action: "media_player.media_stop" },
    next: { action: "media_player.media_next_track" },
    previous: { action: "media_player.media_previous_track" },
    volume_up: { action: "media_player.volume_up" },
    volume_down: { action: "media_player.volume_down" },
    mute: {
      action: "media_player.volume_mute",
      data: { is_volume_muted: true },
    },
    unmute: {
      action: "media_player.volume_mute",
      data: { is_volume_muted: false },
    },
    mute_toggle: {
      action: "media_player.volume_mute",
      data: { is_volume_muted: true },
    },
    source: {
      action: "media_player.select_source",
      data: { source: commandName },
    },
  };
  return actions[role] || null;
};

const actionYaml = (
  action: string,
  entityId: string,
  data?: Record<string, unknown>,
): string =>
  [
    `action: ${action}`,
    "target:",
    `  entity_id: ${entityId}`,
    ...(data && Object.keys(data).length
      ? [
          "data:",
          ...Object.entries(data).map(
            ([key, value]) => `  ${key}: ${JSON.stringify(value)}`,
          ),
        ]
      : []),
  ].join("\n");

const deviceActionYaml = (
  deviceId: string,
  entityId: string,
  commandId: string,
): string =>
  [
    `device_id: ${deviceId}`,
    "domain: imprint_refinery",
    "type: send_saved_command",
    `entity_id: ${entityId}`,
    `command_id: ${JSON.stringify(commandId)}`,
    "num_repeats: 1",
    "delay_secs: 0.4",
  ].join("\n");

export const homeAssistantUse = (
  _locId: string,
  _applianceId: string,
  cmdId: string,
  appliance: ApplianceData,
  command: CommandData,
): HomeAssistantUse => {
  const deviceUrl = appliance.home_assistant?.device_url;
  const commandEntity = command.home_assistant?.entity_id || "";
  const entityId = appliance.home_assistant?.entity_id || "";
  const deviceId = appliance.home_assistant?.device_id || "";
  const platform = appliance.home_assistant?.platform || "";
  if (deviceId && entityId && platform === "remote")
    return {
      action: "imprint_refinery.send_saved_command",
      entityId,
      yaml: deviceActionYaml(deviceId, entityId, cmdId),
      deviceUrl,
      advanced: false,
    };
  if (entityId && platform === "remote")
    return {
      action: "remote.send_command",
      entityId,
      yaml: actionYaml("remote.send_command", entityId, {
        command: cmdId,
        num_repeats: 1,
        delay_secs: 0.4,
      }),
      deviceUrl,
      advanced: false,
    };
  if (commandEntity)
    return {
      action: "button.press",
      entityId: commandEntity,
      yaml: actionYaml("button.press", commandEntity),
      deviceUrl,
      advanced: false,
    };

  const native = nativeRoleAction(
    platform,
    command.role || "",
    command.name || cmdId,
  );
  if (entityId && native)
    return {
      action: native.action,
      entityId,
      yaml: actionYaml(native.action, entityId, native.data),
      deviceUrl,
      advanced: false,
    };
  return {
    action: "",
    entityId: "",
    yaml: "",
    deviceUrl,
    advanced: false,
  };
};
