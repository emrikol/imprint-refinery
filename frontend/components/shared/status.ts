import { css, html, type TemplateResult } from "lit";

export interface StatusOptions {
  state?: string;
  busy?: boolean;
  label?: string;
  context?: string;
}

export interface StatusPresentation {
  label: string;
  tone: "ready" | "busy" | "warning" | "error";
}

const ERROR_STATES = new Set([
  "error",
  "delivery_failed",
  "expired",
  "queue_full",
  "stopped",
  "unavailable",
  "missing",
]);
const WARNING_STATES = new Set(["unassigned"]);
const PROCESSING_STATES = new Set(["capturing", "sending", "queued", "dispatching"]);

export const statusPresentation = ({
  state = "idle",
  busy = false,
  label = "",
}: StatusOptions): StatusPresentation => {
  const processing = busy || PROCESSING_STATES.has(state);
  const tone = ERROR_STATES.has(state)
    ? "error"
    : processing
      ? "busy"
      : WARNING_STATES.has(state)
        ? "warning"
        : "ready";
  return {
    tone,
    label: label || (processing
      ? state === "capturing" ? "Capturing" : "Working"
      : state === "unavailable" ? "Unavailable"
      : ERROR_STATES.has(state) ? "Needs attention"
      : WARNING_STATES.has(state) ? "Setup required"
      : "Ready"),
  };
};

export const statusStyles = css`
  .irf-status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--imprint-muted);
    font-size: 13px;
    font-weight: 650;
  }
  .irf-status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--imprint-success);
  }
  .irf-status.busy .irf-status-indicator {
    background: var(--imprint-warning);
    animation: irf-status-pulse 1.2s ease-in-out infinite;
  }
  .irf-status.warning .irf-status-indicator { background: var(--imprint-warning); }
  .irf-status.error .irf-status-indicator { background: var(--imprint-danger); }
  @keyframes irf-status-pulse { 50% { opacity: .35; transform: scale(.8); } }
  @media (prefers-reduced-motion: reduce) {
    .irf-status.busy .irf-status-indicator { animation: none; }
  }
`;

export const renderStatus = (options: StatusOptions = {}): TemplateResult => {
  const state = options.state || "idle";
  const context = options.context || "Emitter";
  const presentation = statusPresentation(options);
  return html`<span
    class=${`irf-status ${presentation.tone}`}
    role="status"
    aria-live="polite"
    title=${`${context} status: ${state}`}
  ><span class="irf-status-indicator" aria-hidden="true"></span>${presentation.label}</span>`;
};
