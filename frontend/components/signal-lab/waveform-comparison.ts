import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { zoomAt } from "../../core/signal-lab";
import {
  compareWaveforms,
  type WaveformComparisonSignal,
  type WaveformTimingChange,
} from "../../core/waveform-comparison";
import { safeCustomElement } from "../../core/registration";
import { emit, formatDuration } from "../../core/utils";
import { tokens } from "../../styles";
import {
  renderWorkspaceNotice,
  workspaceNoticeStyles,
} from "../shared/workspace-notice";
import "./waveform";

const emptySignal = (label: string): WaveformComparisonSignal => ({
  label,
  timings: [],
});

@safeCustomElement("imprint-waveform-comparison")
export class ImprintWaveformComparison extends LitElement {
  @property({ attribute: false }) beforeSignal: WaveformComparisonSignal =
    emptySignal("Before");
  @property({ attribute: false }) afterSignal: WaveformComparisonSignal =
    emptySignal("After");
  @property({ type: Number }) zoom = 1;
  @property({ type: Number }) pan = 0;
  @property({ type: Number }) selectedIndex = -1;
  @property({ type: Boolean }) selectable = false;
  @property({ attribute: "detail-level" }) detailLevel:
    | "plot"
    | "summary"
    | "full" = "full";

  static styles = [
    tokens,
    workspaceNoticeStyles,
    css`
      :host { display: block; min-width: 0; container: waveform-comparison / inline-size; }
      .comparison { display: grid; gap: 11px; min-width: 0; }
      .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 7px 16px; min-width: 0; }
      .summary strong { display: inline-flex; align-items: center; gap: 7px; color: var(--imprint-text); }
      .summary strong ha-icon { color: var(--imprint-accent); }
      .summary span { color: var(--imprint-muted); font-variant-numeric: tabular-nums; }
      .summary b { color: var(--imprint-text); font-weight: 650; }
      .controls { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
      .controls ha-button { min-width: 78px; }
      ha-expansion-panel { min-width: 0; }
      .changes { display: grid; gap: 3px; max-height: 240px; overflow: auto; padding-block: 7px; }
      .change { width: 100%; min-width: 0; --ha-button-height: auto; }
      .change::part(base) { width: 100%; min-height: 44px; padding: 6px 9px; }
      .changes > div.change { box-sizing: border-box; min-height: 44px; padding: 6px 9px; }
      .change-row { width: 100%; min-width: 0; display: grid; grid-template-columns: 50px 68px minmax(0, 1fr) auto; align-items: center; gap: 8px; text-align: start; }
      .change-row > * { min-width: 0; }
      .change-row strong { text-transform: capitalize; }
      .change-row code { overflow-wrap: anywhere; }
      .change-row em { color: var(--imprint-muted); font-style: normal; font-variant-numeric: tabular-nums; }
      .structure-note { margin: 5px 2px 0; color: var(--imprint-muted); font-size: 12px; }
      .actions:empty { display: none; }
      @container waveform-comparison (max-width: 600px) {
        .toolbar { align-items: stretch; flex-direction: column; }
        .controls { justify-content: flex-end; }
        .change-row { grid-template-columns: 42px 62px minmax(0, 1fr); }
        .change-row em { grid-column: 3; }
      }
      @container waveform-comparison (max-width: 390px) {
        .summary { display: grid; grid-template-columns: 1fr; gap: 4px; }
        .controls { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; }
        .controls ha-button { width: 100%; }
      }
    `,
  ];

  render(): TemplateResult {
    const before = this.normalized(this.beforeSignal, "Before");
    const after = this.normalized(this.afterSignal, "After");
    if (!before.timings.length || !after.timings.length) {
      return renderWorkspaceNotice({
        tone: "warning",
        icon: "mdi:waveform",
        content: `${!before.timings.length ? before.label : after.label} does not contain comparable timing data.`,
      });
    }
    const result = compareWaveforms(before, after);
    const countDelta = `${result.countDelta >= 0 ? "+" : "−"}${Math.abs(result.countDelta)}`;
    const durationDelta = `${result.durationDelta >= 0 ? "+" : "−"}${formatDuration(Math.abs(result.durationDelta))}`;
    const changedLabel = result.changes.length
      ? `${result.changes.length} timing${result.changes.length === 1 ? "" : "s"} changed`
      : "Waveforms match";
    return html`<section class="comparison" aria-label=${`${before.label} compared with ${after.label}`}>
      ${this.detailLevel === "plot" ? nothing : html`
        <div class="toolbar">
          <div class="summary" aria-label=${`${changedLabel}. Timing count ${before.timings.length} to ${after.timings.length}. Duration difference ${durationDelta}.`}>
            <strong><ha-icon icon=${result.changes.length ? "mdi:compare-horizontal" : "mdi:check-circle-outline"}></ha-icon>${changedLabel}</strong>
            <span><b>Count</b> ${before.timings.length} → ${after.timings.length} (${countDelta})</span>
            <span><b>Duration</b> ${formatDuration(result.beforeTotal)} → ${formatDuration(result.afterTotal)} (${durationDelta})</span>
          </div>
          ${this.renderControls()}
        </div>`}
      <imprint-signal-waveform
        .timings=${[...after.timings]}
        .original=${[...before.timings]}
        .view=${"compare"}
        .interaction=${this.selectable ? "select" : "inspect"}
        .sourceLabel=${before.label}
        .candidateLabel=${after.label}
        .zoom=${this.zoom}
        .pan=${this.pan}
        .selected=${this.selectedIndex}
        .selectionStart=${this.selectedIndex}
        .selectionEnd=${this.selectedIndex}
        @lab-navigation=${this.onNavigation}
        @lab-selection=${this.onWaveformSelection}
      ></imprint-signal-waveform>
      ${this.detailLevel === "full" ? this.renderChanges(result.changes, result.structureChanged) : nothing}
      <div class="actions"><slot name="actions"></slot></div>
    </section>`;
  }

