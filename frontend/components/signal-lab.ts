import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { LabPreview, ProtocolRebuild, RegistryData } from "../types";
import {
  emit,
  formatDuration,
  type BinaryDecoderMode,
} from "../core/utils";
import { showHomeAssistantToast } from "../core/notifications";
import { frameRanges, timingTotal, validateDraft } from "../core/signal";
import { safeCustomElement } from "../core/registration";
import {
  applySelectionTransform,
  makePreview,
  selectionRange,
  type ClipboardFormat,
  type SignalLabState,
} from "../core/signal-lab";
import { tokens } from "../styles";
import "./signal-lab/waveform";
import "./signal-lab/waveform-comparison";
import {
  dialogStyles,
  renderDialogFooter,
  renderDialogShell,
} from "./shared/dialog";
import { feedbackStyles, renderFeedback } from "./shared/feedback";
import { factGridStyles } from "./shared/metric-grid";
import { textareaFallbackStyles } from "./shared/textarea";
import { renderStatus, statusStyles } from "./shared/status";
import { workspaceNoticeStyles } from "./shared/workspace-notice";
import {
  renderSignalAdvancedTools,
  signalAdvancedToolsStyles,
} from "./signal-lab/advanced-tools";
import { SignalLabClipboardController } from "./signal-lab/clipboard-controller";
import {
  renderSignalCodeView,
  signalCodeViewStyles,
} from "./signal-lab/code-view";
import {
  renderSignalDecodedView,
  signalDecodedViewStyles,
} from "./signal-lab/decoded-view";
import type {
  SignalLabRequest,
  SignalLabRequestDetail,
} from "./signal-lab/events";
import {
  renderSignalPreviewDialog,
  signalPreviewDialogStyles,
} from "./signal-lab/preview-dialog";
import {
  renderSignalSaveDialog,
  signalSaveDialogStyles,
} from "./signal-lab/save-dialog";
import {
  renderSignalDetails,
  signalDetailsStyles,
} from "./signal-lab/signal-details";
import {
  renderSignalTimingEditor,
  signalTimingEditorStyles,
} from "./signal-lab/timing-editor";
import { renderTimingNudgeButtons } from "./signal-lab/timing-nudge-controls";
import { SignalLabToolsController } from "./signal-lab/tools-controller";

