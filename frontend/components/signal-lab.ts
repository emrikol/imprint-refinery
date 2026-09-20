import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { LabPreview, ProtocolRebuild, RegistryData } from "../types";
import {
  applianceDisplayName,
  binaryDecoderChoices,
  binaryDecoderMessage,
  binaryEncodingLabel,
  binaryPayloadExplanation,
  binaryPayloadFor,
  binaryScoreLabel,
  decodedInteger,
  emit,
  evidenceLabel,
  formatDuration,
  groupedBinary,
  locationDisplayName,
  repeatSummary,
  slugify,
  validId,
  type BinaryDecoderMode,
} from "../core/utils";
import { frameRanges, timingTotal, validateDraft } from "../core/signal";
import { safeCustomElement } from "../core/registration";
import {
  applySelectionTransform,
  compareTimings,
  estimatedPayloadBytes,
  formatTimingSelection,
  makePreview,
  parseTimingClipboard,
  pasteParityError,
  selectModeRange,
  selectionRange,
  type ClipboardFormat,
  type SelectionMode,
  type SignalLabState,
} from "../core/signal-lab";
import { featureStyles } from "../styles";
import "./primitives";
import "./signal-lab/frame-editor";
import "./signal-lab/timing-editor";
import "./signal-lab/waveform";

interface PasteContext {
  start: number;
  end: number;
  timings: number[];
  carrierFrequency?: number;
}

