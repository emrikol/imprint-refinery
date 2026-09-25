import type {
  AreaSummary,
  Dict,
  InfraredHardwareEntity,
  RemoteProfileData,
} from "../../types";

export interface WorkflowSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export const remoteProfileOptions = (
  profiles: Dict<RemoteProfileData>,
  placeholder?: string,
): WorkflowSelectOption[] => [
  ...(placeholder ? [{ value: "", label: placeholder }] : []),
  ...Object.entries(profiles).map(([id, profile]) => ({
    value: id,
    label: profile.name || id,
  })),
];

const hardwareOptions = (
  hardware: readonly InfraredHardwareEntity[],
  placeholder: string,
): WorkflowSelectOption[] => [
  { value: "", label: placeholder },
  ...hardware.map((item) => ({
    value: item.ref,
    label: `${item.name}${item.available ? "" : " — unavailable"}`,
    disabled: !item.available,
  })),
];

export const emitterOptions = (
  emitters: readonly InfraredHardwareEntity[],
): WorkflowSelectOption[] => hardwareOptions(emitters, "Choose an IR emitter");

export const receiverOptions = (
  receivers: readonly InfraredHardwareEntity[],
): WorkflowSelectOption[] =>
  hardwareOptions(receivers, "Choose an IR receiver");

export const areaOptions = (
  areas: readonly AreaSummary[],
): WorkflowSelectOption[] => [
  { value: "", label: "No Area" },
  ...areas.map((area) => ({ value: area.area_id, label: area.name })),
];

const COMMAND_ROLE_OPTIONS: readonly WorkflowSelectOption[] = [
  { value: "power_on", label: "Power on" },
  { value: "power_off", label: "Power off" },
  { value: "power_toggle", label: "Power toggle" },
  { value: "play_pause_toggle", label: "Play / pause" },
  { value: "play", label: "Play" },
  { value: "pause", label: "Pause" },
  { value: "stop", label: "Stop" },
  { value: "previous", label: "Previous" },
  { value: "next", label: "Next" },
  { value: "rewind", label: "Rewind" },
  { value: "fast_forward", label: "Fast forward" },
  { value: "volume_up", label: "Volume up" },
  { value: "volume_down", label: "Volume down" },
  { value: "mute_toggle", label: "Mute toggle" },
  { value: "mute", label: "Mute" },
  { value: "unmute", label: "Unmute" },
  { value: "source", label: "Source" },
];

const POWER_ROLES = ["power_on", "power_off", "power_toggle"] as const;
const PLAYBACK_ROLES = [
  "play_pause_toggle",
  "play",
  "pause",
  "stop",
  "previous",
  "next",
  "rewind",
  "fast_forward",
] as const;
const VOLUME_ROLES = [
  "volume_up",
  "volume_down",
  "mute_toggle",
  "mute",
  "unmute",
] as const;
const INPUT_ROLES = ["source"] as const;

const IDENTIFY_ROLES_BY_APPLIANCE_TYPE: Readonly<
  Record<string, readonly string[]>
> = {
  air_purifier: POWER_ROLES,
  audio: [...POWER_ROLES, ...VOLUME_ROLES, ...PLAYBACK_ROLES, ...INPUT_ROLES],
  climate: POWER_ROLES,
  display: [...POWER_ROLES, ...INPUT_ROLES, ...VOLUME_ROLES],
  fan: POWER_ROLES,
  fireplace: POWER_ROLES,
  heater: POWER_ROLES,
  humidifier: POWER_ROLES,
  light: POWER_ROLES,
  media_player: [
    ...POWER_ROLES,
    ...PLAYBACK_ROLES,
    ...VOLUME_ROLES,
    ...INPUT_ROLES,
  ],
  projector: [...POWER_ROLES, ...INPUT_ROLES, ...VOLUME_ROLES],
  receiver: [
    ...POWER_ROLES,
    ...VOLUME_ROLES,
    ...INPUT_ROLES,
    ...PLAYBACK_ROLES,
  ],
  set_top_box: [...POWER_ROLES, ...PLAYBACK_ROLES, ...VOLUME_ROLES],
  tv: [...POWER_ROLES, ...VOLUME_ROLES, ...INPUT_ROLES, ...PLAYBACK_ROLES],
};

export const commandRoleOptions = (
  emptyLabel = "No standard role",
): WorkflowSelectOption[] => [
  { value: "", label: emptyLabel },
  ...COMMAND_ROLE_OPTIONS,
];

export const identifyCommandRoleOptions = (
  applianceType: string,
  emptyLabel = "Any / not sure",
): WorkflowSelectOption[] => {
  const relevantRoles = IDENTIFY_ROLES_BY_APPLIANCE_TYPE[applianceType];
  const options = relevantRoles
    ? COMMAND_ROLE_OPTIONS.filter((option) =>
        relevantRoles.includes(option.value),
      )
    : COMMAND_ROLE_OPTIONS;
  return [{ value: "", label: emptyLabel }, ...options];
};

export const commandRoleLabel = (value: unknown): string =>
  COMMAND_ROLE_OPTIONS.find((option) => option.value === String(value || ""))
    ?.label || "Unspecified button";

const CATALOG_CATEGORY_OPTIONS: readonly WorkflowSelectOption[] = [
  { value: "tv", label: "Television" },
  { value: "audio", label: "Audio / receiver" },
  { value: "media", label: "Media player / projector" },
  { value: "fan", label: "Fan" },
  { value: "climate", label: "Climate / heater" },
  { value: "light", label: "Light" },
];

/** Catalog search families supported by the bundled catalog service. */
export const catalogCategoryOptions = (
  allowAll = false,
): WorkflowSelectOption[] => [
  {
    value: "",
    label: allowAll ? "All categories" : "Choose a category",
    disabled: !allowAll,
  },
  ...CATALOG_CATEGORY_OPTIONS,
];
