import { css } from "lit";

export const tokens = css`
  :host {
    display: block;
    min-width: 0;
    max-width: 100%;
    --imprint-accent: var(--primary-color, #0b6bcb);
    --imprint-accent-soft: color-mix(in srgb, var(--imprint-accent) 12%, transparent);
    --imprint-surface: var(--card-background-color, #fff);
    --imprint-surface-2: var(--secondary-background-color, #f4f6f8);
    --imprint-line: var(--divider-color, #d9dde3);
    --imprint-text: var(--primary-text-color, #1d2433);
    --imprint-muted: var(--secondary-text-color, #667085);
    --imprint-danger: var(--error-color, #b42318);
    --imprint-success: var(--success-color, #067647);
    --imprint-warning: var(--warning-color, #b54708);
    --imprint-radius: 14px;
    color: var(--imprint-text);
    font-family: var(--paper-font-body1_-_font-family, system-ui, sans-serif);
    box-sizing: border-box;
  }
  *, *::before, *::after { box-sizing: border-box; }
  button { font: inherit; color: inherit; cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .52; }
  button:focus-visible, summary:focus-visible {
    outline: 2px solid var(--imprint-accent); outline-offset: 2px;
  }
  ha-button, ha-input, ha-input-search, ha-select, ha-textarea { max-width: 100%; min-width: 0; }
  ha-button { --ha-button-height: 44px; }
  ha-button > ha-icon[slot="start"], ha-button > ha-icon[slot="end"] { --mdc-icon-size: 20px; }
  ha-icon-button { --ha-icon-button-size: 44px; }
  ha-input, ha-input-search, ha-select, ha-textarea { width: 100%; }
  ha-textarea { --ha-textarea-max-height: 320px; }
  ha-tab-group { min-width: 0; max-width: 100%; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .muted { color: var(--imprint-muted); }
  .panel { border: 1px solid var(--imprint-line); border-radius: var(--imprint-radius); background: var(--imprint-surface); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { font-size: 24px; line-height: 1.15; }
  h2 { font-size: 18px; line-height: 1.25; }
  h3 { font-size: 15px; }
  code { overflow-wrap: anywhere; }
  .badge { display: inline-flex; align-items: center; gap: 5px; min-height: 25px; padding: 3px 8px; border-radius: 999px; background: var(--imprint-surface-2); font-size: 12px; font-weight: 700; }
  .badge.success { color: var(--imprint-success); background: color-mix(in srgb, var(--imprint-success) 11%, transparent); }
  .badge.warning { color: var(--imprint-warning); background: color-mix(in srgb, var(--imprint-warning) 12%, transparent); }
  .badge.danger { color: var(--imprint-danger); background: color-mix(in srgb, var(--imprint-danger) 10%, transparent); }
`;
