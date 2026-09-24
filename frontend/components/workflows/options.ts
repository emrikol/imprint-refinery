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
): WorkflowSelectOption[] => hardwareOptions(receivers, "Choose an IR receiver");

export const areaOptions = (
  areas: readonly AreaSummary[],
): WorkflowSelectOption[] => [
  { value: "", label: "No Area" },
  ...areas.map((area) => ({ value: area.area_id, label: area.name })),
];

export const commandRoleOptions = (): WorkflowSelectOption[] => [
  { value: "", label: "No standard role" },
  { value: "power_on", label: "Power on" },
  { value: "power_off", label: "Power off" },
  { value: "power_toggle", label: "Power toggle" },
  { value: "volume_up", label: "Volume up" },
  { value: "volume_down", label: "Volume down" },
  { value: "mute_toggle", label: "Mute toggle" },
  { value: "source", label: "Source" },
];
