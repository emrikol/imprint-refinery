import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import { evidenceLabel, formatDuration } from "../../core/utils";
import type {
  AnalysisData,
  Dict,
  InfraredHardwareEntity,
  SignalData,
} from "../../types";
import "../signal-lab/waveform";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderFactGrid } from "../shared/metric-grid";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import { commandRoleOptions, receiverOptions } from "./options";

export interface LearnCommandDialogOptions {
  data: Dict;
  receivers: InfraredHardwareEntity[];
  testEmitter?: InfraredHardwareEntity;
  error?: string;
  busy?: boolean;
  capturing?: boolean;
  captureRemaining?: number;
  captureTimeout?: number;
  onAction: WorkflowActionHandler;
}

export const learnCommandDialogStyles: CSSResult = css`
  ha-dialog.learn-command-dialog { --ha-dialog-width-md: 700px; }
  .learn-command-dialog .irf-dialog-body { gap: 18px; }
  .learn-capture-state {
    display: grid;
    justify-items: center;
    min-width: 0;
    padding: 22px 18px 8px;
    text-align: center;
  }
  .learn-receiver-mark {
    display: grid;
    place-items: center;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
  }
  .learn-receiver-mark ha-icon { --mdc-icon-size: 34px; }
  .learn-capture-state.waiting .learn-receiver-mark {
    animation: learn-breathe 1.5s ease-in-out infinite;
  }
  .learn-capture-state p {
    max-width: 48ch;
    margin: 12px 0 0;
    color: var(--imprint-muted);
    line-height: 1.5;
  }
  .learn-capture-motif {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: min(300px, 86%);
    height: 54px;
    margin: 18px auto 12px;
    overflow: hidden;
  }
  .learn-capture-motif::after {
    content: "";
    position: absolute;
    inset: 50% 0 auto;
    height: 2px;
    border-radius: 2px;
    background: var(--imprint-accent);
    opacity: 0;
    transform: scaleX(.18);
    transition: opacity 160ms ease, transform 240ms cubic-bezier(.16, 1, .3, 1);
  }
  .learn-capture-motif i {
    width: 4px;
    height: 34px;
    border-radius: 4px;
    background: var(--imprint-accent);
    opacity: .72;
    transform: scaleY(.18);
    transform-origin: center;
  }
  .learn-capture-motif.waiting i {
    animation: learn-listen 940ms ease-in-out infinite alternate;
  }
  .learn-capture-motif i:nth-child(2n) {
    animation-duration: 1.28s;
    animation-delay: -.72s;
  }
  .learn-capture-motif i:nth-child(3n) {
    animation-duration: .76s;
    animation-delay: -.31s;
  }
  .learn-capture-motif i:nth-child(4n) {
    animation-duration: 1.46s;
    animation-delay: -.93s;
  }
  .learn-capture-motif i:nth-child(5n) {
    animation-duration: 1.08s;
    animation-delay: -.54s;
  }
  .learn-capture-motif.received i { opacity: 0; transform: scaleY(.04); }
  .learn-capture-motif.received::after { opacity: .72; transform: scaleX(1); }
  .learn-countdown {
    position: relative;
    display: grid;
    place-items: center;
    width: 138px;
    height: 138px;
    margin-top: 6px;
    border-radius: 50%;
    background: conic-gradient(
      var(--imprint-accent) 0 var(--learn-progress),
      color-mix(in srgb, var(--imprint-muted) 32%, transparent) 0
    );
    font-variant-numeric: tabular-nums;
  }
  .learn-countdown::before {
    content: "";
    position: absolute;
    inset: 10px;
    border-radius: inherit;
    background: var(--imprint-surface);
  }
  .learn-countdown-copy {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
  }
  .learn-countdown strong { font-size: 30px; line-height: 1; }
  .learn-countdown span {
    width: 78px;
    margin-top: 6px;
    color: var(--imprint-muted);
    font-size: 11px;
    line-height: 1.1;
  }
  .learn-chooser,
  .learn-review,
  .learn-review-form,
  .learn-technical-body { display: grid; gap: 16px; min-width: 0; }
  .learn-review-waveform { display: grid; gap: 8px; min-width: 0; }
  .learn-review-waveform > span {
    color: var(--imprint-muted);
    font-size: 13px;
    font-weight: 650;
  }
  .learn-review-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .learn-review-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .learn-review-actions ha-button { width: 100%; }
  .learn-optimization-notice {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }
  .learn-review-secondary {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px 18px;
  }
  .learn-review-secondary ha-button { min-height: 44px; }
  .learn-technical-body { padding-top: 12px; }
  .learn-technical-body pre {
    max-height: 210px;
    overflow: auto;
    margin: 0;
    padding: 12px;
    border-radius: 10px;
    background: var(--imprint-surface-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .learn-reassurance {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin: 0;
    color: var(--imprint-muted);
    font-size: 13px;
  }
  .learn-reassurance ha-icon {
    flex: 0 0 auto;
    color: var(--imprint-accent);
    --mdc-icon-size: 18px;
  }
  .learn-error-state {
    display: grid;
    justify-items: center;
    gap: 14px;
    padding: 22px 16px 8px;
    text-align: center;
  }
  .learn-error-state ha-icon {
    color: var(--imprint-danger);
    --mdc-icon-size: 52px;
  }
  .learn-error-state p {
    max-width: 50ch;
    margin: 0;
    color: var(--imprint-muted);
  }
  @keyframes learn-listen {
    from { transform: scaleY(.12); opacity: .38; }
    to { transform: scaleY(1); opacity: .92; }
  }
  @keyframes learn-breathe {
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 0 14px color-mix(
        in srgb,
        var(--imprint-accent) 7%,
        transparent
      );
    }
  }
  @media (max-width: 520px) {
    .learn-review-form,
    .learn-review-actions { grid-template-columns: 1fr; }
    .learn-optimization-notice { grid-template-columns: 1fr; }
    .learn-optimization-notice ha-button { justify-self: start; }
    .learn-capture-state { padding-inline: 4px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .learn-capture-state.waiting .learn-receiver-mark,
    .learn-capture-motif.waiting i { animation: none; }
    .learn-capture-motif.waiting i { transform: scaleY(.42); opacity: .68; }
  }
`;

