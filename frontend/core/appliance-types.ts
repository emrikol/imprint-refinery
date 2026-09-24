import type { HaSelectOption } from "./ha-controls";

const CANONICAL_APPLIANCE_TYPES = [
  { value: "air_purifier", label: "Air purifier" },
  { value: "audio", label: "Speaker / soundbar" },
  { value: "climate", label: "Air conditioner / climate" },
  { value: "display", label: "Display / monitor" },
  { value: "fan", label: "Fan" },
  { value: "fireplace", label: "Fireplace" },
  { value: "heater", label: "Heater" },
  { value: "humidifier", label: "Humidifier" },
  { value: "light", label: "Light" },
  { value: "media_player", label: "Media player" },
  { value: "projector", label: "Projector" },
  { value: "receiver", label: "A/V receiver" },
  { value: "set_top_box", label: "Set-top box" },
  { value: "tv", label: "Television" },
  { value: "generic", label: "Generic / other" },
] as const satisfies readonly HaSelectOption[];

const LABELS = new Map<string, string>(
  CANONICAL_APPLIANCE_TYPES.map(({ value, label }) => [value, label]),
);

const ICONS = new Map<string, string>([
  ["air_purifier", "mdi:air-purifier"],
  ["audio", "mdi:speaker"],
  ["climate", "mdi:air-conditioner"],
  ["display", "mdi:monitor"],
  ["fan", "mdi:fan"],
  ["fireplace", "mdi:fireplace"],
  ["heater", "mdi:radiator"],
  ["humidifier", "mdi:air-humidifier"],
  ["light", "mdi:lightbulb-outline"],
  ["media_player", "mdi:play-box-outline"],
  ["projector", "mdi:projector"],
  ["receiver", "mdi:audio-video"],
  ["set_top_box", "mdi:set-top-box"],
  ["tv", "mdi:television"],
  ["generic", "mdi:remote"],
]);

const humanize = (value: string): string =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

export const applianceTypeLabel = (value?: string): string => {
  const category = String(value || "generic");
  return LABELS.get(category) || `Other · ${humanize(category)}`;
};

export const applianceTypeIcon = (value?: string): string =>
  ICONS.get(String(value || "generic")) || "mdi:remote";

export const applianceTypeOptions = (value?: string): HaSelectOption[] => {
  const category = String(value || "generic");
  if (LABELS.has(category)) return [...CANONICAL_APPLIANCE_TYPES];
  return [
    ...CANONICAL_APPLIANCE_TYPES,
    { value: category, label: applianceTypeLabel(category) },
  ];
};