  private normalized(
    signal: WaveformComparisonSignal | null | undefined,
    fallbackLabel: string,
  ): WaveformComparisonSignal {
    return {
      label: String(signal?.label || fallbackLabel),
      timings: Array.isArray(signal?.timings)
        ? signal.timings.map(Number).filter((value) => Number.isFinite(value) && value > 0)
        : [],
      carrierFrequency: signal?.carrierFrequency,
    };
  }

  private renderControls(): TemplateResult {
    return html`<div class="controls" aria-label="Comparison zoom controls">
      <ha-icon-button .label=${"Zoom out"} .disabled=${this.zoom <= 1} @click=${() => this.changeZoom(this.zoom / 2)}>
        <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
      </ha-icon-button>
      <ha-button appearance="outlined" variant="neutral" title="Fit both signals" @click=${() => this.setNavigation(1, 0)}>
        Fit · ${this.zoom.toFixed(this.zoom % 1 ? 1 : 0)}×
      </ha-button>
      <ha-icon-button .label=${"Zoom in"} .disabled=${this.zoom >= 16} @click=${() => this.changeZoom(this.zoom * 2)}>
        <ha-icon icon="mdi:magnify-plus-outline"></ha-icon>
      </ha-icon-button>
    </div>`;
  }

  private renderChanges(
    changes: WaveformTimingChange[],
    structureChanged: boolean,
  ): TemplateResult {
    if (!changes.length) {
      return renderWorkspaceNotice({
        tone: "success",
        icon: "mdi:check-circle-outline",
        content: "The two timing waveforms match.",
      });
    }
    const shown = changes.slice(0, 200);
    return html`<ha-expansion-panel header=${`Review ${changes.length} timing change${changes.length === 1 ? "" : "s"}`}>
      <div class="changes" aria-label="Timing differences">
        ${shown.map((change) => this.renderChange(change))}
      </div>
      ${structureChanged
        ? html`<p class="structure-note">Added and removed mark/space pairs are aligned before changed timings are counted.</p>`
        : nothing}
      ${changes.length > shown.length
        ? html`<p class="structure-note">Showing the first ${shown.length} changes.</p>`
        : nothing}
    </ha-expansion-panel>`;
  }

  private renderChange(change: WaveformTimingChange): TemplateResult {
    const index = change.afterIndex ?? change.beforeIndex ?? 0;
    const before = change.before == null ? "—" : `${change.before} µs`;
    const after = change.after == null ? "—" : `${change.after} µs`;
    const delta = change.delta == null
      ? change.kind === "inserted" ? "Added" : "Removed"
      : `${change.delta >= 0 ? "+" : "−"}${Math.abs(change.delta)} µs`;
    const content = html`<span class="change-row">
      <span>${index + 1}</span>
      <strong>${change.role}</strong>
      <code>${before} → ${after}</code>
      <em>${delta}</em>
    </span>`;
    if (!this.selectable) return html`<div class="change">${content}</div>`;
    return html`<ha-button
      class="change"
      appearance=${this.selectable && change.afterIndex === this.selectedIndex ? "filled" : "plain"}
      variant="neutral"
      @click=${() => this.selectChange(change)}
    >${content}</ha-button>`;
  }

  private selectChange(change: WaveformTimingChange): void {
    if (!this.selectable) return;
    const fallback = Math.max(0, this.afterSignal.timings.length - 1);
    const index = change.afterIndex ?? Math.min(change.beforeIndex ?? 0, fallback);
    this.selectedIndex = index;
    emit(this, "waveform-comparison-select", { change, index });
  }

  private onWaveformSelection = (event: CustomEvent): void => {
    event.stopPropagation();
    if (!this.selectable) return;
    const index = Number(event.detail?.selected ?? 0);
    this.selectedIndex = index;
    const result = compareWaveforms(this.beforeSignal, this.afterSignal);
    const change = result.changes.find((item) => item.afterIndex === index) || null;
    emit(this, "waveform-comparison-select", { change, index });
  };

  private onNavigation = (event: CustomEvent): void => {
    event.stopPropagation();
    const zoom = Number(event.detail?.zoom || 1);
    const pan = Number(event.detail?.pan || 0);
    this.zoom = zoom;
    this.pan = pan;
    emit(this, "waveform-comparison-navigation", {
      zoom,
      pan,
      anchorTime: Number(event.detail?.anchorTime || 0),
    });
  };

  private changeZoom(nextZoom: number): void {
    const navigation = zoomAt(
      [...this.afterSignal.timings],
      this.zoom,
      this.pan,
      nextZoom,
      0.5,
      Math.max(
        this.beforeSignal.timings.reduce((sum, value) => sum + Number(value || 0), 0),
        this.afterSignal.timings.reduce((sum, value) => sum + Number(value || 0), 0),
      ),
    );
    this.setNavigation(navigation.zoom, navigation.pan, navigation.anchorTime);
  }

  private setNavigation(zoom: number, pan: number, anchorTime = 0): void {
    this.zoom = zoom;
    this.pan = pan;
    emit(this, "waveform-comparison-navigation", { zoom, pan, anchorTime });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-waveform-comparison": ImprintWaveformComparison;
  }
}
