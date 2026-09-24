/**
 * Home Assistant frontend elements used by Imprint Refinery.
 *
 * These elements are implementation details of the supported Home Assistant
 * frontend, not a separately versioned public package. Required elements must
 * be present on a cold direct visit to the Imprint panel. Optional elements
 * must always have an immediate semantic/native fallback.
 */
export const REQUIRED_HA_COMPONENTS = [
  "ha-alert",
  "ha-button",
  "ha-card",
  "ha-checkbox",
  "ha-dialog",
  "ha-dropdown",
  "ha-dropdown-item",
  "ha-expansion-panel",
  "ha-icon",
  "ha-icon-button",
  "ha-input",
  "ha-input-search",
  "ha-ripple",
  "ha-select",
  "ha-spinner",
  "ha-tab-group",
  "ha-tab-group-tab",
] as const;

export const OPTIONAL_HA_COMPONENTS = [
  "ha-empty-state",
  "ha-icon-picker",
  "ha-textarea",
] as const;

export type HaComponentName =
  | (typeof REQUIRED_HA_COMPONENTS)[number]
  | (typeof OPTIONAL_HA_COMPONENTS)[number];

export interface HaComponentContract {
  availability: "required-cold-entry" | "optional-with-fallback";
  contract: string;
  fallback?: string;
}

/** Inspected against Home Assistant 2026.9 and enforced by installed smoke. */
export const HA_COMPONENT_CONTRACTS: Record<
  HaComponentName,
  HaComponentContract
> = {
  "ha-alert": {
    availability: "required-cold-entry",
    contract: "Urgent error and warning announcements",
  },
  "ha-button": {
    availability: "required-cold-entry",
    contract: "Standard labeled actions and links",
  },
  "ha-card": {
    availability: "required-cold-entry",
    contract: "Native workspace and outer-shell card surfaces",
  },
  "ha-checkbox": {
    availability: "required-cold-entry",
    contract: "Bulk command selection",
  },
  "ha-dialog": {
    availability: "required-cold-entry",
    contract: "Modal title, close, Escape, focus, scrolling, and footer slots",
  },
  "ha-dropdown": {
    availability: "required-cold-entry",
    contract: "Context action menus",
  },
  "ha-dropdown-item": {
    availability: "required-cold-entry",
    contract: "Context menu actions",
  },
  "ha-expansion-panel": {
    availability: "required-cold-entry",
    contract: "Optional technical and advanced detail",
  },
  "ha-icon": {
    availability: "required-cold-entry",
    contract: "Home Assistant icon rendering",
  },
  "ha-icon-button": {
    availability: "required-cold-entry",
    contract: "Accessible icon-only actions",
  },
  "ha-input": {
    availability: "required-cold-entry",
    contract: "Single-line workflow fields",
  },
  "ha-input-search": {
    availability: "required-cold-entry",
    contract: "Workspace and catalog search",
  },
  "ha-ripple": {
    availability: "required-cold-entry",
    contract: "Native interaction feedback for clickable cards",
  },
  "ha-select": {
    availability: "required-cold-entry",
    contract: "Single-choice workflow fields",
  },
  "ha-spinner": {
    availability: "required-cold-entry",
    contract: "Loading progress with adjacent text",
  },
  "ha-tab-group": {
    availability: "required-cold-entry",
    contract: "Workspace and Inspector tab navigation",
  },
  "ha-tab-group-tab": {
    availability: "required-cold-entry",
    contract: "Keyboard-operable tab choices",
  },
  "ha-empty-state": {
    availability: "optional-with-fallback",
    contract: "Full successful-but-empty workspaces",
    fallback: "Semantic heading, description, and action markup",
  },
  "ha-icon-picker": {
    availability: "optional-with-fallback",
    contract: "Searchable command icon selection",
    fallback: "Qualified Home Assistant icon-name input",
  },
  "ha-textarea": {
    availability: "optional-with-fallback",
    contract: "Signal, import, and backup multiline text fields",
    fallback: "Themed semantic textarea with the same label and value contract",
  },
};

/** Presence check only. It deliberately does not wait for or load HA internals. */
export const hasHaComponent = (tagName: HaComponentName): boolean =>
  typeof customElements !== "undefined" && Boolean(customElements.get(tagName));
