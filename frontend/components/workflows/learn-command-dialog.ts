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
import { renderSignalCaptureState } from "../shared/signal-capture-state";
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
  .learn-match-notice,
  .learn-catalog-list,
  .learn-catalog-review {
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .learn-match-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .learn-catalog-list { padding-top: 12px; }
  .learn-catalog-match {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--divider-color);
  }
  .learn-catalog-match:last-of-type { border-bottom: 0; }
  .learn-catalog-match strong,
  .learn-catalog-match span { display: block; }
  .learn-catalog-match span,
  .learn-catalog-review p {
    margin: 3px 0 0;
    color: var(--imprint-muted);
    line-height: 1.4;
  }
  .learn-catalog-review {
    padding: 12px;
    border-radius: 12px;
    background: var(--imprint-surface-2);
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
  @media (max-width: 520px) {
    .learn-review-form,
    .learn-review-actions { grid-template-columns: 1fr; }
    .learn-optimization-notice { grid-template-columns: 1fr; }
    .learn-optimization-notice ha-button { justify-self: start; }
  }
`;

export const renderLearnCommandDialog = ({
  data,
  receivers,
  testEmitter,
  error = "",
  busy = false,
  capturing = false,
  captureRemaining = 0,
  captureTimeout = 60,
  onAction,
}: LearnCommandDialogOptions): TemplateResult => {
  const stage = String(data.stage || "choose");
  const selectedReceiver = receivers.find(
    (receiver) => receiver.ref === String(data.infrared_receiver_ref || ""),
  );
  const preview = (data.preview || {}) as Dict;
  const signal = (preview.signal || {}) as SignalData;
  const analysis = (preview.analysis || {}) as AnalysisData;
  const timings = Array.isArray(signal.timings) ? signal.timings : [];
  const duplicateMatch =
    data.duplicate_match && typeof data.duplicate_match === "object"
      ? (data.duplicate_match as Dict)
      : null;
  const catalogMatches = Array.isArray(data.catalog_matches)
    ? (data.catalog_matches as Dict[])
    : [];
  const catalogReview =
    data.catalog_match_review && typeof data.catalog_match_review === "object"
      ? (data.catalog_match_review as Dict)
      : null;
  const singlePress = analysis.single_press_candidate;
  const canOptimize =
    !data.optimized &&
    Array.isArray(singlePress?.timings) &&
    singlePress.timings.length > 0 &&
    singlePress.timings.length < timings.length;
  const ready =
    Boolean(String(data.name || "").trim()) &&
    Boolean(String(data.command_id || "").trim());

  const title =
    stage === "waiting"
    ? "Waiting for a remote signal"
    : stage === "preparing"
      ? "Signal received"
      : stage === "review"
        ? "Command captured"
        : stage === "error"
          ? "No usable signal was captured"
          : "Choose an IR receiver";
  const description =
    stage === "waiting"
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
    content = renderSignalCaptureState({
      phase: waiting ? "listening" : "processing",
      active: waiting ? capturing : true,
      receiverName: selectedReceiver?.name || "the IR receiver",
      remaining: captureRemaining,
      timeout: captureTimeout,
      listeningContent: html`Point the original remote at
        <strong>${selectedReceiver?.name || "the IR receiver"}</strong>
        and press the button once. A short, deliberate press works best.`,
      processingContent: "Decoding the completed signal…",
      processingLabel: "Preparing signal preview",
    });
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
        ${
          timings.length
          ? html`<imprint-signal-waveform
              .readOnly=${true}
              .reveal=${true}
              .timings=${timings}
              .analysis=${analysis}
              .label=${"Captured IR timing waveform"}
            ></imprint-signal-waveform>`
          : renderWorkspaceNotice({
              icon: "mdi:information-outline",
                content:
                  "The receiver returned a signal without editable timing data.",
              })
        }
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
            value: formatDuration(
              analysis.total_duration_us ||
                timings.reduce((total, timing) => total + timing, 0),
            ),
          },
          { label: "Evidence", value: evidenceLabel(analysis) },
        ],
      })}
      ${
        data.analysis_error
          ? html`<ha-alert .alertType=${"warning"}>
            <strong>Signal analysis is unavailable.</strong>
            The raw capture is intact and can still be tested or saved.
          </ha-alert>`
          : nothing
      }
      ${
        canOptimize
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
              Single-press timing is previewed. Saving retains the original
              capture as the prior revision. Test this version before relying
              on it.
            </ha-alert>`
            : nothing
      }
      ${
        duplicateMatch
          ? html`<ha-alert .alertType=${"warning"}>
            <div class="learn-match-notice">
              <span><strong>This looks like
                ${String(duplicateMatch.command_name || "an existing command")}.</strong>
                It is already saved in
                ${String(duplicateMatch.remote_profile_name || "another remote profile")}.
              </span>
              <div class="learn-match-actions">
                <ha-button
                  appearance="outlined"
                  variant="neutral"
                  .disabled=${busy}
                  @click=${() =>
                    onAction({
                      type: "learn-duplicate-open",
                      match: duplicateMatch,
                    })}
                >Review existing</ha-button>
                <ha-button
                  appearance="outlined"
                  variant="neutral"
                  .disabled=${busy}
                  @click=${() =>
                    onAction({
                      type: "learn-duplicate-replace",
                      match: duplicateMatch,
                    })}
                >Replace existing</ha-button>
                <ha-button
                  appearance="plain"
                  variant="neutral"
                  .disabled=${busy}
                  @click=${() => onAction({ type: "learn-duplicate-ignore" })}
                >Save separately</ha-button>
              </div>
            </div>
          </ha-alert>`
          : data.duplicate_replacement
            ? html`<ha-alert .alertType=${"info"}>
              Saving will add this capture as a new revision of the existing
              command.
            </ha-alert>`
            : nothing
      }
      ${
        catalogMatches.length
          ? html`<ha-expansion-panel
            .header=${`Offline catalog matches (${catalogMatches.length})`}
          >
            <div class="learn-catalog-list">
              ${catalogMatches.slice(0, 5).map((match) => {
                const profile = (match.profile || {}) as Dict;
                const command = (match.command || {}) as Dict;
                return html`<div class="learn-catalog-match">
                  <div>
                    <strong>${String(command.name || "Matching command")}</strong>
                    <span>${String(profile.name || profile.profile_id || "Catalog profile")}</span>
                  </div>
                  <ha-button
                    appearance="outlined"
                    variant="neutral"
                    .disabled=${busy}
                    @click=${() =>
                      onAction({
                        type: "learn-catalog-review",
                        match,
                      })}
                  >Review profile</ha-button>
                </div>`;
              })}
              ${
                catalogReview
                  ? html`<div class="learn-catalog-review">
                    <strong>${String(
                      catalogReview.name ||
                        catalogReview.model ||
                        catalogReview.profile_id ||
                        "Catalog profile",
                    )}</strong>
                    <p>${[
                      catalogReview.brand,
                      catalogReview.model,
                      Array.isArray(catalogReview.commands)
                        ? `${catalogReview.commands.length} commands`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}</p>
                    <div class="learn-match-actions">
                      <ha-button
                        appearance="plain"
                        variant="neutral"
                        @click=${() =>
                          onAction({
                            type: "learn-catalog-review-close",
                          })}
                      >Close review</ha-button>
                    </div>
                  </div>`
                  : nothing
              }
            </div>
          </ha-expansion-panel>`
          : nothing
      }
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
      ${
        !testEmitter
        ? renderWorkspaceNotice({
            icon: "mdi:access-point-off",
              content:
                "Choose Test with IR emitter in the remote profiles toolbar to test this capture. You can still save it.",
          })
        : testEmitter.available
          ? nothing
          : renderWorkspaceNotice({
              icon: "mdi:access-point-off",
                content:
                  "The selected test IR emitter is unavailable. You can still save the capture.",
              })
      }
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
            @click=${() =>
              onAction({
              type: "learn-copy-code",
              code: String(preview.code || ""),
            })}
          ><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy raw code</ha-button>
          <pre><code>${JSON.stringify(
            {
            format: preview.format,
            signal,
            analysis,
              analysis_error: data.analysis_error || undefined,
              catalog_matches: catalogMatches,
            },
            null,
            2,
          )}</code></pre>
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
      ${
        receivers.length
        ? renderWorkspaceNotice({
            icon: "mdi:information-outline",
              content: data.infrared_receiver_ref
                ? "A receiver is suggested from the current hardware context. Confirm it or choose another; this selection applies only to this learning session."
                : "Choose a receiver for this capture. Appliance emitter assignments stay unchanged.",
          })
        : renderWorkspaceNotice({
            icon: "mdi:information-outline",
              content:
                "No Home Assistant IR receiver is available. Add or enable a receiver, then reopen this dialog.",
            })
      }
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
