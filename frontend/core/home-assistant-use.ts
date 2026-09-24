import type { ApplianceData, CommandData } from "../types";

export interface HomeAssistantUse {
  action: string;
  entityId: string;
  serviceData: Record<string, unknown>;
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

export const buildHomeAssistantUse = (
  _applianceId: string,
  commandId: string,
  appliance: ApplianceData,
  command: CommandData,
): HomeAssistantUse => {
  const deviceUrl = appliance.home_assistant?.device_url;
  const commandEntity =
    appliance.home_assistant?.command_entities?.[commandId] ||
    command.home_assistant?.entity_id ||
    "";
  const entityId = appliance.home_assistant?.entity_id || "";
  const platform = appliance.home_assistant?.platform || "";
  if (entityId && platform === "remote")
    return {
      action: "remote.send_command",
      entityId,
      serviceData: {
        entity_id: entityId,
        command: commandId,
        num_repeats: 1,
        delay_secs: 0.4,
      },
      yaml: actionYaml("remote.send_command", entityId, {
        command: commandId,
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
      serviceData: { entity_id: commandEntity },
      yaml: actionYaml("button.press", commandEntity),
      deviceUrl,
      advanced: false,
    };

  const native = nativeRoleAction(
    platform,
    command.role || "",
    command.name || commandId,
  );
  if (entityId && native)
    return {
      action: native.action,
      entityId,
      serviceData: { entity_id: entityId, ...(native.data || {}) },
      yaml: actionYaml(native.action, entityId, native.data),
      deviceUrl,
      advanced: false,
    };
  return {
    action: "",
    entityId: "",
    serviceData: {},
    yaml: "",
    deviceUrl,
    advanced: false,
  };
};