@safeCustomElement("imprint-signal-lab")
export class ImprintSignalLab extends LitElement {
  @property({ attribute: false }) lab: SignalLabState | null = null;
  @property({ attribute: false }) registry: RegistryData = {
    remote_profiles: {},
  };
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) emitterReady = true;
  @property() emitterName = "IR emitter";
  @property() offlineReason = "";
  @property() error = "";
  @state() private cooldownNow = Date.now();
  @state() private localPreview: LabPreview | null = null;
  @state() private convertFormat = "pronto";
  @state() private detailTab: "decoded" | "timings" | "code" = "timings";
  @state() private saveOpen = false;
  @state() private editingOverlays = false;
  @state() private binaryMode: BinaryDecoderMode = "auto";
  @state() private rebuildId = "";
  private cooldownTimer?: number;
  private readonly tools = new SignalLabToolsController(this);
  private readonly clipboard = new SignalLabClipboardController({
    action: (action, detail) => this.action(action, detail),
    preview: (preview) => {
      this.localPreview = preview;
    },
    notify: (message) => showHomeAssistantToast(this, message),
    setError: (message) => this.action("clipboard-error", { message }),
  });

  static styles = [
    tokens,
    dialogStyles,
    feedbackStyles,
    factGridStyles,
    textareaFallbackStyles,
    statusStyles,
    workspaceNoticeStyles,
    ...signalAdvancedToolsStyles,
    signalCodeViewStyles,
    signalDecodedViewStyles,
    signalPreviewDialogStyles,
    signalSaveDialogStyles,
    signalDetailsStyles,
    signalTimingEditorStyles,
    css`
    :host { display: block; min-width: 0; container: signal-lab / inline-size; }
    .lab { display: grid; gap: 14px; min-width: 0; }
    .head { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 12px; align-items: center; }
    .back { white-space: nowrap; }
    .title { min-width: 0; }
    .title h1 { margin-block-end: 3px; overflow-wrap: anywhere; }
    .title p { margin: 0; color: var(--imprint-muted); }
    .action-bar { display: grid; grid-template-columns: minmax(0,1fr) auto auto auto; gap: 8px; align-items: center; padding: 11px; position: sticky; inset-block-start: 0; z-index: 9; }
    .mobile-context { display: none; }
    .availability { min-width: 0; display: flex; gap: 8px; align-items: center; color: var(--imprint-muted); }
    .availability > ha-icon { color: var(--imprint-accent); font-size: 23px; }
    .availability strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--imprint-text); }
    .protection { display: inline-flex; align-items: center; gap: 6px; color: var(--imprint-text); font-size: 12px; font-weight: 700; white-space: nowrap; }
    .protection ha-icon { font-size: 21px; }
    .view-head { display: flex; gap: 12px; align-items: end; justify-content: space-between; }
    .view-head h2 { margin-block-end: 3px; }
    .view-head p { margin: 0; color: var(--imprint-muted); }
    .view-switch { display: inline-flex; padding: 3px; border-radius: 10px; background: var(--imprint-surface-2); }
    .view-switch ha-button { --ha-button-border-radius: 8px; }
    .wave-panel { padding: 15px; display: grid; gap: 12px; min-width: 0; }
    .wave-controls { display: flex; gap: 6px; }
    .one-press { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 14px 16px; }
    .one-press > ha-icon { color: var(--imprint-accent); font-size: 28px; }
    .one-press-copy { min-width: 0; display: grid; gap: 3px; }
    .one-press-copy h2, .one-press-copy p { margin: 0; }
    .one-press-copy p { color: var(--imprint-muted); }
    .workbench { display: grid; grid-template-columns: minmax(0,1.65fr) minmax(280px,.65fr); align-items: stretch; min-width: 0; }
    .editor { min-width: 0; border-inline-end: 1px solid var(--imprint-line); }
    .tabs { display: block; min-height: 56px; padding-inline: 18px; color: var(--imprint-muted); }
    .tabs ha-tab-group-tab { min-height: 52px; font-weight: 650; }
    .tab-content { min-width: 0; padding: 16px 18px 18px; }
    .timing-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-block-start: 14px; }
    .validity { margin-inline-start: auto; color: var(--imprint-success); display: inline-flex; gap: 7px; align-items: center; font-weight: 700; }
    .validity.invalid { color: var(--imprint-danger); }
    .edit-actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .edit-actions ha-button { min-height: 44px; }
    @container signal-lab (max-width: 940px) {
      .workbench { grid-template-columns: 1fr; }
      .editor { border-inline-end: 0; border-block-end: 1px solid var(--imprint-line); }
      .head { grid-template-columns: auto minmax(0,1fr); }
    }
    @container signal-lab (max-width: 650px) {
      .lab { gap: 10px; }
      .head { grid-template-columns: auto minmax(0,1fr); }
      .action-bar { position: sticky; inset-block-start: 0; grid-template-columns: 1fr 1fr; padding: 8px; }
      .action-bar .availability, .action-bar .protected { display: none; }
      .action-bar ha-button { min-width: 0; }
      .mobile-context { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 3px; color: var(--imprint-muted); font-size: 12px; }
      .mobile-context > ha-icon { color: var(--imprint-accent); font-size: 21px; }
      .mobile-context strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--imprint-text); }
      .mobile-context .protected { margin-inline-start: auto; }
      .view-head { align-items: stretch; flex-direction: column; }
      .view-switch { display: grid; grid-template-columns: 1fr 1fr; }
      .edit-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
      .one-press { grid-template-columns: auto minmax(0,1fr); }
      .one-press ha-button { grid-column: 1 / -1; justify-self: stretch; }
      .tabs { padding-inline: 8px; }
      .tab-content { padding: 14px; }
      .validity { inline-size: 100%; margin-inline-start: 0; }
    }
    @container signal-lab (max-width: 420px) { .edit-actions { grid-template-columns: 1fr; } .back span { display: none; } }
  `,
  ];

  private action(action: string, detail: Record<string, unknown> = {}): void {
    emit(this, "lab-action", { action, ...detail });
  }

  render() {
    const lab = this.lab;
    if (!lab) return nothing;
    const analysis = lab.dirty ? lab.draftAnalysis || {} : lab.sourceAnalysis;
    const validation = validateDraft(
      lab.timings,
      lab.carrierFrequency,
      analysis,
      lab.dirty,
    );
    const cooldown = Math.max(
      0,
      Math.ceil(((lab.testCooldownUntil || 0) - this.cooldownNow) / 1000),
    );
    const [selectionStart, selectionEnd] = selectionRange(
      lab.timings.length,
      lab.selectionStart,
      lab.selectionEnd,
    );
    const selection = lab.timings.slice(selectionStart, selectionEnd + 1);
    const frames = frameRanges(lab.timings);
    const selectedDuration = lab.timings[lab.selected] || 0;
    const cursorA = lab.cursors?.[0] || 0;
    const cursorB = lab.cursors?.[1] ?? timingTotal(lab.timings);
    const testDisabled =
      this.busy || !this.emitterReady || !validation.valid || cooldown > 0;
    const singlePress = analysis?.single_press_candidate;
    const canOptimize =
      Array.isArray(singlePress?.timings) &&
      singlePress.timings.length > 0 &&
      singlePress.timings.length < lab.timings.length;
    return html`<section class="lab">
      <header class="head">
        <ha-button class="back" appearance="outlined" variant="neutral" aria-label="Return to remote profiles" @click=${() => this.action("leave")}><ha-icon slot="start" icon="mdi:arrow-left"></ha-icon><span>Remote profiles</span></ha-button>
        <div class="title"><h1>${lab.view === "compare" ? "Compare signals" : "Signal Lab"}</h1><p>${lab.sourceName} · ${this.applianceName(lab)}</p></div>
      </header>

      <div class="action-bar panel">
        <div class="availability"><ha-icon icon="mdi:remote"></ha-icon><strong>${this.emitterName}</strong>${renderStatus({ state: this.emitterReady ? "idle" : "unavailable", busy: this.busy })}${!this.emitterReady && this.offlineReason ? html`<span> · ${this.offlineReason}</span>` : nothing}</div>
        <ha-button appearance="outlined" variant="neutral" .disabled=${testDisabled} @click=${() => this.action("test", { timings: [...lab.timings], carrierFrequency: lab.carrierFrequency })}><ha-icon slot="start" icon="mdi:play"></ha-icon>${cooldown ? `Retry in ${cooldown}s` : "Test once"}</ha-button>
        <ha-button appearance="accent" variant="brand" @click=${() => this.setLabUi({ saveOpen: true })}><ha-icon slot="start" icon="mdi:plus"></ha-icon>Save as new command</ha-button>
        <span class="protection protected"><ha-icon icon="mdi:information-outline"></ha-icon>Original is protected</span>
      </div>
      <div class="mobile-context" aria-label="Signal Lab context"><ha-icon icon="mdi:remote"></ha-icon><strong>${this.emitterName}</strong>${renderStatus({ state: this.emitterReady ? "idle" : "unavailable", busy: this.busy })}<span class="protection protected" title="The saved source cannot be overwritten"><ha-icon icon="mdi:lock-outline"></ha-icon>Protected</span></div>
      ${!lab.preview && !this.saveOpen && !lab.leavePrompt ? renderFeedback({ message: this.error }) : nothing}

      <section class="panel wave-panel">
        <div class="view-head"><div><h2>${lab.view === "compare" ? "Compare timing envelopes" : "Simulated timing envelope"}</h2><p>${lab.view === "compare" ? "Inspect both signals on one synchronized time scale." : "Wheel to zoom at the pointer. Drag to pan; pinch on touch screens."}</p></div><div class="actions"><div class="view-switch" role="group" aria-label="Signal Lab view"><ha-button appearance=${lab.view === "edit" ? "filled" : "plain"} variant="neutral" aria-pressed=${lab.view === "edit"} @click=${() => this.action("view", { view: "edit" })}>Edit</ha-button><ha-button appearance=${lab.view === "compare" ? "filled" : "plain"} variant="neutral" aria-pressed=${lab.view === "compare"} @click=${() => this.action("view", { view: "compare" })}>Compare</ha-button></div>${lab.view === "edit" ? html`<div class="wave-controls"><ha-icon-button .label=${"Zoom out"} .disabled=${lab.zoom <= 1} @click=${() => this.zoom(lab.zoom / 2)}><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></ha-icon-button><ha-button appearance="outlined" variant="neutral" title="Fit the whole signal" @click=${() => this.action("zoom", { zoom: 1, pan: 0 })}>Fit · ${lab.zoom.toFixed(lab.zoom % 1 ? 1 : 0)}×</ha-button><ha-icon-button .label=${"Zoom in"} .disabled=${lab.zoom >= 16} @click=${() => this.zoom(lab.zoom * 2)}><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></ha-icon-button></div>` : nothing}</div></div>
        ${lab.view === "compare"
          ? html`<imprint-waveform-comparison
              .beforeSignal=${{ label: "Protected source", timings: lab.original, carrierFrequency: lab.originalCarrierFrequency }}
              .afterSignal=${{ label: "Experiment", timings: lab.timings, carrierFrequency: lab.carrierFrequency }}
              .zoom=${lab.zoom}
              .pan=${lab.pan}
              .selectedIndex=${lab.selected}
              .selectable=${true}
              detail-level="full"
              @waveform-comparison-navigation=${this.relayNavigation}
              @waveform-comparison-select=${this.relayComparisonSelection}
            ><div slot="actions" class="edit-actions">${renderTimingNudgeButtons(lab.selected, (index, amount) => this.action("nudge", { index, amount }))}<ha-button appearance="outlined" variant="neutral" @click=${() => this.action("reset-selected", { index: lab.selected })}><ha-icon slot="start" icon="mdi:restore"></ha-icon>Reset selected</ha-button></div></imprint-waveform-comparison>`
          : html`<imprint-signal-waveform .timings=${lab.timings} .analysis=${analysis} .frameRoles=${lab.frameRoles}
              view="edit" interaction="edit" .zoom=${lab.zoom} .pan=${lab.pan} .selected=${lab.selected} .selectionStart=${lab.selectionStart} .selectionEnd=${lab.selectionEnd}
              .cursors=${lab.cursors} .activeCursor=${lab.activeCursor} .snap=${lab.snap} .boundaryMode=${lab.boundaryMode}
              .showCursors=${this.editingOverlays} .showFrames=${this.editingOverlays}
              @lab-navigation=${this.relayNavigation} @lab-selection=${this.relaySelection} @lab-cursor-change=${this.relayCursor}
              @lab-edge-change=${this.relayEdge} @lab-frame-select=${this.relayFrameSelect} @lab-shortcut=${this.handleShortcut}></imprint-signal-waveform>`}
      </section>

      ${
        canOptimize
          ? html`<section class="panel one-press" aria-labelledby="one-press-heading">
        <ha-icon icon="mdi:content-duplicate-off-outline"></ha-icon>
        <div class="one-press-copy"><h2 id="one-press-heading">Optimize for one press</h2><p>${singlePress?.removed_frames ?? Math.max(1, frames.length - Number(singlePress?.kept_frames || 1))} repeated frame${Number(singlePress?.removed_frames ?? 1) === 1 ? "" : "s"} can be removed from a preview. Your captured signal will not change until you apply it.</p></div>
        <ha-button appearance="outlined" variant="neutral" @click=${() => this.previewSinglePress(lab, analysis)}><ha-icon slot="start" icon="mdi:eye-outline"></ha-icon>Preview optimization</ha-button>
      </section>`
          : nothing
      }

      ${this.renderWorkbench(lab, analysis, validation, selectionStart, selectionEnd, selection.length, frames.length, selectedDuration, cursorA, cursorB)}

      ${lab.preview || this.localPreview ? renderSignalPreviewDialog({ lab, preview: (lab.preview || this.localPreview)!, busy: this.busy, error: this.error, request: this.requestSubview }) : nothing}
      ${this.saveOpen ? renderSignalSaveDialog({ lab, registry: this.registry, busy: this.busy, valid: validation.valid, error: this.error, request: this.requestSubview }) : nothing}
      ${lab.leavePrompt ? renderDialogShell({ heading: "Leave Signal Lab?", description: "This experiment has unsaved changes.", error: this.error, busy: this.busy, workflow: "leave-signal-lab", onClose: () => this.action("continue"), content: html``, footer: renderDialogFooter([
        { label: "Discard changes", variant: "danger", disabled: this.busy, onClick: () => this.action("discard-leave") },
        { label: "Keep draft", disabled: this.busy, onClick: () => this.action("keep-draft-leave") },
        { label: "Continue editing", variant: "brand", appearance: "accent", disabled: this.busy, onClick: () => this.action("continue") },
      ]) }) : nothing}
    </section>`;
  }

  private renderWorkbench(
    lab: SignalLabState,
    analysis: SignalLabState["sourceAnalysis"],
    validation: ReturnType<typeof validateDraft>,
    selectionStart: number,
    selectionEnd: number,
    selectionLength: number,
    frameCount: number,
    selectedDuration: number,
    cursorA: number,
    cursorB: number,
  ) {
    const binaryMode = lab.binaryDecoderMode || this.binaryMode;
    return html`<section class="panel workbench">
      <div class="editor">
        <ha-tab-group class="tabs" aria-label="Signal representations" tab-only>
          ${(["decoded", "timings", "code"] as const).map(
            (tab) => html`<ha-tab-group-tab
            panel=${tab} .active=${this.detailTab === tab} @click=${() => this.selectDetailTab(tab)}>${tab === "decoded" ? "Decoded" : tab === "timings" ? "Timings" : "Encoded code"}</ha-tab-group-tab>`,
          )}
        </ha-tab-group>
        <div class="tab-content" role="tabpanel">
          ${
            this.detailTab === "timings"
              ? html`
            ${renderSignalTimingEditor({ timings: lab.timings, original: lab.original, selected: lab.selected, selectionStart: lab.selectionStart, selectionEnd: lab.selectionEnd, snap: lab.snap, request: this.requestSubview })}
            <div class="timing-actions">
              <ha-button appearance="outlined" variant="neutral" @click=${() => this.action("add-pair", { after: selectionEnd })}><ha-icon slot="start" icon="mdi:plus"></ha-icon>Add pulse pair</ha-button>
              <ha-button appearance="outlined" variant="neutral" .disabled=${!lab.dirty} @click=${() => this.action("reset")}><ha-icon slot="start" icon="mdi:restore"></ha-icon>Reset</ha-button>
              <span class="validity ${validation.valid ? "" : "invalid"}"><ha-icon icon=${validation.valid ? "mdi:check-circle" : "mdi:alert-circle-outline"}></ha-icon>${validation.valid ? "Valid" : "Needs attention"} · ${lab.timings.length} pulses · ${formatDuration(timingTotal(lab.timings))}</span>
            </div>
            ${renderSignalAdvancedTools({ lab, busy: this.busy, selectionStart, selectionEnd, selectionLength, frameCount, selectedDuration, cursors: [cursorA, cursorB], editingOverlays: this.editingOverlays, tools: this.tools, request: this.requestSubview })}
          `
              : this.detailTab === "decoded"
                ? renderSignalDecodedView({ analysis, analysisPending: Boolean(lab.analysisPending), frameCount, binaryMode, request: this.requestSubview })
                : renderSignalCodeView({ lab, format: this.convertFormat, request: this.requestSubview })
          }
        </div>
      </div>
      ${renderSignalDetails({ lab, analysis, validation, rebuildId: this.rebuildId, request: this.requestSubview })}
    </section>`;
  }

  protected updated(changed: Map<PropertyKey, unknown>): void {
    if (changed.has("lab") && this.lab) {
      this.detailTab = this.lab.detailTab || "timings";
      this.convertFormat = this.lab.convertFormat || "pronto";
      this.saveOpen = Boolean(this.lab.saveOpen);
      this.editingOverlays = Boolean(this.lab.editingOverlays);
      this.binaryMode = this.lab.binaryDecoderMode || "auto";
      const rebuilds = this.lab.dirty
        ? this.lab.draftAnalysis?.protocol_rebuilds
        : this.lab.sourceAnalysis.protocol_rebuilds;
      if (!rebuilds?.some((item) => item.id === this.rebuildId))
        this.rebuildId = rebuilds?.[0]?.id || "";
    }
    if (
      this.detailTab === "code" &&
      (changed.has("lab") ||
        changed.has("convertFormat") ||
        changed.has("detailTab"))
    )
      this.ensureCodeRepresentation();
    if (changed.has("lab")) this.syncCooldownTimer();
  }

  disconnectedCallback(): void {
    window.clearInterval(this.cooldownTimer);
    this.cooldownTimer = undefined;
    super.disconnectedCallback();
  }

  private syncCooldownTimer(): void {
    window.clearInterval(this.cooldownTimer);
    this.cooldownTimer = undefined;
    const now = Date.now();
    if (!this.lab?.testCooldownUntil || this.lab.testCooldownUntil <= now) return;
    this.cooldownNow = now;
    this.cooldownTimer = window.setInterval(() => {
      this.cooldownNow = Date.now();
      if (
        !this.lab?.testCooldownUntil ||
        this.lab.testCooldownUntil <= this.cooldownNow
      ) {
        window.clearInterval(this.cooldownTimer);
        this.cooldownTimer = undefined;
      }
    }, 500);
  }

  private setLabUi(
    patch: Partial<
      Pick<
        SignalLabState,
        "detailTab" | "convertFormat" | "saveOpen" | "editingOverlays"
      >
    >,
  ): void {
    if (patch.detailTab) this.detailTab = patch.detailTab;
    if (patch.convertFormat) this.convertFormat = patch.convertFormat;
    if (patch.saveOpen !== undefined) this.saveOpen = patch.saveOpen;
    if (patch.editingOverlays !== undefined)
      this.editingOverlays = patch.editingOverlays;
    this.action("ui", { patch });
  }

  private setBinaryMode(mode: BinaryDecoderMode): void {
    this.binaryMode = mode;
    this.action("ui", { patch: { binaryDecoderMode: mode } });
  }

  private codeRepresentationKey(lab: SignalLabState): string {
    return `${this.convertFormat}|${lab.carrierFrequency}|${lab.timings.join(",")}`;
  }

  private ensureCodeRepresentation(force = false): void {
    const lab = this.lab;
    if (!lab || this.detailTab !== "code") return;
    const key = this.codeRepresentationKey(lab);
    if (!force && lab.codeRepresentation?.key === key) return;
    this.action("code-representation", {
      key,
      format: this.convertFormat,
      timings: [...lab.timings],
      carrierFrequency: lab.carrierFrequency,
    });
  }

  private selectDetailTab(tab: "decoded" | "timings" | "code"): void {
    this.setLabUi({ detailTab: tab });
  }

  private applianceName(lab: SignalLabState) {
    return (
      this.registry.remote_profiles?.[lab.remoteProfileId]?.name ||
      lab.remoteProfileId ||
      "No remote profile"
    );
  }

  private relayNavigation(event: CustomEvent): void {
    this.action("zoom", event.detail);
  }
  private relaySelection(event: CustomEvent): void {
    const { selected, start, end, ...rest } = event.detail;
    this.action("select", {
      index: selected,
      selectionStart: start,
      selectionEnd: end,
      ...rest,
    });
  }
  private relayComparisonSelection(event: CustomEvent): void {
    const index = Number(event.detail?.index || 0);
    this.action("select", {
      index,
      selectionStart: index,
      selectionEnd: index,
      revealTable: true,
    });
  }
  private relayCursor(event: CustomEvent): void {
    this.action("cursor", event.detail);
  }
  private relayEdge(event: CustomEvent): void {
    this.action("edge", event.detail);
  }
  private relayFrameSelect(event: CustomEvent): void {
    this.action("frame", { operation: "select", ...event.detail });
  }
  private handleShortcut(event: CustomEvent): void {
    const action = event.detail.action;
    if (action === "copy" && this.lab)
      void this.clipboard.copySelection(this.lab, false);
    else if (action === "cut" && this.lab)
      void this.clipboard.copySelection(this.lab, true);
    else if (action === "paste" && this.lab)
      void this.clipboard.pasteSelection(this.lab);
    else if (action === "escape") this.handleEscape();
    else {
      const { action: _action, ...detail } = event.detail;
      if (
        ["duplicate-selection", "delete-selection", "reset-selection"].includes(
          action,
        ) &&
        this.lab
      ) {
        const [start, end] = selectionRange(
          this.lab.timings.length,
          this.lab.selectionStart,
          this.lab.selectionEnd,
        );
        this.action(action, { ...detail, start, end });
      } else this.action(action, detail);
    }
  }

  private readonly requestSubview: SignalLabRequest = (action, detail = {}): void => {
    this.handleComponentRequest({ action, ...detail });
  };

  private handleComponentRequest(request: SignalLabRequestDetail): void {
    const lab = this.lab;
    switch (request.action) {
      case "binary-mode":
        this.setBinaryMode(request.mode as BinaryDecoderMode);
        return;
      case "code-format":
        this.setLabUi({ convertFormat: String(request.format || "pronto") });
        return;
      case "copy-code":
        void this.clipboard.copyCode(
          String(request.value || ""),
          request.success ? String(request.success) : undefined,
        );
        return;
      case "retry-code":
        this.ensureCodeRepresentation(true);
        return;
      case "lab-action":
        this.action(
          String(request.labAction || ""),
          (request.detail as Record<string, unknown>) || {},
        );
        return;
      case "editing-overlays":
        this.setLabUi({ editingOverlays: Boolean(request.value) });
        return;
      case "copy-selection":
        if (lab)
          void this.clipboard.copySelection(
            lab,
            Boolean(request.cut),
            request.format as ClipboardFormat,
          );
        return;
      case "paste-selection":
        if (lab) void this.clipboard.pasteSelection(lab);
        return;
      case "preview-transform":
        if (lab)
          this.previewTransform(
            request.kind as
              | "scale"
              | "round"
              | "normalize"
              | "gap"
              | "align_frames",
            lab,
            request.range as [number, number],
            (request.options as {
              scale?: number;
              quantum?: number;
              gap?: number;
            }) || {},
          );
        return;
      case "preview-rebuild":
        this.previewProtocolRebuild(request.rebuild as ProtocolRebuild);
        return;
      case "rebuild-id":
        this.rebuildId = String(request.rebuildId || "");
        return;
      case "close-save":
        this.setLabUi({ saveOpen: false });
        return;
      case "copy-whole-signal":
        if (lab) void this.clipboard.copyWholeSignal(lab);
        return;
      case "cancel-preview":
        this.cancelPreview();
        return;
      case "apply-preview":
        this.applyPreview(request.preview as LabPreview);
        return;
    }
  }

  private zoom(zoom: number): void {
    this.action("zoom", { zoom: Math.max(1, Math.min(16, zoom)) });
  }

  private previewTransform(
    kind: "scale" | "round" | "normalize" | "gap" | "align_frames",
    lab: SignalLabState,
    range: [number, number],
    options: { scale?: number; quantum?: number; gap?: number } = {},
  ): void {
    const timings = applySelectionTransform(kind, lab.timings, range, options);
    if (
      timings.length === lab.timings.length &&
      timings.every((value, index) => value === lab.timings[index])
    ) {
      showHomeAssistantToast(
        this,
        kind === "normalize"
          ? "No similar timings in this draft need smoothing."
          : "This transform would not change the current draft.",
      );
      return;
    }
    const warning =
      kind === "align_frames"
        ? "Alignment replaces timing jitter across structurally equal frames. Review repeat behavior before saving."
        : "";
    const title = this.transformName(kind);
    const metadata =
      kind === "normalize"
        ? {
            description:
              "Similar measured timings were averaged. Protocol rules were not used.",
            timingBasis: "Current-draft averages",
            applyLabel: "Apply smoothed timings",
          }
        : {};
    this.localPreview = {
      ...makePreview(title, lab.timings, timings, lab.sourceAnalysis, warning),
      ...metadata,
    };
    this.action("preview", { kind: title, timings, warning, ...metadata });
  }

  private previewProtocolRebuild(rebuild: ProtocolRebuild): void {
    if (!rebuild.changed_timings && !rebuild.carrier_changed) {
      showHomeAssistantToast(
        this,
        `This draft already matches the ${rebuild.protocol} standard.`,
      );
      return;
    }
    this.action("rebuild-preview", {
      rebuildId: rebuild.id,
      protocol: rebuild.protocol,
    });
  }

  private previewSinglePress(
    lab: SignalLabState,
    analysis = lab.draftAnalysis || lab.sourceAnalysis,
  ): void {
    const timings = analysis?.single_press_candidate?.timings;
    if (!Array.isArray(timings) || !timings.length) return;
    const warning = String(
      analysis?.single_press_candidate?.warning ||
        "This preview removes repeated frames and may alter hold behavior. Test once before saving.",
    );
    this.localPreview = makePreview(
      "Optimize for one press",
      lab.timings,
      timings,
      analysis,
      warning,
    );
    this.action("preview", { kind: "single_press", timings, warning });
  }

  private transformName(kind: string): string {
    return (
      (
        {
          scale: "Scale timings",
          round: "Round timings",
          normalize: "Smooth timing jitter",
          gap: "Set interframe gap",
          align_frames: "Align repeated frames",
        } as Record<string, string>
      )[kind] || kind
    );
  }

  private applyPreview(preview: LabPreview): void {
    if (!this.clipboard.applyPastePreview(preview))
      this.action("preview-apply", {
        kind: preview.kind,
        timings: [...preview.timings],
        carrierFrequency: preview.carrierFrequency,
        frameRoles: preview.frameRoles,
      });
    this.localPreview = null;
  }

  private cancelPreview = (): void => {
    this.localPreview = null;
    this.clipboard.cancelPreview();
    this.action("preview-cancel");
  };
  private handleEscape(): void {
    if (this.localPreview || this.lab?.preview) this.cancelPreview();
    else if (this.lab?.leavePrompt) this.action("continue");
    else this.action("leave");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-signal-lab": ImprintSignalLab;
  }
}
