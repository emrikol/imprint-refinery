import { css } from "lit";

export const tokens = css`
  :host {
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
  *, *::before, *::after { box-sizing: inherit; }
  button, input, select, textarea { font: inherit; color: inherit; }
  input::placeholder, textarea::placeholder { color: var(--imprint-muted); opacity: .78; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .52; }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
    outline: 2px solid var(--imprint-accent); outline-offset: 2px;
  }
  .btn {
    min-height: 44px; border: 1px solid var(--imprint-line); border-radius: 10px;
    background: var(--imprint-surface); padding: 9px 14px; display: inline-flex;
    gap: 7px; align-items: center; justify-content: center; font-weight: 650;
  }
  .btn:hover:not(:disabled) { background: var(--imprint-surface-2); }
  .btn.primary { color: var(--text-primary-color, #fff); background: var(--imprint-accent); border-color: var(--imprint-accent); }
  .btn.danger { color: var(--imprint-danger); }
  .btn.icon { width: 44px; padding: 0; }
  .field { display: grid; gap: 6px; font-size: 13px; color: var(--imprint-muted); }
  .field input, .field select, .field textarea, .input {
    width: 100%; min-height: 44px; border: 1px solid var(--imprint-line); border-radius: 9px;
    padding: 9px 11px; background: var(--imprint-surface); color: var(--imprint-text);
  }
  .field textarea { min-height: 130px; resize: vertical; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .muted { color: var(--imprint-muted); }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: 11px; font-weight: 800; color: var(--imprint-muted); }
  .panel { border: 1px solid var(--imprint-line); border-radius: var(--imprint-radius); background: var(--imprint-surface); }
  .empty { min-height: 180px; display: grid; place-items: center; text-align: center; color: var(--imprint-muted); padding: 28px; }
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

export const featureStyles = css`
  ${tokens}
  :host { display: block; }
  .role-head { display: flex; align-items: flex-start; gap: 14px; justify-content: space-between; margin-bottom: 16px; }
  .role-head h1, .role-head h2 { margin-bottom: 4px; }
  .role-head p { color: var(--imprint-muted); margin-bottom: 0; }
  .section { padding: 16px; }
  .grid { display: grid; gap: 12px; }
  .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px; }
  .metric { background: var(--imprint-surface-2); border-radius: 10px; padding: 10px; display: grid; gap: 3px; }
  .metric span { color: var(--imprint-muted); font-size: 12px; }
  .notice { padding: 11px 12px; border-radius: 10px; background: var(--imprint-accent-soft); display: flex; gap: 9px; align-items: flex-start; }
  .notice.warning { background: color-mix(in srgb, var(--imprint-warning) 12%, transparent); color: var(--imprint-warning); }
  .notice.danger { background: color-mix(in srgb, var(--imprint-danger) 10%, transparent); color: var(--imprint-danger); }
  @media (max-width: 720px) { .two { grid-template-columns: 1fr; } .role-head { align-items: stretch; flex-direction: column; } }
`;
