import { LitElement, css, html, nothing, svg, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type { AnalysisData } from "../../types";
import { timingTotal } from "../../core/signal";
import {
  clamp,
  timingAtTime,
  viewWindow,
  zoomAt,
} from "../../core/signal-lab";
import { emit, formatDuration } from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { tokens } from "../../styles";
import {
  normalizeWaveformTarget,
  waveformKeyboardCommand,
  type WaveformKeyboardTarget,
} from "./waveform-keyboard";
import {
  axisLabel,
  axisTicks,
  minimapPath,
  resolvedFrameRole,
  trackGeometry,
} from "./waveform-geometry";
import { WaveformGestureController } from "./waveform-gestures";

let waveformInstance = 0;

@safeCustomElement("imprint-signal-waveform")
export class ImprintSignalWaveform extends LitElement {
  @property({ attribute: false }) timings: number[] = [];
  @property({ attribute: false }) original: number[] = [];
  @property({ attribute: false }) analysis: AnalysisData = {};
  @property({ attribute: false }) frameRoles: string[] = [];
  @property() view: "edit" | "compare" = "edit";
  @property() interaction: "edit" | "select" | "inspect" = "edit";
  @property() sourceLabel = "Before";
  @property() candidateLabel = "After";
  @property({ type: Boolean, attribute: "read-only" }) readOnly = false;
  @property() label = "IR timing waveform";
  @property({ type: Boolean }) reveal = false;
  @property({ type: Number }) zoom = 1;
  @property({ type: Number }) pan = 0;
  @property({ type: Number }) selected = 0;
  @property({ type: Number }) selectionStart = 0;
  @property({ type: Number }) selectionEnd = 0;
  @property({ attribute: false }) cursors: [number, number] = [0, 0];
  @property({ type: Number }) activeCursor = 0;
  @property({ type: Boolean }) showCursors = false;
  @property({ type: Boolean }) showFrames = false;
  @property({ type: Number }) snap = 10;
  @property() boundaryMode: "shift" | "preserve" = "shift";
  @state() private transientTimings: number[] | null = null;
  @state() private dragLabel = "";
  @state() private hovered: {
    time: number;
    track: "source" | "draft";
  } | null = null;
  @state() private keyboardTarget: WaveformKeyboardTarget = {
    kind: "timing",
    index: 0,
  };

  private readonly keyboardId = `imprint-waveform-keyboard-${++waveformInstance}`;
  private readonly gestures = new WaveformGestureController(
    () => ({ zoom: this.zoom, pan: this.pan, total: this.sharedTotal() }),
    ({ zoom, pan, anchorTime }) => this.setNavigation(zoom, pan, anchorTime),
  );

  static styles = [
    tokens,
    css`
    :host { --imprint-waveform-stroke-width: 3px; display: block; min-width: 0; container-type: inline-size; }
    .stack { display: grid; gap: 8px; }
    .canvas {
      position: relative; min-height: 170px; overflow: hidden; border: 1px solid var(--imprint-line);
      border-radius: 12px; background: var(--imprint-surface-2); touch-action: none; cursor: crosshair;
    }
    .canvas.pannable { cursor: grab; }
    .canvas.pannable:active { cursor: grabbing; }
    .canvas:focus-visible { outline: 2px solid var(--imprint-accent); outline-offset: 2px; }
    .canvas.compare { --gutter-size: 44px; --axis-size: 54px; }
    .boundary-layout {
      --gutter-size: 44px;
      --axis-size: 54px;
      --before-size: 0px;
      --after-size: 0px;
      display: grid; grid-template-columns: var(--axis-size) var(--before-size) minmax(0, 1fr) var(--after-size);
    }
    .boundary-layout.has-before { --before-size: var(--gutter-size); }
    .boundary-layout.has-after { --after-size: var(--gutter-size); }
    .track { position: relative; min-height: 170px; }
    .compare .track { min-height: 116px; }
    .plot { position: relative; z-index: 2; grid-column: 3; min-width: 0; }
    .y-axis { position: relative; grid-column: 1; border-inline-end: 1px solid var(--imprint-line); color: var(--imprint-muted); font-size: 11px; }
    .y-axis span { position: absolute; inset-inline-end: 9px; transform: translateY(-50%); }
    .y-axis .mark { inset-block-start: var(--mark-y); }
    .y-axis .space { inset-block-start: var(--space-y); }
    .boundary-gutter {
      position: relative; z-index: 1; min-width: 0; overflow: visible; cursor: default;
      background-color: var(--imprint-surface);
      background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--imprint-muted) 18%, transparent) 5px 6px);
      color: var(--imprint-muted); font-size: 9px; line-height: 1.08; text-align: center;
    }
    .boundary-gutter.before { grid-column: 2; border-inline-end: 1px solid var(--imprint-line); }
    .boundary-gutter.after { grid-column: 4; border-inline-start: 1px solid var(--imprint-line); }
    .boundary-gutter::after {
      content: ""; position: absolute; z-index: 2; inset-inline: -1px; inset-block-start: var(--idle-y);
      height: var(--imprint-waveform-stroke-width); transform: translateY(-50%); background: var(--imprint-accent);
    }
    .source .boundary-gutter::after { background: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .boundary-label {
      position: absolute; z-index: 3; inset-block-start: 8px; inset-inline: 3px;
      padding: 3px 1px; border-radius: 4px; background: color-mix(in srgb, var(--imprint-surface) 90%, transparent);
    }
    .compare .boundary-label { display: none; }
    .compare-boundary-label {
      position: absolute; z-index: 7; inset-block-start: 50%; inline-size: var(--gutter-size);
      transform: translateY(-50%); padding: 3px 2px; box-sizing: border-box;
      border-radius: 4px; background: color-mix(in srgb, var(--imprint-surface) 90%, transparent);
      color: var(--imprint-muted); font-size: 9px; line-height: 1.08; text-align: center; pointer-events: none;
    }
    .compare-boundary-label.before { inset-inline-start: var(--axis-size); }
    .compare-boundary-label.after { inset-inline-end: 0; }
    .track-label {
      position: absolute; z-index: 4; inset-block-start: 8px; inset-inline-start: 10px;
      padding: 3px 7px; border-radius: 6px; background: color-mix(in srgb, var(--imprint-surface) 88%, transparent);
      color: var(--imprint-muted); font-size: 12px; font-weight: 750;
    }
    svg { display: block; width: 100%; height: 170px; overflow: visible; }
    .compare svg { height: 116px; }
    .wave { fill: none; stroke: var(--imprint-accent); stroke-width: var(--imprint-waveform-stroke-width); pointer-events: none; }
    .source .wave { stroke: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .segment { fill: transparent; cursor: pointer; }
    .segment:hover { fill: color-mix(in srgb, var(--imprint-accent) 8%, transparent); outline: none; }
    .segment.selected { fill: color-mix(in srgb, var(--imprint-accent) 18%, transparent); }
    .canvas:focus .segment.keyboard-active { stroke: var(--imprint-accent); stroke-width: 2; fill: color-mix(in srgb, var(--imprint-accent) 18%, transparent); }
    .gap { fill: color-mix(in srgb, var(--imprint-warning) 13%, transparent); pointer-events: none; }
    .edge { stroke: color-mix(in srgb, var(--imprint-accent) 72%, transparent); stroke-width: 9; opacity: 0; cursor: ew-resize; }
    .edge:hover, .edge.active { opacity: .7; outline: none; }
    .cursor-hit { stroke: transparent; stroke-width: 18; cursor: ew-resize; }
    .cursor-line { stroke-width: 2; pointer-events: none; }
    .cursor-a .cursor-line { stroke: var(--imprint-success); }
    .cursor-b .cursor-line { stroke: var(--imprint-warning); }
    .cursor.active .cursor-line { stroke-width: 4; }
    .cursor-handle { stroke-width: 2; fill: var(--imprint-surface); pointer-events: none; }
    .cursor-handle.cursor-a { stroke: var(--imprint-success); }
    .cursor-handle.cursor-b { stroke: var(--imprint-warning); }
    .cursor-handle.active { stroke-width: 3; }
    .signal-edge { stroke: var(--imprint-accent); stroke-width: var(--imprint-waveform-stroke-width); pointer-events: none; }
    .grid-line { stroke: color-mix(in srgb, var(--imprint-line) 72%, transparent); stroke-width: 1; pointer-events: none; }
    .source .signal-edge { stroke: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .annotations { position: absolute; z-index: 3; inset: 0; pointer-events: none; }
    .frame {
      position: absolute; inset-block-start: 4px; min-width: 3px; height: 24px; overflow: visible;
      border: 0; border-radius: 5px; background: color-mix(in srgb, var(--imprint-accent) 11%, transparent);
      color: var(--imprint-text); padding: 3px 7px; box-sizing: border-box; font-size: 11px; text-align: start; pointer-events: auto;
    }
    .frame::after {
      content: ""; position: absolute; inset-block-start: 50%; inset-inline-start: 50%;
      inline-size: max(44px, 100%); block-size: 44px; transform: translate(-50%, -50%);
    }
    .frame.compact { padding-inline: 0; }
    .frame.repeat { background: color-mix(in srgb, var(--imprint-success) 13%, transparent); }
    .frame.ending { background: color-mix(in srgb, var(--imprint-warning) 13%, transparent); }
    .density { fill: color-mix(in srgb, var(--imprint-accent) 52%, transparent); pointer-events: none; }
    .detail-note { position: absolute; inset-block-end: 8px; inset-inline-end: 10px; font-size: 11px; color: var(--imprint-muted); }
    .hover-probe { position: absolute; z-index: 6; inset-block: 0; border-inline-start: 1px dashed var(--imprint-text); pointer-events: none; }
    .hover-probe output { position: absolute; inset-block-start: 3px; inset-inline-start: 0; transform: translateX(-50%); white-space: nowrap; border: 1px solid var(--imprint-line); border-radius: 7px; background: var(--imprint-surface); padding: 4px 8px; color: var(--imprint-text); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: 0 4px 12px rgba(0,0,0,.16); }
    .hover-readout { display: grid; gap: 2px; min-width: 190px; }
    .hover-readout strong { color: var(--imprint-accent); }
    .hover-readout span { display: flex; justify-content: space-between; gap: 12px; }
    .hover-readout b { color: var(--imprint-muted); font-weight: 650; }
    .hover-probe.near-start output { transform: none; }
    .hover-probe.near-end output { transform: translateX(-100%); }
    .drag-readout {
      position: absolute; z-index: 7; inset-block-end: 10px; inset-inline-start: 50%; transform: translateX(-50%);
      padding: 6px 9px; border-radius: 7px; background: var(--imprint-text); color: var(--imprint-surface);
      font-size: 12px; font-variant-numeric: tabular-nums; pointer-events: none;
    }
    .ruler { position: relative; grid-column: 3; min-height: 44px; color: var(--imprint-muted); font-size: 11px; cursor: text; touch-action: none; }
    .ruler-tick { position: absolute; inset-block-start: 0; transform: translateX(-50%); padding-block-start: 15px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ruler-tick::before { content: ""; position: absolute; inset-block-start: 0; inset-inline-start: 50%; block-size: 8px; border-inline-start: 1px solid var(--imprint-muted); opacity: .65; }
    .ruler-tick.first { transform: none; }
    .ruler-tick.last { transform: translateX(-100%); }
    .minimap {
      height: 58px; overflow: hidden; border: 1px solid var(--imprint-line); border-radius: 9px;
      background: var(--imprint-surface);
    }
    .minimap-plot { position: relative; grid-column: 3; min-width: 0; overflow: hidden; touch-action: none; }
    .minimap svg { width: 100%; height: 100%; }
    .minimap .wave { stroke-width: 2; }
    .minimap .boundary-label { display: none; }
    .minimap .boundary-gutter::after { height: 2px; }
    .window { position: absolute; inset-block: 3px; border: 2px solid var(--imprint-accent); border-radius: 6px; background: var(--imprint-accent-soft); cursor: grab; }
    .empty { min-height: 170px; display: grid; place-items: center; color: var(--imprint-muted); text-align: center; padding: 24px; }
    .read-only .boundary-layout { --gutter-size: 34px; --axis-size: 44px; }
    .read-only .canvas,
    .read-only .track { min-height: 112px; }
    .read-only .canvas { cursor: default; touch-action: auto; }
    .read-only svg { height: 112px; }
    .compare,
    .read-only { --imprint-waveform-stroke-width: 1px; }
    .read-only .ruler { min-height: 36px; cursor: default; touch-action: auto; }
    .read-only .ruler-tick { padding-block-start: 12px; }
    .read-only .y-axis { font-size: 9px; }
    .read-only .y-axis span { inset-inline-end: 6px; }
    .read-only .detail-note { display: none; }
    .read-only.reveal .plot svg { animation: reveal-wave 460ms cubic-bezier(.16,1,.3,1) both; }
    .read-only-empty { min-height: 150px; }
    @keyframes reveal-wave { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }
    .sr-only { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @container (max-width: 620px) {
      .canvas.compare { --gutter-size: 34px; --axis-size: 42px; }
      .boundary-layout { --gutter-size: 34px; --axis-size: 42px; }
      .canvas, .track { min-height: 152px; }
      svg { height: 152px; }
      .frame span { display: none; }
      .minimap { height: 52px; }
      .y-axis { font-size: 9px; }
      .y-axis span { inset-inline-end: 6px; }
      .ruler-tick:nth-child(even):not(.last) { display: none; }
      .ruler-tick:nth-last-child(2) { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; }
      .read-only.reveal .plot svg { animation: none; }
    }
  `,
  ];

  disconnectedCallback(): void {
    this.gestures.stop();
    super.disconnectedCallback();
  }

  render(): TemplateResult {
    const timings = this.transientTimings || this.timings;
    if (this.readOnly) return this.renderReadOnly(timings);
    if (!timings.length)
      return html`<div class="empty">No timing values are available for this signal.</div>`;
    const currentTotal = timingTotal(timings);
    const sourceTotal = timingTotal(this.original);
    const total =
      this.view === "compare"
        ? Math.max(currentTotal, sourceTotal)
        : currentTotal;
    const comparisonWindow = viewWindow(timings, this.zoom, this.pan, total);
    const comparisonShowsBefore = comparisonWindow.start <= Number.EPSILON;
    const comparisonShowsAfter =
      comparisonWindow.end >= comparisonWindow.total - Number.EPSILON;
    const keyboardTarget = normalizeWaveformTarget(
      this.keyboardTarget,
      timings.length,
      this.showCursors,
    );
    const activeDescendant = `${this.keyboardId}-${keyboardTarget.kind}-${keyboardTarget.index}`;
    const editing = this.view === "edit" && this.interaction === "edit";
    const selecting = this.view === "compare" && this.interaction === "select";
    return html`<div class="stack" @keydown=${editing ? this.onShortcut : nothing}>
      <div class="canvas ${this.zoom > 1 ? "pannable" : ""} ${this.view === "compare" ? "compare" : ""}"
        tabindex=${editing ? "0" : nothing}
        role=${editing ? "application" : "group"}
        aria-roledescription=${editing ? "interactive timing waveform" : "waveform comparison"}
        aria-label=${editing ? "Editable timing waveform" : `${this.sourceLabel} and ${this.candidateLabel} timing comparison`}
        aria-describedby=${editing ? `${this.keyboardId}-help` : nothing}
        aria-activedescendant=${editing ? activeDescendant : nothing}
        @focus=${editing ? this.onCompositeFocus : nothing}
        @keydown=${editing ? this.onCompositeKeydown : nothing}
        @wheel=${this.onWheel}
        @pointerdown=${this.interaction === "inspect" ? nothing : this.onPointerDown}>
        ${editing ? html`<span class="sr-only" id=${activeDescendant} role="option" aria-selected="true">
          ${this.keyboardTargetDescription(keyboardTarget, timings, total)}
        </span>
        <span class="sr-only" id="${this.keyboardId}-help">
          Use Left and Right to choose a timing, Up and Down to adjust it, and Shift for larger steps.${this.showCursors ? " Press A or B to edit a measurement cursor, then T to return to timings." : ""}
        </span>` : nothing}
        ${
          this.view === "compare"
            ? html`${this.renderTrack(this.original, total, this.sourceLabel, "source", false)}${this.renderTrack(timings, total, this.candidateLabel, "draft", selecting)}`
            : this.renderTrack(timings, total, "", "draft", true)
        }
        ${this.view === "compare"
          ? html`${comparisonShowsBefore
              ? this.renderSharedBoundaryLabel("before")
              : nothing}${comparisonShowsAfter
              ? this.renderSharedBoundaryLabel("after")
              : nothing}`
          : nothing}
        ${this.dragLabel ? html`<output class="drag-readout" aria-live="polite">${this.dragLabel}</output>` : nothing}
      </div>
      ${this.renderRuler(timings, total, editing)}
      ${this.zoom > 1 ? this.renderMinimap(timings, total) : nothing}
    </div>`;
  }

  private renderReadOnly(source: number[]): TemplateResult {
    const timings = source
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    const total = timingTotal(timings);
    if (!timings.length || !total) {
      return html`<div class="empty read-only-empty">Signal preview unavailable</div>`;
    }
    return html`<div class="stack read-only ${this.reveal ? "reveal" : ""}"
      role="img"
      aria-label=${`${this.label}; ${timings.length} timings; ${formatDuration(total)}`}
    >
      <div class="canvas">
        ${this.renderTrack(timings, total, "", "draft", false)}
      </div>
      ${this.renderRuler(timings, total, false)}
    </div>`;
  }

  private renderRuler(
    timings: number[],
    total: number,
    interactive: boolean,
  ): TemplateResult {
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const showBefore = window.start <= Number.EPSILON;
    const showAfter = window.end >= window.total - Number.EPSILON;
    const boundaryClasses = `${showBefore ? "has-before" : ""} ${showAfter ? "has-after" : ""}`;
    return html`<div class="ruler-layout boundary-layout ${boundaryClasses}">
      <div class="ruler"
        aria-label=${interactive ? "Timing ruler. Drag to select a range." : nothing}
        aria-hidden=${interactive ? nothing : "true"}
        @pointerdown=${interactive ? this.onRulerDown : nothing}>
        ${axisTicks(window.start, window.end).map((time, index, ticks) => {
          const position = ((time - window.start) / window.span) * 100;
          return html`<span class="ruler-tick ${index === 0 ? "first" : ""} ${index === ticks.length - 1 ? "last" : ""}" style=${`inset-inline-start:${position}%`}>${axisLabel(time)}</span>`;
        })}
      </div>
    </div>`;
  }

  private renderTrack(
    timings: number[],
    total: number,
    label: string,
    kind: "source" | "draft",
    interactive: boolean,
  ): TemplateResult {
    const {
      geometry,
      high,
      low,
      height,
      path,
      segments,
      density,
      visibleFrames,
      frameCount,
      showBefore,
      showAfter,
      boundaryClasses,
      idlePercent,
      markPercent,
      ticks,
    } = trackGeometry(
      timings,
      total,
      this.zoom,
      this.pan,
      this.view === "compare",
      interactive && this.showFrames,
    );
    const [selectionStart, selectionEnd] = [
      Math.min(this.selectionStart, this.selectionEnd),
      Math.max(this.selectionStart, this.selectionEnd),
    ];
    const detailed = geometry.detailed;
    const viewStart = (geometry.view.start / geometry.view.total) * 1000;
    const viewWidth = (geometry.view.span / geometry.view.total) * 1000;
    const hoverPercent = this.hovered
      ? clamp(
          ((this.hovered.time - geometry.view.start) / geometry.view.span) *
            100,
          0,
          100,
        )
      : 0;
    const hoverable = interactive || this.view === "compare";
    const hoverIndex = this.hovered && this.hovered.time <= geometry.signalTotal
      ? timingAtTime(timings, this.hovered.time)
      : -1;
    const keyboardTarget = normalizeWaveformTarget(
      this.keyboardTarget,
      timings.length,
      this.showCursors,
    );
    return html`<div class="track ${kind} boundary-layout ${boundaryClasses}">
      <div class="y-axis" style=${`--mark-y:${markPercent}%;--space-y:${idlePercent}%`} aria-hidden="true"><span class="mark">Mark</span><span class="space">Space</span></div>
      ${showBefore ? this.renderBoundaryGutter("before", idlePercent, this.view !== "compare") : nothing}
      <div class="plot">
      ${label ? html`<span class="track-label">${label}</span>` : nothing}
      <svg viewBox="${viewStart} 0 ${viewWidth} ${height}" preserveAspectRatio="none" data-track=${kind} data-total=${total}
        data-view-start=${geometry.view.start} data-view-span=${geometry.view.span} data-zoom=${geometry.view.zoom}
        aria-hidden="true" focusable="false"
        @pointermove=${hoverable ? (event: PointerEvent) => this.onHover(event, timings, total, kind) : nothing}
        @pointerdown=${this.view === "compare" && this.interaction === "inspect"
          ? (event: PointerEvent) => this.onHover(event, timings, total, kind, true)
          : nothing}
        @pointerleave=${hoverable ? this.clearHover : nothing}>
        ${ticks.map((time) => {
          const x = (time / total) * 1000;
          return svg`<line class="grid-line" x1=${x} x2=${x} y1="8" y2=${height - 8} vector-effect="non-scaling-stroke"></line>`;
        })}
        ${
          this.showFrames
            ? segments
                .filter((index) => index % 2 && timings[index] >= 10_000)
                .map((index) => {
                  const x = (geometry.offsets[index] / total) * 1000;
                  const width =
                    ((geometry.offsets[index + 1] - geometry.offsets[index]) /
                      total) *
                    1000;
                  return svg`<rect class="gap" x=${x} y="8" width=${Math.max(1, width)} height=${height - 16}></rect>`;
                })
            : nothing
        }
        ${density.map((bucket) => svg`<rect class="density" x=${bucket.x} y=${low - bucket.height} width=${bucket.width} height=${bucket.height}></rect>`)}
        ${segments.map((index) => {
          const x = (geometry.offsets[index] / total) * 1000;
          const width =
            ((geometry.offsets[index + 1] - geometry.offsets[index]) / total) *
            1000;
          const selected =
            interactive && index >= selectionStart && index <= selectionEnd;
          const keyboardActive =
            interactive &&
            keyboardTarget.kind === "timing" &&
            keyboardTarget.index === index;
          return svg`<rect class="segment ${selected ? "selected" : ""} ${keyboardActive ? "keyboard-active" : ""}" data-segment=${interactive ? index : nothing}
            x=${x} y="8" width=${Math.max(1, width)} height=${height - 16}></rect>`;
        })}
        ${path ? svg`<path class="wave" d=${path} vector-effect="non-scaling-stroke"></path>` : nothing}
        ${
          interactive && this.interaction === "edit" && detailed
            ? segments
                .filter((index) => index < timings.length - 1)
                .map((index) => {
                  const x = (geometry.offsets[index + 1] / total) * 1000;
                  return svg`<line class="edge" data-edge=${index} x1=${x} x2=${x} y1="8" y2=${height - 8}></line>`;
                })
            : nothing
        }
        ${
          interactive && this.interaction === "edit" && this.showCursors
            ? this.cursors.map((time, index) => {
                const x = clamp((time / Math.max(total, 1)) * 1000, 0, 1000);
                return svg`<g class="cursor ${index ? "cursor-b" : "cursor-a"} ${this.activeCursor === index ? "active" : ""}" data-cursor=${index}>
            <line class="cursor-hit" x1=${x} x2=${x} y1="4" y2=${height - 4}></line>
            <line class="cursor-line" x1=${x} x2=${x} y1="4" y2=${height - 4} vector-effect="non-scaling-stroke"></line>
          </g>`;
              })
            : nothing
        }
        ${showBefore ? svg`<line class="signal-edge signal-start" data-signal-edge="start" x1="0" x2="0" y1=${low} y2=${high} vector-effect="non-scaling-stroke"></line>` : nothing}
        ${showAfter && timings.length % 2 ? svg`<line class="signal-edge signal-end" data-signal-edge="end" x1=${(geometry.signalTotal / total) * 1000} x2=${(geometry.signalTotal / total) * 1000} y1=${high} y2=${low} vector-effect="non-scaling-stroke"></line>` : nothing}
        ${
          interactive && this.interaction === "edit" && this.showCursors
            ? this.cursors.map((time, index) => {
                const x = clamp((time / Math.max(total, 1)) * 1000, 0, 1000);
                return svg`<circle class="cursor-handle ${index ? "cursor-b" : "cursor-a"} ${this.activeCursor === index ? "active" : ""}"
            cx=${x} cy=${height - 9} r="5"></circle>`;
              })
            : nothing
        }
      </svg>
      ${hoverable && this.hovered ? html`<div
        class="hover-probe ${hoverPercent < 12 ? "near-start" : ""} ${hoverPercent > 88 ? "near-end" : ""}"
        style=${`inset-inline-start:${hoverPercent}%`}
        data-hover-probe
        data-hover-track=${kind}
      >${this.hovered.track === kind
          ? html`<output>${this.view === "compare"
              ? this.renderComparisonHover(this.hovered.time)
              : hoverIndex >= 0
                ? html`${formatDuration(timings[hoverIndex])} · ${hoverIndex % 2 ? "space" : "mark"}`
                : "After signal"}</output>`
          : nothing}</div>` : nothing}
      ${
        interactive && this.showFrames
          ? html`<div class="annotations">${visibleFrames.map((frame) => {
              const left = clamp(
                ((frame.startTime - geometry.view.start) / geometry.view.span) *
                  100,
                0,
                100,
              );
              const right = clamp(
                ((frame.endTime - geometry.view.start) / geometry.view.span) *
                  100,
                0,
                100,
              );
              const width = Math.max(0.8, right - left);
              const role = resolvedFrameRole(
                frame.index,
                frameCount,
                this.frameRoles,
                this.analysis,
              );
              const showLabel = width >= 6;
              return html`<button class="frame ${role} ${showLabel ? "" : "compact"}" style=${`inset-inline-start:${left}%;width:${width}%`}
          @click=${(event: Event) => {
            event.stopPropagation();
            emit(this, "lab-frame-select", { index: frame.index });
          }}
          aria-label=${`Frame ${frame.index + 1}${role ? ` · ${role}` : ""}`}
          title=${`Frame ${frame.index + 1}${role ? ` · ${role}` : ""}`}>${showLabel ? html`<span>Frame ${frame.index + 1}${role ? ` · ${role}` : ""}</span>` : nothing}</button>`;
            })}</div>`
          : nothing
      }
      ${!detailed ? html`<span class="detail-note">Zoom in to edit individual timings</span>` : nothing}
      </div>
      ${showAfter ? this.renderBoundaryGutter("after", idlePercent, this.view !== "compare") : nothing}
    </div>`;
  }

  private renderBoundaryGutter(
    position: "before" | "after",
    idlePercent: number,
    announce = true,
  ): TemplateResult {
    const label = position === "before" ? "Before signal" : "After signal";
    return html`<div class="boundary-gutter ${position}" data-signal-gutter=${position}
      style=${`--idle-y:${idlePercent}%`} role=${announce ? "note" : nothing}
      aria-hidden=${announce ? nothing : "true"}
      aria-label=${announce ? `${label}, display only; not part of captured timing` : nothing}
      title=${`${label} · display only · not part of captured timing`}>
      <span class="boundary-label">${label}</span>
    </div>`;
  }

  private renderSharedBoundaryLabel(
    position: "before" | "after",
  ): TemplateResult {
    const label = position === "before" ? "Before signal" : "After signal";
    return html`<span class="compare-boundary-label ${position}" role="note"
      aria-label=${`${label}, shared display gutter; not part of either captured timing`}
      title=${`${label} · shared display gutter · not part of captured timing`}>${label}</span>`;
  }

  private renderComparisonHover(time: number): TemplateResult {
    const value = (timings: number[]): { index: number; duration: number } | null => {
      if (!timings.length || time > timingTotal(timings)) return null;
      const index = timingAtTime(timings, time);
      return { index, duration: Number(timings[index]) || 0 };
    };
    const source = value(this.original);
    const candidate = value(this.transientTimings || this.timings);
    const description = (
      label: string,
      current: { index: number; duration: number } | null,
    ) => html`<span><b>${label}</b><span>${current
      ? `${formatDuration(current.duration)} · ${current.index % 2 ? "space" : "mark"}`
      : "After signal"}</span></span>`;
    const delta = source && candidate
      ? candidate.duration - source.duration
      : null;
    return html`<span class="hover-readout">
      <strong>${formatDuration(time)}</strong>
      ${description(this.sourceLabel, source)}
      ${description(this.candidateLabel, candidate)}
      ${delta == null
        ? nothing
        : html`<span><b>Difference</b><span>${delta >= 0 ? "+" : "−"}${formatDuration(Math.abs(delta))}</span></span>`}
    </span>`;
  }

  private renderMinimap(timings: number[], total: number): TemplateResult {
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const offsets = timingTotal(timings)
      ? minimapPath(timings, total)
      : "";
    const left = (window.start / window.total) * 100;
    const width = (window.span / window.total) * 100;
    return html`<div class="minimap boundary-layout has-before has-after">
      <div aria-hidden="true"></div>
      ${this.renderBoundaryGutter("before", (42 / 52) * 100)}
      <div class="minimap-plot" tabindex="0" role="slider" aria-label="Signal overview"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(left)}
        @pointerdown=${this.onMinimapDown} @keydown=${this.onMinimapKey}>
        <svg viewBox="0 0 1000 52" preserveAspectRatio="none" aria-hidden="true"><path class="wave" d=${offsets} vector-effect="non-scaling-stroke"></path></svg>
        <i class="window" style=${`inset-inline-start:${left}%;width:${width}%`}></i>
      </div>
      ${this.renderBoundaryGutter("after", (42 / 52) * 100)}
    </div>`;
  }

  private onHover(
    event: PointerEvent,
    timings: number[],
    total: number,
    track: "source" | "draft",
    includeTouch = false,
  ): void {
    if (this.gestures.active || (!includeTouch && event.pointerType === "touch")) return;
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const ratio = clamp(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      0,
      1,
    );
    const time = window.start + ratio * window.span;
    this.hovered = { time, track };
  }

  private clearHover = (): void => {
    this.hovered = null;
  };

  private onCompositeFocus(): void {
    if (this.keyboardTarget.kind !== "timing") return;
    this.keyboardTarget = {
      kind: "timing",
      index: Math.round(
        clamp(this.selected, 0, Math.max(0, this.timings.length - 1)),
      ),
    };
  }

  private onCompositeKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const result = waveformKeyboardCommand({
      key: event.key,
      shiftKey: event.shiftKey,
      target: this.keyboardTarget,
      timingCount: this.timings.length,
      cursors: this.cursors,
      showCursors: this.showCursors,
      selected: this.selected,
      snap: this.snap,
      total: this.sharedTotal(),
    });
    if (!result.handled) return;
    event.preventDefault();
    event.stopPropagation();
    this.keyboardTarget = result.target;
    if (!result.action) return;
    if (result.action.kind === "select") {
      emit(this, "lab-selection", {
        selected: result.action.index,
        start: event.shiftKey ? this.selectionStart : result.action.index,
        end: result.action.index,
        revealTable: true,
      });
      return;
    }
    if (result.action.kind === "nudge") {
      emit(this, "lab-shortcut", {
        action: "nudge",
        index: result.action.index,
        amount: result.action.amount,
      });
      return;
    }
    emit(this, "lab-cursor-change", {
      index: result.action.index,
      time: result.action.time,
    });
  }

  private keyboardTargetDescription(
    target: WaveformKeyboardTarget,
    timings: number[],
    total: number,
  ): string {
    if (target.kind === "cursor") {
      return `Cursor ${target.index ? "B" : "A"}, ${formatDuration(this.cursors[target.index])}, range 0 to ${formatDuration(total)}`;
    }
    const index = Math.round(
      clamp(target.index, 0, Math.max(0, timings.length - 1)),
    );
    return `${index % 2 ? "Space" : "Mark"} ${index + 1} of ${timings.length}, ${formatDuration(timings[index] || 0)}`;
  }

  private onShortcut(event: KeyboardEvent): void {
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement
    )
      return;
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let action = "";
    if (command && key === "c") action = "copy";
    else if (command && key === "v") action = "paste";
    else if (command && key === "x") action = "cut";
    else if (command && key === "d") action = "duplicate-selection";
    else if (command && key === "z" && event.shiftKey) action = "redo";
    else if (command && key === "z") action = "undo";
    else if (event.key === "Delete" || event.key === "Backspace")
      action = "delete-selection";
    else if (event.key === "Escape") action = "escape";
    if (!action) return;
    event.preventDefault();
    emit(this, "lab-shortcut", { action });
  }

  private onWheel(event: WheelEvent): void {
    if (this.isBoundaryEvent(event)) return;
    event.preventDefault();
    const rect = this.plotRect(event);
    const ratio = clamp(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      0,
      1,
    );
    const navigation = zoomAt(
      this.timings,
      this.zoom,
      this.pan,
      this.zoom * (event.deltaY < 0 ? 1.25 : 0.8),
      ratio,
      this.sharedTotal(),
    );
    this.setNavigation(navigation.zoom, navigation.pan, navigation.anchorTime);
  }

  private onPointerDown(event: PointerEvent): void {
    const path = event.composedPath();
    if (this.isBoundaryEvent(event)) return;
    const edge = path.find(
      (item) => item instanceof SVGElement && item.hasAttribute("data-edge"),
    ) as SVGElement | undefined;
    const cursor = path.find(
      (item) => item instanceof SVGElement && item.hasAttribute("data-cursor"),
    ) as SVGElement | undefined;
    const segment = path.find(
      (item) => item instanceof SVGElement && item.hasAttribute("data-segment"),
    ) as SVGElement | undefined;
    (event.currentTarget as HTMLElement).focus({ preventScroll: true });
    if (edge) {
      const index = Number(edge.dataset.edge);
      this.keyboardTarget = { kind: "timing", index };
      const svg = path.find((item) => item instanceof SVGSVGElement) as
        | SVGSVGElement
        | undefined;
      const rect =
        svg?.getBoundingClientRect() ||
        (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.gestures.beginEdge(event, rect, {
        timings: this.timings,
        index,
        snap: this.snap,
        preserve: this.boundaryMode === "preserve",
        onPreview: (next, baseline) => {
          this.transientTimings = next;
          this.dragLabel = `${index % 2 ? "Space" : "Mark"} ${formatDuration(next[index])} · ${next[index] - baseline[index] >= 0 ? "+" : ""}${next[index] - baseline[index]} µs`;
          emit(this, "lab-edge-change", {
            index,
            timings: next,
            baseline,
            phase: "preview",
          });
        },
        onCommit: (next, baseline) => {
          this.transientTimings = null;
          this.dragLabel = "";
          emit(this, "lab-edge-change", {
            index,
            timings: next,
            baseline,
            phase: "commit",
          });
        },
        onCancel: (baseline) => {
          this.transientTimings = null;
          this.dragLabel = "";
          emit(this, "lab-edge-change", {
            index,
            timings: baseline,
            baseline,
            phase: "cancel",
          });
        },
      });
      return;
    }
    if (cursor) {
      const index = Number(cursor.dataset.cursor) === 1 ? 1 : 0;
      this.keyboardTarget = { kind: "cursor", index };
      const svg = path.find((item) => item instanceof SVGSVGElement) as
        | SVGSVGElement
        | undefined;
      if (svg) {
        this.gestures.beginCursor(
          event,
          svg.getBoundingClientRect(),
          index,
          (cursorIndex, time) =>
            emit(this, "lab-cursor-change", { index: cursorIndex, time }),
        );
      }
      return;
    }
    if (segment) {
      event.preventDefault();
      const index = Number(segment.dataset.segment);
      this.keyboardTarget = { kind: "timing", index };
      emit(this, "lab-selection", {
        selected: index,
        start: event.shiftKey ? this.selectionStart : index,
        end: index,
        revealTable: true,
      });
      return;
    }
    if (event.pointerType === "touch") {
      this.gestures.beginTouch(event, this.plotRect(event));
      return;
    }
    if (this.zoom > 1) this.gestures.beginPan(event, this.plotRect(event));
  }

  private onRulerDown(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.gestures.beginRange(
      event,
      rect,
      this.timings,
      (start, end, revealTable) =>
        emit(this, "lab-selection", {
          selected: start,
          start,
          end,
          revealTable,
        }),
    );
  }

  private onMinimapDown(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.gestures.beginMinimap(event, rect);
  }

  private onMinimapKey(event: KeyboardEvent): void {
    if (
      this.zoom <= 1 ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const pan =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : clamp(this.pan + (event.key === "ArrowRight" ? 0.1 : -0.1), 0, 1);
    const window = viewWindow(this.timings, this.zoom, pan, this.sharedTotal());
    this.setNavigation(this.zoom, pan, window.start + window.span / 2);
  }

  private setNavigation(zoom: number, pan: number, anchorTime: number): void {
    this.zoom = zoom;
    this.pan = pan;
    this.requestUpdate();
    emit(this, "lab-navigation", { zoom, pan, anchorTime });
  }

  private isBoundaryEvent(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (item) =>
          item instanceof HTMLElement &&
          item.classList.contains("boundary-gutter"),
      );
  }

  private plotRect(event: Event): DOMRect {
    const plot = event
      .composedPath()
      .find(
        (item) =>
          item instanceof HTMLElement && item.classList.contains("plot"),
      ) as HTMLElement | undefined;
    const fallback =
      this.renderRoot.querySelector<HTMLElement>(".track.draft .plot");
    return (
      plot ||
      fallback ||
      (event.currentTarget as HTMLElement)
    ).getBoundingClientRect();
  }

  private sharedTotal(): number {
    return this.view === "compare"
      ? Math.max(timingTotal(this.timings), timingTotal(this.original))
      : timingTotal(this.timings);
  }

}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-signal-waveform": ImprintSignalWaveform;
  }
}