const renderCaptureMotif = (state: "waiting" | "received"): TemplateResult => html`
  <div class=${`learn-capture-motif ${state}`} aria-hidden="true">
    ${Array.from({ length: 18 }, () => html`<i></i>`)}
  </div>
`;

export const renderLearnCommandDialog = ({
  data,
  receivers,
  testEmitter,
  error = "",
  busy = false,
  captureRemaining = 0,
  captureTimeout = 60,
  onAction,
}: LearnCommandDialogOptions): TemplateResult => {
  const stage = String(data.stage || "choose");
  const selectedReceiver = receivers.find(
    (receiver) => receiver.ref === String(data.infrared_receiver_ref || ""),
  );
  const timeout = Math.max(1, captureTimeout);
  const remaining = Math.max(0, Math.min(timeout, captureRemaining || timeout));
  const progress = Math.round((remaining / timeout) * 360);
  const preview = (data.preview || {}) as Dict;
  const signal = (preview.signal || {}) as SignalData;
  const analysis = (preview.analysis || {}) as AnalysisData;
  const timings = Array.isArray(signal.timings) ? signal.timings : [];
  const singlePress = analysis.single_press_candidate;
  const canOptimize =
    !data.optimized &&
    Array.isArray(singlePress?.timings) &&
    singlePress.timings.length > 0 &&
    singlePress.timings.length < timings.length;
  const ready =
    Boolean(String(data.name || "").trim()) &&
    Boolean(String(data.command_id || "").trim());

  const title = stage === "waiting"
    ? "Waiting for a remote signal"
    : stage === "preparing"
      ? "Signal received"
      : stage === "review"
        ? "Command captured"
        : stage === "error"
          ? "No usable signal was captured"
          : "Choose an IR receiver";
  const description = stage === "waiting"
    ? `Listening on ${selectedReceiver?.name || "the selected IR receiver"}`
    : stage === "preparing"
      ? "Preparing the captured timing preview."
      : stage === "review"
        ? "Name it, send it once if useful, then save it to this remote profile."
        : stage === "error"
          ? "The learning session stopped before a usable command was ready."
          : "This receiver is used only for this learning session.";

  let content: TemplateResult;
  let footer: TemplateResult | typeof nothing = nothing;

  if (stage === "waiting" || stage === "preparing") {
    const waiting = stage === "waiting";
    content = html`<section
      class=${`learn-capture-state ${waiting ? "waiting" : "preparing"}`}
      aria-live="polite"
    >
      <div class="learn-receiver-mark" aria-hidden="true">
        <ha-icon icon=${waiting ? "mdi:remote" : "mdi:square-wave"}></ha-icon>
      </div>
      <p>
        ${waiting
          ? html`Point the original remote at
              <strong>${selectedReceiver?.name || "the IR receiver"}</strong>
              and press the button once. A short, deliberate press works best.`
          : "Decoding the completed signal…"}
      </p>
      ${renderCaptureMotif(waiting ? "waiting" : "received")}
      ${waiting
        ? html`<div
            class="learn-countdown"
            style=${`--learn-progress: ${progress}deg`}
            aria-label=${`${remaining} seconds remaining`}
          >
            <div class="learn-countdown-copy">
              <strong>${remaining}s</strong>
              <span>seconds remaining</span>
            </div>
          </div>`
        : html`<ha-spinner aria-label="Preparing signal preview"></ha-spinner>`}
    </section>`;
    footer = renderDialogFooter([
      {
        label: "Cancel capture",
        onClick: () => onAction({ type: "close" }),
      },
    ]);
  } else if (stage === "error") {
    content = html`<section class="learn-error-state" role="alert">
      <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
      <p>${String(data.capture_error || "The receiver did not return a command.")}</p>
    </section>`;
    footer = renderDialogFooter([
      {
        label: "Return to profile",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: "Try again",
        icon: "mdi:refresh",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !data.infrared_receiver_ref,
        onClick: () => onAction({ type: "learn-retry" }),
      },
    ]);
  } else if (stage === "review") {
    content = html`<section class="learn-review">
      <div class="learn-review-waveform">
        <span>Signal received</span>
        ${timings.length
          ? html`<imprint-signal-waveform
              .readOnly=${true}
              .reveal=${true}
              .timings=${timings}
              .analysis=${analysis}
              .label=${"Captured IR timing waveform"}
            ></imprint-signal-waveform>`
          : renderWorkspaceNotice({
              icon: "mdi:information-outline",
              content: "The receiver returned a signal without editable timing data.",
            })}
      </div>
      ${renderFactGrid({
        facts: [
          {
            label: "Protocol",
            value: analysis.protocol || analysis.protocol_name || "Unknown",
          },
          {
            label: "Carrier",
            value: signal.carrier_frequency
              ? `${(signal.carrier_frequency / 1000).toFixed(1)} kHz`
              : "Not provided",
          },
          {
            label: "Duration",
            value: formatDuration(analysis.total_duration_us || 0),
          },
          { label: "Evidence", value: evidenceLabel(analysis) },
        ],
      })}
      ${canOptimize
        ? html`<ha-alert .alertType=${"warning"}>
            <div class="learn-optimization-notice">
              <span><strong>Repeated pattern detected.</strong>
                Previewing a single press may change hold or repeat behavior.</span>
              <ha-button
                appearance="outlined"
                variant="neutral"
                .disabled=${busy}
                @click=${() => onAction({ type: "learn-optimize" })}
              >Preview single press</ha-button>
            </div>
          </ha-alert>`
        : data.optimized
          ? html`<ha-alert .alertType=${"info"}>
              Single-press timing is previewed. Test it before saving.
            </ha-alert>`
          : nothing}
      <div class="learn-review-form">
        <ha-input
          autofocus
          .label=${"Command name"}
          .value=${String(data.name || "")}
          placeholder="e.g. Power"
          @input=${workflowFieldInput(onAction, "name")}
        ></ha-input>
        <ha-input
          .label=${"Command ID"}
          .value=${String(data.command_id || "")}
          placeholder="e.g. power"
          .disabled=${Boolean(data.relearn)}
          @input=${workflowFieldInput(onAction, "command_id")}
        ></ha-input>
      </div>
      ${!testEmitter
        ? renderWorkspaceNotice({
            icon: "mdi:access-point-off",
            content: "Choose Test with IR emitter in the remote profiles toolbar to test this capture. You can still save it.",
          })
        : testEmitter.available
          ? nothing
          : renderWorkspaceNotice({
              icon: "mdi:access-point-off",
              content: "The selected test IR emitter is unavailable. You can still save the capture.",
            })}
      <div class="learn-review-actions">
        <ha-button
          appearance="outlined"
          variant="neutral"
          .disabled=${busy || !testEmitter?.available}
          @click=${() => onAction({ type: "learn-test" })}
        ><ha-icon slot="start" icon="mdi:play"></ha-icon>Test once</ha-button>
        <ha-button
          appearance="accent"
          variant="brand"
          .disabled=${busy || !ready}
          @click=${() => onAction({ type: "learn-save", another: false })}
        ><ha-icon slot="start" icon="mdi:content-save-outline"></ha-icon>Save command</ha-button>
      </div>
      <div class="learn-review-secondary">
        <ha-button
          appearance="plain"
          variant="neutral"
          .disabled=${busy}
          @click=${() => onAction({ type: "learn-retry" })}
        >Capture again</ha-button>
        <ha-button
          appearance="plain"
          variant="neutral"
          .disabled=${busy || !ready}
          @click=${() => onAction({ type: "learn-save", another: true })}
        >Save & learn another</ha-button>
      </div>
      <ha-expansion-panel header="Technical details">
        <div class="learn-technical-body">
          <ha-select
            .label=${"Home Assistant shortcut (optional)"}
            .value=${String(data.role || "")}
            .options=${commandRoleOptions()}
            @selected=${workflowFieldSelected(onAction, "role")}
          ></ha-select>
          <ha-button
            appearance="outlined"
            variant="neutral"
            .disabled=${!preview.code}
            @click=${() => onAction({
              type: "learn-copy-code",
              code: String(preview.code || ""),
            })}
          ><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy raw code</ha-button>
          <pre><code>${JSON.stringify({
            format: preview.format,
            signal,
            analysis,
          }, null, 2)}</code></pre>
        </div>
      </ha-expansion-panel>
      <p class="learn-reassurance">
        <ha-icon icon="mdi:information-outline"></ha-icon>
        <span>Nothing is saved until you choose Save command.</span>
      </p>
    </section>`;
  } else {
    content = html`<section class="learn-chooser">
      <ha-select
        autofocus
        .label=${"IR receiver"}
        .value=${String(data.infrared_receiver_ref || "")}
        .options=${receiverOptions(receivers)}
        .disabled=${!receivers.length}
        @selected=${workflowFieldSelected(onAction, "infrared_receiver_ref")}
      ></ha-select>
      ${receivers.length
        ? renderWorkspaceNotice({
            icon: "mdi:information-outline",
            content: "Imprint could not safely infer a receiver. Choose one for this capture; appliance emitter assignments stay unchanged.",
          })
        : renderWorkspaceNotice({
            icon: "mdi:information-outline",
            content: "No Home Assistant IR receiver is available. Add or enable a receiver, then reopen this dialog.",
          })}
    </section>`;
    footer = renderDialogFooter([
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: "Begin listening",
        icon: "mdi:access-point",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !data.infrared_receiver_ref,
        onClick: () => onAction({ type: "learn-start" }),
      },
    ]);
  }

  return renderDialogShell({
    heading: title,
    description,
    error,
    busy,
    className: "learn-command-dialog",
    workflow: `learn-command-${stage}`,
    onClose: () => onAction({ type: "close" }),
    content,
    footer,
  });
};