@safeCustomElement("imprint-signal-lab")
export class ImprintSignalLab extends LitElement {
  @property({ attribute: false }) lab: SignalLabState | null = null;
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) emitterReady = true;
  @property() emitterName = "IR emitter";
  @property() offlineReason = "";
  @property({ type: Number }) now = Date.now();
  @state() private scale = 100;
  @state() private quantum = 50;
  @state() private gap = 20_000;
  @state() private copyFormat: ClipboardFormat = "signed";
  @state() private localPreview: LabPreview | null = null;
  @state() private pasteContext: PasteContext | null = null;
  @state() private clipboardMessage = "";
  @state() private convertFormat = "pronto";
  @state() private detailTab: "decoded" | "timings" | "code" = "timings";
  @state() private saveOpen = false;
  @state() private editingOverlays = false;
  @state() private binaryMode: BinaryDecoderMode = "auto";
  @state() private rebuildId = "";
  @state() private transformMessage = "";

  static styles = [
    featureStyles,
    css`
    :host { display: block; min-width: 0; }
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
    .view-switch button { min-height: 44px; border: 0; border-radius: 8px; background: transparent; padding: 7px 13px; font-weight: 700; }
    .view-switch button[aria-pressed="true"] { background: var(--imprint-surface); box-shadow: 0 2px 8px rgba(0,0,0,.09); }
    .wave-panel { padding: 15px; display: grid; gap: 12px; min-width: 0; }
    .wave-controls { display: flex; gap: 6px; }
    .one-press { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 12px; padding: 14px 16px; }
    .one-press > ha-icon { color: var(--imprint-accent); font-size: 28px; }
    .one-press-copy { min-width: 0; display: grid; gap: 3px; }
    .one-press-copy h2, .one-press-copy p { margin: 0; }
    .one-press-copy p { color: var(--imprint-muted); }
    .workbench { display: grid; grid-template-columns: minmax(0,1.65fr) minmax(280px,.65fr); align-items: stretch; min-width: 0; }
    .editor { min-width: 0; border-inline-end: 1px solid var(--imprint-line); }
    .tabs { display: flex; gap: 6px; min-height: 56px; align-items: end; padding: 0 18px; border-block-end: 1px solid var(--imprint-line); }
    .tab { min-height: 52px; border: 0; border-block-end: 3px solid transparent; background: transparent; padding: 12px 15px 10px; font-weight: 650; }
    .tab[aria-selected="true"] { color: var(--imprint-accent); border-block-end-color: var(--imprint-accent); }
    .tab-content { min-width: 0; padding: 16px 18px 18px; }
    .timing-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-block-start: 14px; }
    .validity { margin-inline-start: auto; color: var(--imprint-success); display: inline-flex; gap: 7px; align-items: center; font-weight: 700; }
    .validity.invalid { color: var(--imprint-danger); }
    .signal-details { padding: 18px; display: grid; align-content: start; gap: 16px; }
    .signal-details h2, .signal-details h3 { margin: 0; }
    .detail-list { display: grid; gap: 13px; }
    .detail-row { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 10px; align-items: center; }
    .detail-row ha-icon { color: var(--imprint-muted); font-size: 21px; }
    .detail-row.success ha-icon { color: var(--imprint-success); }
    .detail-row small { display: block; color: var(--imprint-muted); margin-block-start: 2px; }
    .signal-details hr { width: 100%; border: 0; border-block-start: 1px solid var(--imprint-line); }
    .generation { display: grid; gap: 12px; }
    .refine-action { display: grid; gap: 8px; padding-block: 2px 12px; }
    .refine-action + .refine-action { border-block-start: 1px solid var(--imprint-line); padding-block-start: 13px; }
    .refine-action small { color: var(--imprint-muted); }
    .refine-action .btn { justify-self: start; }
    .choice { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 10px; align-items: start; cursor: pointer; }
    .choice input { inline-size: 20px; block-size: 20px; accent-color: var(--imprint-accent); }
    .choice small { display: block; color: var(--imprint-muted); margin-block-start: 2px; }
    .advanced-tools { margin-block-start: 16px; border-block-start: 1px solid var(--imprint-line); padding-block-start: 12px; }
    .advanced-tools summary { cursor: pointer; font-weight: 700; }
    .advanced-body { display: grid; gap: 14px; padding-block-start: 14px; }
    .advanced-section { display: grid; gap: 10px; }
    .advanced-section h3 { margin: 0; }
    .selection-settings { display: grid; grid-template-columns: repeat(4,minmax(130px,1fr)); gap: 8px; }
    .edit-actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .edit-actions .btn { min-height: 44px; }
    .transform { display: grid; gap: 9px; }
    .transform-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 7px; align-items: end; }
    .transform-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }
    .save-dialog { display: grid; gap: 12px; }
    .save-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .decoded { display: grid; gap: 12px; }
    .decoded-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; }
    .binary-readout { display: grid; gap: 10px; padding-block: 14px; border-block: 1px solid var(--imprint-line); }
    .binary-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
    .binary-head > div { display: grid; gap: 2px; }
    .binary-head small, .binary-note { color: var(--imprint-muted); }
    .binary-value { margin: 0; padding: 13px; overflow-x: auto; border-radius: 10px; background: var(--imprint-surface-2); font: 650 16px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .035em; white-space: pre-wrap; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; user-select: all; }
    .binary-actions { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .decoder-control { display: grid; grid-template-columns: minmax(180px, 320px); }
    .candidate-facts { display: flex; gap: 10px; flex-wrap: wrap; margin-block-start: 5px; color: var(--imprint-muted); }
    .candidate-facts code { color: var(--imprint-text); }
    .alternatives { border-block-start: 1px solid var(--imprint-line); padding-block-start: 9px; }
    .alternatives summary { cursor: pointer; color: var(--imprint-muted); font-weight: 700; }
    .alternatives[open] summary { margin-block-end: 8px; }
    .code-tools { display: grid; gap: 14px; }
    .code-toolbar { display: grid; grid-template-columns: minmax(220px,1fr) auto; gap: 8px; align-items: end; }
    .code-surface { min-width: 0; display: grid; gap: 8px; }
    .code-surface-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .code-surface-head strong { min-width: 0; overflow-wrap: anywhere; }
    .encoded-value {
      display: block; width: 100%; min-height: 260px; resize: vertical; border: 1px solid var(--imprint-line);
      border-radius: 10px; padding: 13px; background: var(--imprint-surface-2); color: var(--imprint-text);
      font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums;
      overflow: auto; white-space: pre; scrollbar-color: var(--imprint-muted) transparent;
    }
    .compare { display: grid; gap: 9px; }
    .compare-summary { display: flex; justify-content: space-between; gap: 12px; }
    .diffs { display: grid; gap: 4px; max-height: 240px; overflow: auto; }
    .diff { min-height: 44px; display: grid; grid-template-columns: 42px 70px minmax(0,1fr) auto; gap: 8px; align-items: center; border: 1px solid transparent; border-radius: 8px; background: transparent; padding: 6px 9px; text-align: start; }
    .diff:hover, .diff.selected { background: var(--imprint-accent-soft); border-color: var(--imprint-accent); }
    .diff code { min-width: 0; overflow-wrap: anywhere; }
    .diff em { color: var(--imprint-muted); font-style: normal; font-variant-numeric: tabular-nums; }
    .preview-metrics { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px; margin-block: 13px; }
    .preview-actions { justify-content: flex-end; margin-block-start: 16px; }
    @media (max-width: 940px) {
      .workbench { grid-template-columns: 1fr; }
      .editor { border-inline-end: 0; border-block-end: 1px solid var(--imprint-line); }
      .selection-settings { grid-template-columns: repeat(2,minmax(0,1fr)); }
      .head { grid-template-columns: auto minmax(0,1fr); }
    }
    @media (max-width: 650px) {
      .lab { gap: 10px; }
      .head { grid-template-columns: auto minmax(0,1fr); }
      .action-bar { position: sticky; inset-block-start: 0; grid-template-columns: 1fr 1fr; padding: 8px; }
      .action-bar .availability, .action-bar .protected { display: none; }
      .action-bar .btn { min-width: 0; padding-inline: 9px; }
      .mobile-context { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 3px; color: var(--imprint-muted); font-size: 12px; }
      .mobile-context > ha-icon { color: var(--imprint-accent); font-size: 21px; }
      .mobile-context strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--imprint-text); }
      .mobile-context .protected { margin-inline-start: auto; }
      .view-head { align-items: stretch; flex-direction: column; }
      .view-switch { display: grid; grid-template-columns: 1fr 1fr; }
      .selection-settings, .transform-actions, .save-actions, .decoded-fields { grid-template-columns: 1fr; }
      .edit-actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
      .one-press { grid-template-columns: auto minmax(0,1fr); }
      .one-press .btn { grid-column: 1 / -1; justify-self: stretch; }
      .tabs { overflow-x: auto; padding-inline: 8px; }
      .tab { padding-inline: 11px; white-space: nowrap; }
      .tab-content, .signal-details { padding: 14px; }
      .code-toolbar { grid-template-columns: 1fr; }
      .code-toolbar .btn { width: 100%; }
      .encoded-value { min-height: 220px; }
      .validity { inline-size: 100%; margin-inline-start: 0; }
      .diff { grid-template-columns: 34px 60px minmax(0,1fr); }
      .diff em { grid-column: 3; }
    }
    @media (max-width: 420px) { .edit-actions { grid-template-columns: 1fr; } .preview-metrics { grid-template-columns: 1fr; } .back span { display: none; } }
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
      Math.ceil(((lab.testCooldownUntil || 0) - this.now) / 1000),
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
    return html`<section class="lab" @keydown=${this.onLabKeydown}>
      <header class="head">
        <button class="btn back" aria-label="Return to command library" @click=${() => this.action("leave")}><ha-icon icon="mdi:arrow-left"></ha-icon><span>Command library</span></button>
        <div class="title"><h1>${lab.view === "compare" ? "Compare signals" : "Signal Lab"}</h1><p>${lab.sourceName} · ${this.applianceName(lab)}</p></div>
      </header>

      <div class="action-bar panel">
        <div class="availability"><ha-icon icon="mdi:remote"></ha-icon><strong>${this.emitterName}</strong><imprint-status .state=${this.emitterReady ? "idle" : "unavailable"} .busy=${this.busy}></imprint-status>${!this.emitterReady && this.offlineReason ? html`<span> · ${this.offlineReason}</span>` : nothing}</div>
        <button class="btn" ?disabled=${testDisabled} @click=${() => this.action("test", { timings: [...lab.timings], carrierFrequency: lab.carrierFrequency })}><ha-icon icon="mdi:play"></ha-icon>${cooldown ? `Retry in ${cooldown}s` : "Test once"}</button>
        <button class="btn primary" @click=${() => this.setLabUi({ saveOpen: true })}><ha-icon icon="mdi:plus"></ha-icon>Save as new command</button>
        <span class="protection protected"><ha-icon icon="mdi:information-outline"></ha-icon>Original is protected</span>
      </div>
      <div class="mobile-context" aria-label="Signal Lab context"><ha-icon icon="mdi:remote"></ha-icon><strong>${this.emitterName}</strong><imprint-status .state=${this.emitterReady ? "idle" : "unavailable"} .busy=${this.busy}></imprint-status><span class="protection protected" title="The saved source cannot be overwritten"><ha-icon icon="mdi:lock-outline"></ha-icon>Protected</span></div>

      <section class="panel wave-panel">
        <div class="view-head"><div><h2>${lab.view === "compare" ? "Compare timing envelopes" : "Simulated timing envelope"}</h2><p>Wheel to zoom at the pointer. Drag to pan; pinch on touch screens.</p></div><div class="actions"><div class="view-switch" role="group" aria-label="Signal Lab view"><button aria-pressed=${lab.view === "edit"} @click=${() => this.action("view", { view: "edit" })}>Edit</button><button aria-pressed=${lab.view === "compare"} @click=${() => this.action("view", { view: "compare" })}>Compare</button></div><div class="wave-controls"><button class="btn icon" title="Zoom out" aria-label="Zoom out" ?disabled=${lab.zoom <= 1} @click=${() => this.zoom(lab.zoom / 2)}><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></button><button class="btn" title="Fit the whole signal" @click=${() => this.action("zoom", { zoom: 1, pan: 0 })}>Fit · ${lab.zoom.toFixed(lab.zoom % 1 ? 1 : 0)}×</button><button class="btn icon" title="Zoom in" aria-label="Zoom in" ?disabled=${lab.zoom >= 16} @click=${() => this.zoom(lab.zoom * 2)}><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></button></div></div></div>
        <imprint-signal-waveform .timings=${lab.timings} .original=${lab.original} .analysis=${analysis} .frameRoles=${lab.frameRoles}
          .view=${lab.view} .zoom=${lab.zoom} .pan=${lab.pan} .selected=${lab.selected} .selectionStart=${lab.selectionStart} .selectionEnd=${lab.selectionEnd}
          .cursors=${lab.cursors} .activeCursor=${lab.activeCursor} .snap=${lab.snap} .boundaryMode=${lab.boundaryMode}
          .showCursors=${this.editingOverlays} .showFrames=${this.editingOverlays}
          @lab-navigation=${this.relayNavigation} @lab-selection=${this.relaySelection} @lab-cursor-change=${this.relayCursor}
          @lab-edge-change=${this.relayEdge} @lab-frame-select=${this.relayFrameSelect} @lab-shortcut=${this.handleShortcut}></imprint-signal-waveform>
        ${lab.view === "compare" ? this.renderCompare(lab) : nothing}
      </section>

      ${
        canOptimize
          ? html`<section class="panel one-press" aria-labelledby="one-press-heading">
        <ha-icon icon="mdi:content-duplicate-off-outline"></ha-icon>
        <div class="one-press-copy"><h2 id="one-press-heading">Optimize for one press</h2><p>${singlePress?.removed_frames ?? Math.max(1, frames.length - Number(singlePress?.kept_frames || 1))} repeated frame${Number(singlePress?.removed_frames ?? 1) === 1 ? "" : "s"} can be removed from a preview. Your captured signal will not change until you apply it.</p></div>
        <button class="btn" @click=${() => this.previewSinglePress(lab, analysis)}><ha-icon icon="mdi:eye-outline"></ha-icon>Preview optimization</button>
      </section>`
          : nothing
      }

      ${this.renderWorkbench(lab, analysis, validation, selectionStart, selectionEnd, selection.length, frames.length, selectedDuration, cursorA, cursorB)}

      ${this.renderPreview(lab)}
      ${this.saveOpen ? this.renderSaveDialog(lab, validation.valid) : nothing}
      ${lab.leavePrompt ? html`<imprint-dialog heading="Leave Signal Lab?" description="This experiment has unsaved changes." @dialog-close=${() => this.action("continue")}><div class="actions"><button class="btn danger" @click=${() => this.action("discard-leave")}>Discard changes</button><button class="btn" @click=${() => this.action("keep-draft-leave")}>Keep draft</button><button class="btn primary" @click=${() => this.action("continue")}>Continue editing</button></div></imprint-dialog>` : nothing}
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
    const protocol = String(
      analysis.protocol || analysis.protocol_name || "Unknown protocol",
    );
    const protocolKnown = protocol !== "Unknown protocol";
    const candidates = Array.isArray(analysis.protocol_candidates)
      ? analysis.protocol_candidates
      : [];
    const binaryMode = lab.binaryDecoderMode || this.binaryMode;
    const binary = binaryPayloadFor(analysis, binaryMode);
    const repeats = repeatSummary(analysis);
    return html`<section class="panel workbench">
      <div class="editor">
        <div class="tabs" role="tablist" aria-label="Signal representations" @keydown=${this.handleDetailTabKeydown}>
          ${(["decoded", "timings", "code"] as const).map(
            (tab) => html`<button class="tab" role="tab"
            data-tab=${tab} tabindex=${this.detailTab === tab ? 0 : -1} aria-selected=${this.detailTab === tab} @click=${() => this.selectDetailTab(tab)}>${tab === "decoded" ? "Decoded" : tab === "timings" ? "Timings" : "Encoded code"}</button>`,
          )}
        </div>
        <div class="tab-content" role="tabpanel">
          ${
            this.detailTab === "timings"
              ? html`
            <imprint-signal-timing-editor .timings=${lab.timings} .original=${lab.original} .selected=${lab.selected}
              .selectionStart=${lab.selectionStart} .selectionEnd=${lab.selectionEnd} .snap=${lab.snap}
              @lab-selection=${this.relaySelection} @lab-timing-change=${this.relayTiming} @lab-nudge=${this.relayNudge}></imprint-signal-timing-editor>
            <div class="timing-actions">
              <button class="btn" @click=${() => this.action("add-pair", { after: selectionEnd })}><ha-icon icon="mdi:plus"></ha-icon>Add pulse pair</button>
              <button class="btn" ?disabled=${!lab.dirty} @click=${() => this.action("reset")}><ha-icon icon="mdi:restore"></ha-icon>Reset</button>
              <span class="validity ${validation.valid ? "" : "invalid"}"><ha-icon icon=${validation.valid ? "mdi:check-circle" : "mdi:alert-circle-outline"}></ha-icon>${validation.valid ? "Valid" : "Needs attention"} · ${lab.timings.length} pulses · ${formatDuration(timingTotal(lab.timings))}</span>
            </div>
            ${this.transformMessage ? html`<div class="muted" role="status" aria-live="polite">${this.transformMessage}</div>` : nothing}
            ${this.renderAdvancedTools(lab, selectionStart, selectionEnd, selectionLength, frameCount, selectedDuration, cursorA, cursorB)}
          `
              : this.detailTab === "decoded"
                ? html`
            <div class="decoded">
              <div class="decoded-fields">
                <div class="metric"><span>Protocol</span><strong>${protocol}</strong></div>
                <div class="metric"><span>Recognition evidence</span><strong>${lab.analysisPending ? "Rechecking…" : evidenceLabel(analysis)}</strong></div>
                <div class="metric"><span>Frames</span><strong>${frameCount}</strong></div>
                <div class="metric"><span>Captured repeats</span><strong>${repeats.captured}</strong><small>${repeats.capturedDetail}</small></div>
                <div class="metric"><span>Required repeats</span><strong>${repeats.required}</strong><small>${repeats.requiredDetail}</small></div>
              </div>
              <div class="decoder-control"><label class="field">Bitstream decoder<select @change=${(event: Event) => this.setBinaryMode((event.target as HTMLSelectElement).value as BinaryDecoderMode)}>${binaryDecoderChoices.map((choice) => html`<option value=${choice.value} ?selected=${choice.value === binaryMode}>${choice.label}</option>`)}</select></label></div>
              ${
                binary
                  ? html`<section class="binary-readout" aria-labelledby="binary-payload-heading">
                <div class="binary-head"><div><strong id="binary-payload-heading">Raw bitstream</strong><small>${binary.bit_count || binary.value.length} bits · ${binaryEncodingLabel(binary.encoding)} · transmission order</small></div><span class="badge">${binaryScoreLabel(binary, binaryMode)}</span></div>
                <pre class="binary-value" aria-label="Binary payload in transmission order"><code>${groupedBinary(binary.value)}</code></pre>
                <div class="binary-actions"><span class="binary-note">${binaryPayloadExplanation(binary, protocolKnown ? protocol : undefined)}</span><button class="btn" @click=${() => void this.copyCode(binary.value, "Raw bitstream copied.")}><ha-icon icon="mdi:content-copy"></ha-icon>Copy bits</button></div>
              </section>`
                  : html`<div class="notice warning" role="status"><ha-icon icon="mdi:source-branch-remove"></ha-icon><span>${binaryDecoderMessage(analysis, binaryMode)}</span></div>`
              }
              ${candidates.length ? html`<details class="alternatives"><summary>Protocol interpretations (${candidates.length})</summary><div class="advanced-section">${candidates.map((candidate) => this.renderCandidate(candidate))}</div></details>` : html`<p class="muted">${binary ? "No named protocol is claimed. The raw bitstream comes only from the two timing clusters shown above." : "No dependable protocol decode is available. The raw timing sequence remains editable and usable."}</p>`}
            </div>
          `
                : this.renderEncodedCode(lab)
          }
        </div>
      </div>
      <aside class="signal-details" aria-label="Signal details">
        <h2>Signal details</h2>
        <div class="detail-list">
          <div class="detail-row"><ha-icon icon="mdi:file-document-outline"></ha-icon><div><strong>Protocol: ${protocol}</strong>${!protocolKnown ? html`<small>Raw timings remain fully usable.</small>` : nothing}</div></div>
          <div class="detail-row"><ha-icon icon="mdi:sine-wave"></ha-icon><div><strong>Carrier: ${(lab.carrierFrequency / 1000).toFixed(1)} kHz ${lab.carrierSource}</strong><small>${lab.carrierSource === "assumed" ? "The receiver did not report a carrier frequency." : "Provided by the signal source."}</small></div></div>
          <div class="detail-row ${validation.compatible ? "success" : ""}"><ha-icon icon=${validation.compatible ? "mdi:check-circle" : "mdi:alert-circle-outline"}></ha-icon><div><strong>${validation.compatible ? "Timing data is valid" : "Timing data needs attention"}</strong><small>${estimatedPayloadBytes(lab.timings).toLocaleString()} byte timing payload</small></div></div>
          ${!validation.valid ? validation.issues.map((issue) => html`<div class="detail-row"><ha-icon icon="mdi:alert-outline"></ha-icon><div><strong>${issue}</strong></div></div>`) : nothing}
          <div class="detail-row"><ha-icon icon="mdi:information-outline"></ha-icon><div><strong>Protocol decoding is best effort</strong><small>Only a one-shot appliance test confirms behavior.</small></div></div>
        </div>
        <hr>
        ${this.renderRefineSignal(lab, analysis, candidates)}
      </aside>
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

  private handleDetailTabKeydown(event: KeyboardEvent): void {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = ["decoded", "timings", "code"] as const;
    const current = tabs.indexOf(this.detailTab);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % tabs.length
            : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    this.selectDetailTab(tabs[index]);
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<HTMLButtonElement>(`button[data-tab="${tabs[index]}"]`)
        ?.focus(),
    );
  }

  private selectCodeFormat(event: Event): void {
    this.setLabUi({ convertFormat: (event.target as HTMLSelectElement).value });
  }

  private decodedValue(value: unknown): string {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      return decodedInteger(value);
    return String(value);
  }

  private renderCandidate(candidate: any) {
    const facts = ["address", "command"].filter(
      (key) => candidate[key] !== undefined && candidate[key] !== null,
    );
    return html`<div class="metric"><span>${String(candidate.protocol || "Candidate")}</span><strong>${String(candidate.evidence_class || candidate.confidence || "Unranked").replaceAll("_", " ")}</strong>${candidate.bits ? html`<small>${candidate.bits}-bit frame</small>` : nothing}${facts.length ? html`<div class="candidate-facts">${facts.map((key) => html`<span>${key} <code>${this.decodedValue(candidate[key])}</code></span>`)}</div>` : nothing}</div>`;
  }

  private rebuildLabel(rebuild: ProtocolRebuild, detailed = false): string {
    if (!detailed) return rebuild.protocol;
    const fields = [
      rebuild.address == null
        ? ""
        : `address ${this.decodedValue(rebuild.address)}`,
      rebuild.command == null
        ? ""
        : `command ${this.decodedValue(rebuild.command)}`,
    ].filter(Boolean);
    return fields.length
      ? `${rebuild.protocol} · ${fields.join(" · ")}`
      : rebuild.protocol;
  }

  private renderRefineSignal(
    lab: SignalLabState,
    analysis: SignalLabState["sourceAnalysis"],
    candidates: any[],
  ) {
    const rebuilds = Array.isArray(analysis.protocol_rebuilds)
      ? analysis.protocol_rebuilds
      : [];
    const selected =
      rebuilds.find((item) => item.id === this.rebuildId) || rebuilds[0];
    const smoothHelp = "smooth-timing-help";
    const rebuildHelp = "protocol-rebuild-help";
    const unavailable = lab.analysisPending
      ? "Checking whether this draft can be rebuilt…"
      : candidates.length > 1
        ? "Rebuild unavailable: none of the current protocol interpretations has a complete encoder."
        : candidates.length
          ? `${String(candidates[0].protocol || "This protocol")} was recognized, but Imprint Refinery cannot rebuild it yet.`
          : "Rebuild unavailable: no supported protocol was recognized.";
    return html`<div class="generation" aria-label="Refine signal">
      <h3>Refine signal</h3>
      <div class="refine-action">
        <strong>Smooth timing jitter</strong>
        <small id=${smoothHelp}>Averages similar mark and space durations in the current draft. Protocol-defined values are not used.</small>
        <button class="btn" aria-describedby=${smoothHelp} @click=${() => this.previewTransform("normalize", lab, [0, lab.timings.length - 1])}><ha-icon icon="mdi:waveform"></ha-icon>Preview smoothing</button>
      </div>
      <div class="refine-action">
        <strong>${selected ? `Rebuild as ${selected.protocol}` : "Protocol rebuild"}</strong>
        ${rebuilds.length > 1 ? html`<label class="field">Protocol interpretation<select .value=${selected?.id || ""} @change=${(event: Event) => (this.rebuildId = (event.target as HTMLSelectElement).value)}>${rebuilds.map((item) => html`<option value=${item.id}>${this.rebuildLabel(item, true)}</option>`)}</select></label>` : nothing}
        ${
          selected
            ? html`
          <small id=${rebuildHelp}>Builds the command from decoded fields using ${selected.protocol}-defined timings and ${(selected.carrier_frequency / 1000).toFixed(1)} kHz carrier.${candidates.length > 1 ? ` This is one of ${candidates.length} protocol interpretations.` : ""} The protected source stays unchanged.</small>
          <button class="btn" aria-describedby=${rebuildHelp} @click=${() => this.previewProtocolRebuild(selected)}><ha-icon icon="mdi:cached"></ha-icon>Preview ${selected.protocol} rebuild</button>
        `
            : html`<small>${unavailable}</small>`
        }
      </div>
    </div>`;
  }

  private async copyCode(
    value: string,
    success = "Encoded code copied.",
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.clipboardMessage = success;
    } catch {
      this.clipboardMessage =
        "Clipboard access is unavailable. Select the visible code and copy it manually.";
    }
  }

  private renderEncodedCode(lab: SignalLabState) {
    const key = this.codeRepresentationKey(lab);
    const result =
      lab.codeRepresentation?.key === key ? lab.codeRepresentation : undefined;
    const labels: Record<string, string> = {
      pronto: "Pronto Hex",
      girr: "GIRR 1.2",
      lirc: "LIRC raw",
      flipper: "Flipper .ir",
      raw_signed: "Raw signed",
      raw_unsigned: "Raw unsigned",
    };
    const label = labels[this.convertFormat] || this.convertFormat;
    const value = result?.value || "";
    const loading = !result || result.loading;
    const trailingSpace = Number(
      result?.lossReport?.trailing_space_added_us || 0,
    );
    const lossy = result?.lossReport?.lossless === false && !trailingSpace;
    return html`<div class="code-tools">
      <p class="muted">This is the current draft encoded as ${label}. Viewing or copying it does not transmit.</p>
      <div class="code-toolbar">
        <label class="field">Representation<select .value=${this.convertFormat} @change=${this.selectCodeFormat}><option value="pronto">Pronto Hex</option><option value="girr">GIRR 1.2</option><option value="lirc">LIRC raw</option><option value="flipper">Flipper .ir</option><option value="raw_signed">Raw signed</option><option value="raw_unsigned">Raw unsigned</option></select></label>
        <button class="btn" ?disabled=${!value || loading} @click=${() => void this.copyCode(value)}><ha-icon icon="mdi:content-copy"></ha-icon>Copy code</button>
      </div>
      ${
        loading
          ? html`<div class="notice" role="status"><ha-icon icon="mdi:progress-clock"></ha-icon><span>Encoding the current draft…</span></div>`
          : result?.error
            ? html`<div class="notice danger" role="alert"><ha-icon icon="mdi:file-alert-outline"></ha-icon><span>${result.error}</span><button class="btn" @click=${() => this.ensureCodeRepresentation(true)}>Try again</button></div>`
            : value
              ? html`
        <div class="code-surface">
          <div class="code-surface-head"><strong>${label}</strong><span class="badge ${lossy ? "warning" : trailingSpace ? "" : "success"}">${lossy ? "Converted with limitations" : trailingSpace ? "Trailing idle encoded" : "Ready to copy"}</span></div>
          <textarea class="encoded-value" readonly spellcheck="false" aria-label=${`${label} code`} .value=${value}></textarea>
          ${trailingSpace ? html`<div class="notice"><ha-icon icon="mdi:information-outline"></ha-icon><span>Pronto needs a finite off-time after the final mark. This copy adds ${formatDuration(trailingSpace)} of inactive trailing space, matching the final mark; the saved capture remains unchanged.</span></div>` : lossy ? html`<div class="notice warning"><ha-icon icon="mdi:information-outline"></ha-icon><span>This format changes some timing or carrier detail. Choose Raw signed to preserve the editable timing sequence.</span></div>` : nothing}
        </div>
      `
              : html`<div class="notice danger" role="alert"><ha-icon icon="mdi:file-alert-outline"></ha-icon><span>The current draft could not be represented as ${label}.</span><button class="btn" @click=${() => this.ensureCodeRepresentation(true)}>Try again</button></div>`
      }
      ${this.clipboardMessage ? html`<div class="notice" role="status"><ha-icon icon="mdi:clipboard-check-outline"></ha-icon><span>${this.clipboardMessage}</span></div>` : nothing}
    </div>`;
  }

  private renderAdvancedTools(
    lab: SignalLabState,
    selectionStart: number,
    selectionEnd: number,
    selectionLength: number,
    frameCount: number,
    selectedDuration: number,
    cursorA: number,
    cursorB: number,
  ) {
    return html`<details class="advanced-tools"><summary>Advanced timing tools</summary><div class="advanced-body">
      <section class="advanced-section"><h3>Edit selection</h3>
        <div class="selection-settings">
          <label class="field">Snap<select .value=${String(lab.snap)} @change=${(event: Event) => this.action("field", { field: "snap", value: Number((event.target as HTMLSelectElement).value) })}><option value="0">Off</option><option value="1">1 µs</option><option value="10">10 µs</option><option value="50">50 µs</option><option value="100">100 µs</option></select></label>
          <label class="field">Edge drag<select .value=${lab.boundaryMode} @change=${(event: Event) => this.action("field", { field: "boundaryMode", value: (event.target as HTMLSelectElement).value })}><option value="shift">Change duration</option><option value="preserve">Preserve frame length</option></select></label>
          <label class="field">Select<select @change=${(event: Event) => this.selectMode((event.target as HTMLSelectElement).value as SelectionMode)}><option value="range">Current range</option><option value="duration">Duration</option><option value="pair">Mark/space pair</option><option value="frame">Complete frame</option><option value="all">Entire signal</option></select></label>
          <label class="field">Copy as<select .value=${this.copyFormat} @change=${(event: Event) => (this.copyFormat = (event.target as HTMLSelectElement).value as ClipboardFormat)}><option value="signed">Signed timings</option><option value="unsigned">Alternating integers</option><option value="json">JSON</option><option value="pronto">Pronto Hex</option></select></label>
        </div>
        <div class="edit-actions">
          <button class="btn" ?disabled=${!lab.undo.length || this.busy} @click=${() => this.action("undo")}><ha-icon icon="mdi:undo"></ha-icon>Undo</button>
          <button class="btn" ?disabled=${!lab.redo.length || this.busy} @click=${() => this.action("redo")}><ha-icon icon="mdi:redo"></ha-icon>Redo</button>
          <button class="btn" @click=${() => void this.copySelection(false)}><ha-icon icon="mdi:content-copy"></ha-icon>Copy</button>
          <button class="btn" ?disabled=${selectionLength >= lab.timings.length} @click=${() => void this.copySelection(true)}><ha-icon icon="mdi:content-cut"></ha-icon>Cut</button>
          <button class="btn" @click=${() => void this.pasteSelection()}><ha-icon icon="mdi:content-paste"></ha-icon>Paste</button>
          <button class="btn" @click=${() => this.action("duplicate-selection", { start: selectionStart, end: selectionEnd })}><ha-icon icon="mdi:content-duplicate"></ha-icon>Duplicate</button>
          <button class="btn" ?disabled=${lab.selected + 2 >= lab.timings.length} @click=${() => this.action("merge", { index: lab.selected })}><ha-icon icon="mdi:merge"></ha-icon>Merge across</button>
          <button class="btn" @click=${() => this.action("reset-selection", { start: selectionStart, end: selectionEnd })}><ha-icon icon="mdi:restore"></ha-icon>Reset selection</button>
          <button class="btn danger" ?disabled=${selectionLength >= lab.timings.length} @click=${() => this.action("delete-selection", { start: selectionStart, end: selectionEnd })}><ha-icon icon="mdi:delete-outline"></ha-icon>Delete</button>
        </div>
        <label class="choice"><input type="checkbox" .checked=${this.editingOverlays} @change=${(event: Event) => this.setLabUi({ editingOverlays: (event.target as HTMLInputElement).checked })}><span><strong>Show editing overlays</strong><small>Reveal frame regions and measurement cursors on the waveform.</small></span></label>
        <div class="muted">${lab.selected + 1} · ${lab.selected % 2 ? "Space" : "Mark"} ${formatDuration(selectedDuration)} · A ${formatDuration(cursorA)} · B ${formatDuration(cursorB)} · Δ ${formatDuration(Math.abs(cursorB - cursorA))}</div>
        ${this.clipboardMessage ? html`<div class="notice" role="status"><ha-icon icon="mdi:clipboard-check-outline"></ha-icon><span>${this.clipboardMessage}</span></div>` : nothing}
      </section>
      <imprint-signal-frame-editor .timings=${lab.timings} .frameRoles=${lab.frameRoles} .selectedFrame=${lab.selectedFrame} .selectedTiming=${lab.selected} @lab-frame-action=${this.relayFrameAction}></imprint-signal-frame-editor>
      <section class="advanced-section transform"><h3>Transform previews</h3>
        <div class="transform-row"><label class="field">Scale percent<input type="number" min="1" max="1000" .value=${String(this.scale)} @input=${(event: Event) => (this.scale = Number((event.target as HTMLInputElement).value))}></label><button class="btn" @click=${() => this.previewTransform("scale", lab, [selectionStart, selectionEnd])}>Preview</button></div>
        <div class="transform-row"><label class="field">Round to<select .value=${String(this.quantum)} @change=${(event: Event) => (this.quantum = Number((event.target as HTMLSelectElement).value))}><option value="10">10 µs</option><option value="50">50 µs</option><option value="100">100 µs</option></select></label><button class="btn" @click=${() => this.previewTransform("round", lab, [selectionStart, selectionEnd])}>Preview</button></div>
        <div class="transform-row"><label class="field">Interframe gap<input type="number" min="1" max="65535" .value=${String(this.gap)} @input=${(event: Event) => (this.gap = Number((event.target as HTMLInputElement).value))}></label><button class="btn" @click=${() => this.previewTransform("gap", lab, [selectionStart, selectionEnd])}>Preview</button></div>
        <div class="transform-actions"><button class="btn" @click=${() => this.previewTransform("normalize", lab, [selectionStart, selectionEnd])}><ha-icon icon="mdi:waveform"></ha-icon>Smooth selection</button><button class="btn" ?disabled=${frameCount < 2} @click=${() => this.previewTransform("align_frames", lab, [0, lab.timings.length - 1])}><ha-icon icon="mdi:format-align-middle"></ha-icon>Align repeated frames</button></div>
      </section>
    </div></details>`;
  }

  private renderSaveDialog(lab: SignalLabState, valid: boolean) {
    return html`<imprint-dialog heading="Save as new command" description="Saving creates a new command. The protected source is never overwritten." @dialog-close=${() => this.setLabUi({ saveOpen: false })}>
      <div class="save-dialog">
        <label class="field">Name<input autofocus placeholder="e.g. Reading light" .value=${lab.saveName} maxlength="200" @input=${(
          event: Event,
        ) => {
          const value = (event.target as HTMLInputElement).value;
          this.action("field", {
            field: "saveName",
            value,
            ...(!lab.idTouched ? { saveId: slugify(value) } : {}),
          });
        }}></label>
        ${!validId(lab.saveId) ? html`<span class="badge danger">Choose a name with at least one letter or number.</span>` : nothing}
        <label class="field">Carrier frequency<input type="number" min="1" step="100" .value=${String(lab.carrierFrequency)} @input=${(event: Event) => this.action("field", { field: "carrierFrequency", value: Number((event.target as HTMLInputElement).value) })}><small>Hz · editable for imported or custom signals; an assumed value was not measured by the receiver.</small></label>
        ${lab.custom ? this.renderTarget(lab) : nothing}
        <details><summary>Advanced</summary><label class="field">Command ID<input placeholder="reading_light" .value=${lab.saveId} maxlength="100" @input=${(event: Event) => this.action("field", { field: "saveId", value: (event.target as HTMLInputElement).value })}><small>Used by Home Assistant services and automations.</small></label></details>
        <div class="save-actions"><button class="btn" @click=${() => void this.copyWholeSignal(lab)}><ha-icon icon="mdi:content-copy"></ha-icon>Copy custom signal</button><button class="btn primary" ?disabled=${this.busy || !valid || !lab.saveName.trim() || !validId(lab.saveId) || !lab.locId || !lab.applianceId} @click=${() => this.action("save", { timings: [...lab.timings], carrierFrequency: lab.carrierFrequency, frameRoles: [...lab.frameRoles] })}><ha-icon icon="mdi:content-save-plus-outline"></ha-icon>Save as new command</button></div>
      </div>
    </imprint-dialog>`;
  }

  private renderTarget(lab: SignalLabState) {
    const appliances = Object.entries(this.registry.locations || {}).flatMap(
      ([locId, location]) =>
        Object.entries(location.appliances || {}).map(
          ([applianceId, appliance]) => ({
            key: `${locId}||${applianceId}`,
            name: applianceDisplayName(
              locId,
              applianceId,
              appliance.name,
              "No appliance",
            ),
            location: locationDisplayName(locId, location.name),
          }),
        ),
    );
    const current = `${lab.locId}||${lab.applianceId}`;
    const hasCurrent = appliances.some(
      (appliance) => appliance.key === current,
    );
    return html`<label class="field">Appliance<select .value=${current} @change=${(event: Event) => this.action("target", { targetKey: (event.target as HTMLSelectElement).value })}>${!hasCurrent ? html`<option value=${current}>No appliance · created when saved</option>` : nothing}${appliances.map((appliance) => html`<option value=${appliance.key}>${appliance.name}${appliance.location ? ` · ${appliance.location}` : ""}</option>`)}</select></label>`;
  }

  private applianceName(lab: SignalLabState) {
    const location = this.registry.locations?.[lab.locId];
    const record = location?.appliances?.[lab.applianceId];
    const appliance = applianceDisplayName(
      lab.locId,
      lab.applianceId,
      record?.name,
      "No appliance",
    );
    const locationName = locationDisplayName(lab.locId, location?.name);
    return locationName ? `${appliance} · ${locationName}` : appliance;
  }

  private renderCompare(lab: SignalLabState) {
    const differences = compareTimings(lab.original, lab.timings);
    const durationDelta = timingTotal(lab.timings) - timingTotal(lab.original);
    const countDelta = lab.timings.length - lab.original.length;
    return html`<div class="compare"><div class="compare-summary"><strong>${differences.length} timing${differences.length === 1 ? "" : "s"} changed</strong><span>Count ${lab.original.length} → ${lab.timings.length} (${countDelta >= 0 ? "+" : ""}${countDelta})</span><span>Duration ${formatDuration(timingTotal(lab.original))} → ${formatDuration(timingTotal(lab.timings))} (${durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(durationDelta))})</span></div>${differences.length ? html`<div class="diffs" aria-label="Timing differences">${differences.map((item) => html`<button class="diff ${lab.selected === item.index ? "selected" : ""}" @click=${() => this.action("select", { index: item.index, selectionStart: item.index, selectionEnd: item.index, revealTable: true })}><span>${item.index + 1}</span><strong>${item.index % 2 ? "Space" : "Mark"}</strong><code>${item.original ?? "—"} → ${item.current ?? "—"}</code><em>${item.delta == null ? "Structure changed" : `${item.delta >= 0 ? "+" : ""}${item.delta} µs`}</em></button>`)}</div>` : html`<div class="notice"><ha-icon icon="mdi:check-circle-outline"></ha-icon><span>The experiment matches its protected source.</span></div>`}<div class="edit-actions"><button class="btn" @click=${() => this.action("nudge", { index: lab.selected, amount: -10 })}>−10</button><button class="btn" @click=${() => this.action("nudge", { index: lab.selected, amount: -1 })}>−1</button><button class="btn" @click=${() => this.action("nudge", { index: lab.selected, amount: 1 })}>+1</button><button class="btn" @click=${() => this.action("nudge", { index: lab.selected, amount: 10 })}>+10</button><button class="btn" @click=${() => this.action("reset-selected", { index: lab.selected })}><ha-icon icon="mdi:restore"></ha-icon>Reset selected</button></div></div>`;
  }

  private renderPreview(lab: SignalLabState) {
    const preview = lab.preview || this.localPreview;
    if (!preview) return nothing;
    const carrier = preview.carrierFrequency || lab.carrierFrequency;
    const carrierChanged = carrier !== lab.carrierFrequency;
    return html`<imprint-dialog heading=${preview.kind} description=${preview.description || "Review measured changes before applying them to this experiment."} @dialog-close=${this.cancelPreview}>
      ${preview.warning ? html`<div class="notice warning"><ha-icon icon="mdi:alert-outline"></ha-icon><span>${preview.warning}</span></div>` : nothing}
      <imprint-signal-waveform .timings=${preview.timings} .original=${lab.timings} view="compare" .cursors=${lab.cursors}></imprint-signal-waveform>
      <div class="preview-metrics"><div class="metric"><span>Changed timings</span><strong>${preview.changed}</strong></div><div class="metric"><span>Total duration delta</span><strong>${preview.durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(preview.durationDelta))}</strong></div><div class="metric"><span>Largest timing change</span><strong>${formatDuration(preview.maxTimingError)}</strong></div><div class="metric"><span>Frame count delta</span><strong>${preview.frameDelta >= 0 ? "+" : ""}${preview.frameDelta}</strong></div><div class="metric"><span>Timing basis</span><strong>${preview.timingBasis || "Current draft"}</strong></div><div class="metric"><span>Carrier</span><strong>${carrierChanged ? `${(lab.carrierFrequency / 1000).toFixed(1)} → ` : ""}${(carrier / 1000).toFixed(1)} kHz</strong></div><div class="metric"><span>Encode round-trip drift</span><strong>${preview.roundTripChanges == null ? "Checked when encoded" : `${preview.roundTripChanges} timings`}</strong></div><div class="metric"><span>Recognition impact</span><strong>${preview.protocol ? `${preview.protocol} · ` : ""}${preview.evidenceClass}</strong></div><div class="metric"><span>Emitter representation</span><strong>${preview.compatible ? "Timing values fit" : "Not representable"}</strong></div></div>
      <div class="notice"><ha-icon icon="mdi:information-outline"></ha-icon><span>Recognition describes a pattern. Only a one-shot appliance test confirms behavior.</span></div>
      <div class="actions preview-actions"><button class="btn" @click=${this.cancelPreview}>Cancel</button><button class="btn primary" ?disabled=${this.busy || !preview.compatible} @click=${() => this.applyPreview(preview)}>${preview.applyLabel || "Apply to experiment"}</button></div>
    </imprint-dialog>`;
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
  private relayCursor(event: CustomEvent): void {
    this.action("cursor", event.detail);
  }
  private relayEdge(event: CustomEvent): void {
    this.action("edge", event.detail);
  }
  private relayTiming(event: CustomEvent): void {
    this.action("timing", event.detail);
  }
  private relayNudge(event: CustomEvent): void {
    this.action("nudge", event.detail);
  }
  private relayFrameSelect(event: CustomEvent): void {
    this.action("frame", { operation: "select", ...event.detail });
  }
  private relayFrameAction(event: CustomEvent): void {
    this.action("frame", event.detail);
  }

  private handleShortcut(event: CustomEvent): void {
    const action = event.detail.action;
    if (action === "copy") void this.copySelection(false);
    else if (action === "cut") void this.copySelection(true);
    else if (action === "paste") void this.pasteSelection();
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

  private zoom(zoom: number): void {
    this.action("zoom", { zoom: Math.max(1, Math.min(16, zoom)) });
  }

  private selectMode(mode: SelectionMode): void {
    if (!this.lab || mode === "range") return;
    const [start, end] = selectModeRange(
      this.lab.timings,
      this.lab.selected,
      mode,
    );
    this.action("select", {
      index: start,
      selectionStart: start,
      selectionEnd: end,
      mode,
    });
  }

  private previewTransform(
    kind: "scale" | "round" | "normalize" | "gap" | "align_frames",
    lab: SignalLabState,
    range: [number, number],
  ): void {
    const timings = applySelectionTransform(kind, lab.timings, range, {
      scale: this.scale,
      quantum: this.quantum,
      gap: this.gap,
    });
    if (
      timings.length === lab.timings.length &&
      timings.every((value, index) => value === lab.timings[index])
    ) {
      this.transformMessage =
        kind === "normalize"
          ? "No similar timings in this draft need smoothing."
          : "This transform would not change the current draft.";
      return;
    }
    this.transformMessage = "";
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
      this.transformMessage = `This draft already matches the ${rebuild.protocol} standard.`;
      return;
    }
    this.transformMessage = "";
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

  private async copySelection(cut: boolean): Promise<void> {
    const lab = this.lab;
    if (!lab) return;
    const [start, end] = selectionRange(
      lab.timings.length,
      lab.selectionStart,
      lab.selectionEnd,
    );
    const timings = lab.timings.slice(start, end + 1);
    if (this.copyFormat === "pronto") {
      this.action("copy", {
        format: "pronto",
        timings,
        start,
        carrierFrequency: lab.carrierFrequency,
        cut,
      });
      return;
    }
    const value = formatTimingSelection(
      timings,
      start,
      lab.carrierFrequency,
      this.copyFormat,
    );
    try {
      await navigator.clipboard.writeText(value);
      this.clipboardMessage = cut
        ? "Copied selection and removed it from the draft."
        : "Selection copied.";
      this.action("copy", {
        format: this.copyFormat,
        timings,
        start,
        carrierFrequency: lab.carrierFrequency,
        text: value,
        cut,
        handled: true,
      });
      if (cut) this.action("delete-selection", { start, end });
    } catch {
      this.clipboardMessage =
        "Clipboard access is unavailable. Use the copy action from a secure Home Assistant page.";
      this.action("copy", {
        format: this.copyFormat,
        timings,
        start,
        carrierFrequency: lab.carrierFrequency,
        text: value,
        cut,
        handled: false,
      });
    }
  }

  private async pasteSelection(): Promise<void> {
    const lab = this.lab;
    if (!lab) return;
    if (!navigator.clipboard?.readText || !window.isSecureContext) {
      this.clipboardMessage =
        "Clipboard reading is unavailable here. Paste through Import instead.";
      this.action("clipboard-error", { operation: "paste" });
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseTimingClipboard(text);
      const [start, end] = selectionRange(
        lab.timings.length,
        lab.selectionStart,
        lab.selectionEnd,
      );
      if (!parsed.timings) {
        this.action("paste-request", {
          text,
          format: parsed.format,
          start,
          end,
          carrierFrequency: lab.carrierFrequency,
        });
        return;
      }
      const parity = pasteParityError(
        start,
        end - start + 1,
        parsed.timings.length,
      );
      if (parity) {
        this.clipboardMessage = parity;
        return;
      }
      const next = [...lab.timings];
      next.splice(start, end - start + 1, ...parsed.timings);
      this.pasteContext = {
        start,
        end,
        timings: parsed.timings,
        carrierFrequency: parsed.carrierFrequency,
      };
      this.localPreview = makePreview(
        "Paste timing data",
        lab.timings,
        next,
        lab.sourceAnalysis,
        "Review mark/space alignment before applying.",
        parsed.timings,
      );
    } catch (error) {
      this.clipboardMessage =
        error instanceof Error
          ? error.message
          : "The clipboard timing data could not be read.";
    }
  }

  private async copyWholeSignal(lab: SignalLabState): Promise<void> {
    const text = formatTimingSelection(
      lab.timings,
      0,
      lab.carrierFrequency,
      "json",
    );
    try {
      await navigator.clipboard.writeText(text);
      this.clipboardMessage = "Complete custom signal copied as JSON.";
      this.action("copy", {
        format: "json",
        timings: [...lab.timings],
        carrierFrequency: lab.carrierFrequency,
        text,
        handled: true,
      });
    } catch {
      this.action("copy", {
        format: "json",
        timings: [...lab.timings],
        carrierFrequency: lab.carrierFrequency,
        text,
        handled: false,
      });
    }
  }

  private applyPreview(preview: LabPreview): void {
    if (this.pasteContext)
      this.action("paste-apply", {
        ...this.pasteContext,
        timings: preview.timings,
      });
    else
      this.action("preview-apply", {
        kind: preview.kind,
        timings: [...preview.timings],
        carrierFrequency: preview.carrierFrequency,
        frameRoles: preview.frameRoles,
      });
    this.localPreview = null;
    this.pasteContext = null;
  }

  private cancelPreview = (): void => {
    this.localPreview = null;
    this.pasteContext = null;
    this.action("preview-cancel");
  };
  private onLabKeydown(event: KeyboardEvent): void {
    if (
      event.key !== "Escape" ||
      event
        .composedPath()
        .some(
          (item) =>
            item instanceof HTMLElement &&
            item.tagName === "IMPRINT-SIGNAL-WAVEFORM",
        )
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    this.handleEscape();
  }
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
