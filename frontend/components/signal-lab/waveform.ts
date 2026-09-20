import { LitElement, css, html, nothing, svg, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import type { AnalysisData } from "../../types";
import { frameRanges, timingTotal } from "../../core/signal";
import {
  clamp,
  editBoundary,
  timingAtTime,
  viewWindow,
  waveGeometry,
  zoomAt,
} from "../../core/signal-lab";
import { emit, formatDuration } from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { tokens } from "../../styles";

type Point = { x: number; y: number };

@safeCustomElement("imprint-signal-waveform")
export class ImprintSignalWaveform extends LitElement {
  @property({ attribute: false }) timings: number[] = [];
  @property({ attribute: false }) original: number[] = [];
  @property({ attribute: false }) analysis: AnalysisData = {};
  @property({ attribute: false }) frameRoles: string[] = [];
  @property() view: "edit" | "compare" = "edit";
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
  @state() private hovered: { time: number; index: number } | null = null;

  private cleanupDrag: (() => void) | null = null;
  private touchPoints = new Map<number, Point>();
  private touchBaseline: {
    points: Map<number, Point>;
    zoom: number;
    pan: number;
    distance: number;
    anchorTime: number;
    anchorRatio: number;
    rect: DOMRect;
    total: number;
  } | null = null;

  static styles = [
    tokens,
    css`
    :host { display: block; min-width: 0; }
    .stack { display: grid; gap: 8px; }
    .canvas {
      position: relative; min-height: 170px; overflow: hidden; border: 1px solid var(--imprint-line);
      border-radius: 12px; background: var(--imprint-surface-2); touch-action: none; cursor: crosshair;
    }
    .canvas.pannable { cursor: grab; }
    .canvas.pannable:active { cursor: grabbing; }
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
      position: relative; z-index: 1; min-width: 0; overflow: hidden; cursor: default;
      background-color: var(--imprint-surface);
      background-image: repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--imprint-muted) 18%, transparent) 5px 6px);
      color: var(--imprint-muted); font-size: 9px; line-height: 1.08; text-align: center;
    }
    .boundary-gutter.before { grid-column: 2; border-inline-end: 1px solid var(--imprint-line); }
    .boundary-gutter.after { grid-column: 4; border-inline-start: 1px solid var(--imprint-line); }
    .boundary-gutter::after {
      content: ""; position: absolute; z-index: 2; inset-inline: 0; inset-block-start: var(--idle-y);
      height: 3px; transform: translateY(-50%); background: var(--imprint-accent);
    }
    .source .boundary-gutter::after { background: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .boundary-label {
      position: absolute; z-index: 3; inset-block-start: 8px; inset-inline: 3px;
      padding: 3px 1px; border-radius: 4px; background: color-mix(in srgb, var(--imprint-surface) 90%, transparent);
    }
    .track-label {
      position: absolute; z-index: 4; inset-block-start: 8px; inset-inline-start: 10px;
      padding: 3px 7px; border-radius: 6px; background: color-mix(in srgb, var(--imprint-surface) 88%, transparent);
      color: var(--imprint-muted); font-size: 12px; font-weight: 750;
    }
    svg { display: block; width: 100%; height: 170px; overflow: visible; }
    .compare svg { height: 116px; }
    .wave { fill: none; stroke: var(--imprint-accent); stroke-width: 3; pointer-events: none; }
    .source .wave { stroke: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .segment { fill: transparent; cursor: pointer; }
    .segment:hover, .segment:focus { fill: color-mix(in srgb, var(--imprint-accent) 8%, transparent); outline: none; }
    .segment.selected { fill: color-mix(in srgb, var(--imprint-accent) 18%, transparent); }
    .gap { fill: color-mix(in srgb, var(--imprint-warning) 13%, transparent); pointer-events: none; }
    .edge { stroke: color-mix(in srgb, var(--imprint-accent) 72%, transparent); stroke-width: 9; opacity: 0; cursor: ew-resize; }
    .edge:hover, .edge:focus, .edge.active { opacity: .7; outline: none; }
    .cursor-hit { stroke: transparent; stroke-width: 18; cursor: ew-resize; }
    .cursor-line { stroke-width: 2; pointer-events: none; }
    .cursor-a .cursor-line { stroke: var(--imprint-success); }
    .cursor-b .cursor-line { stroke: var(--imprint-warning); }
    .cursor.active .cursor-line { stroke-width: 4; }
    .cursor-handle { stroke-width: 2; fill: var(--imprint-surface); pointer-events: none; }
    .cursor-handle.cursor-a { stroke: var(--imprint-success); }
    .cursor-handle.cursor-b { stroke: var(--imprint-warning); }
    .cursor-handle.active { stroke-width: 3; }
    .signal-edge { stroke: var(--imprint-accent); stroke-width: 3; pointer-events: none; }
    .grid-line { stroke: color-mix(in srgb, var(--imprint-line) 72%, transparent); stroke-width: 1; pointer-events: none; }
    .source .signal-edge { stroke: color-mix(in srgb, var(--imprint-text) 82%, var(--imprint-muted)); }
    .annotations { position: absolute; z-index: 3; inset: 0; pointer-events: none; }
    .frame {
      position: absolute; inset-block-start: 4px; min-width: 3px; height: 24px; overflow: hidden;
      border: 0; border-radius: 5px; background: color-mix(in srgb, var(--imprint-accent) 11%, transparent);
      color: var(--imprint-text); padding: 3px 7px; box-sizing: border-box; font-size: 11px; text-align: start; pointer-events: auto;
    }
    .frame.compact { padding-inline: 0; }
    .frame.repeat { background: color-mix(in srgb, var(--imprint-success) 13%, transparent); }
    .frame.ending { background: color-mix(in srgb, var(--imprint-warning) 13%, transparent); }
    .density { fill: color-mix(in srgb, var(--imprint-accent) 52%, transparent); pointer-events: none; }
    .detail-note { position: absolute; inset-block-end: 8px; inset-inline-end: 10px; font-size: 11px; color: var(--imprint-muted); }
    .hover-probe { position: absolute; z-index: 6; inset-block: 0; border-inline-start: 1px dashed var(--imprint-text); pointer-events: none; }
    .hover-probe output { position: absolute; inset-block-start: 3px; inset-inline-start: 0; transform: translateX(-50%); white-space: nowrap; border: 1px solid var(--imprint-line); border-radius: 7px; background: var(--imprint-surface); padding: 4px 8px; color: var(--imprint-text); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: 0 4px 12px rgba(0,0,0,.16); }
    .hover-probe.near-start output { transform: none; }
    .hover-probe.near-end output { transform: translateX(-100%); }
    .drag-readout {
      position: absolute; z-index: 7; inset-block-end: 10px; inset-inline-start: 50%; transform: translateX(-50%);
      padding: 6px 9px; border-radius: 7px; background: var(--imprint-text); color: var(--imprint-surface);
      font-size: 12px; font-variant-numeric: tabular-nums; pointer-events: none;
    }
    .ruler { position: relative; grid-column: 3; min-height: 38px; color: var(--imprint-muted); font-size: 11px; cursor: text; touch-action: none; }
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
    @media (max-width: 620px) {
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
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `,
  ];

  disconnectedCallback(): void {
    this.stopDrag();
    super.disconnectedCallback();
  }

  render(): TemplateResult {
    const timings = this.transientTimings || this.timings;
    if (!timings.length)
      return html`<div class="empty">No timing values are available for this signal.</div>`;
    const currentTotal = timingTotal(timings);
    const sourceTotal = timingTotal(this.original);
    const total =
      this.view === "compare"
        ? Math.max(currentTotal, sourceTotal)
        : currentTotal;
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const showBefore = window.start <= Number.EPSILON;
    const showAfter = window.end >= window.total - Number.EPSILON;
    const boundaryClasses = `${showBefore ? "has-before" : ""} ${showAfter ? "has-after" : ""}`;
    return html`<div class="stack" @keydown=${this.onShortcut}>
      <div class="canvas ${this.zoom > 1 ? "pannable" : ""} ${this.view === "compare" ? "compare" : ""}"
        tabindex="0" aria-label="Editable timing waveform. Use the mouse wheel to zoom and drag to pan."
        @wheel=${this.onWheel} @pointerdown=${this.onPointerDown}>
        ${
          this.view === "compare"
            ? html`${this.renderTrack(this.original, total, "Protected source", "source", false)}${this.renderTrack(timings, total, "Experiment", "draft", true)}`
            : this.renderTrack(timings, total, "", "draft", true)
        }
        ${this.dragLabel ? html`<output class="drag-readout" aria-live="polite">${this.dragLabel}</output>` : nothing}
      </div>
      <div class="ruler-layout boundary-layout ${boundaryClasses}"><div class="ruler" aria-label="Timing ruler. Drag to select a range." @pointerdown=${this.onRulerDown}>
        ${this.axisTicks(window.start, window.end).map((time, index, ticks) => {
          const position = ((time - window.start) / window.span) * 100;
          return html`<span class="ruler-tick ${index === 0 ? "first" : ""} ${index === ticks.length - 1 ? "last" : ""}" style=${`inset-inline-start:${position}%`}>${this.axisLabel(time)}</span>`;
        })}
      </div></div>
      ${this.zoom > 1 ? this.renderMinimap(timings, total) : nothing}
    </div>`;
  }

  private renderTrack(
    timings: number[],
    total: number,
    label: string,
    kind: "source" | "draft",
    interactive: boolean,
  ): TemplateResult {
    const geometry = waveGeometry(timings, this.zoom, this.pan, total);
    const high = this.view === "compare" ? 24 : 30;
    const low = this.view === "compare" ? 92 : 136;
    const height = this.view === "compare" ? 112 : 162;
    let path = "";
    const [selectionStart, selectionEnd] = [
      Math.min(this.selectionStart, this.selectionEnd),
      Math.max(this.selectionStart, this.selectionEnd),
    ];
    const detailed = geometry.detailed;
    if (detailed && timings.length) {
      const firstX =
        (geometry.offsets[geometry.first] / geometry.view.total) * 1000;
      path =
        geometry.first === 0
          ? `M 0 ${low} V ${high}`
          : `M ${firstX.toFixed(3)} ${geometry.first % 2 ? low : high}`;
      for (let index = geometry.first; index < geometry.last; index++) {
        const nextX =
          (geometry.offsets[index + 1] / geometry.view.total) * 1000;
        path += ` H ${nextX.toFixed(3)}`;
        if (index < timings.length - 1 && index < geometry.last - 1)
          path += ` V ${index % 2 ? high : low}`;
      }
    }
    const viewStart = (geometry.view.start / geometry.view.total) * 1000;
    const viewWidth = (geometry.view.span / geometry.view.total) * 1000;
    const segments = detailed
      ? Array.from(
          { length: geometry.last - geometry.first },
          (_unused, offset) => geometry.first + offset,
        )
      : [];
    const density = detailed
      ? []
      : this.densityBuckets(
          timings,
          geometry.first,
          geometry.last,
          geometry.offsets,
          total,
          low - high,
        );
    const frames = interactive && this.showFrames ? frameRanges(timings) : [];
    const visibleFrames = frames
      .map((frame, index) => ({
        ...frame,
        index,
        startTime: geometry.offsets[frame.start] || 0,
        endTime: geometry.offsets[frame.end] ?? geometry.signalTotal,
      }))
      .filter(
        (frame) =>
          frame.endTime >= geometry.view.start &&
          frame.startTime <= geometry.view.end,
      )
      .slice(0, 80);
    const showBefore = geometry.view.start <= Number.EPSILON;
    const showAfter = geometry.view.end >= geometry.view.total - Number.EPSILON;
    const boundaryClasses = `${showBefore ? "has-before" : ""} ${showAfter ? "has-after" : ""}`;
    const idlePercent = (low / height) * 100;
    const markPercent = (high / height) * 100;
    const ticks = this.axisTicks(geometry.view.start, geometry.view.end);
    const hoverPercent = this.hovered
      ? clamp(
          ((this.hovered.time - geometry.view.start) / geometry.view.span) *
            100,
          0,
          100,
        )
      : 0;
    if (path && geometry.last >= timings.length && timings.length % 2)
      path += ` V ${low}`;
    return html`<div class="track ${kind} boundary-layout ${boundaryClasses}">
      <div class="y-axis" style=${`--mark-y:${markPercent}%;--space-y:${idlePercent}%`} aria-hidden="true"><span class="mark">Mark</span><span class="space">Space</span></div>
      ${showBefore ? this.renderBoundaryGutter("before", idlePercent) : nothing}
      <div class="plot">
      ${label ? html`<span class="track-label">${label}</span>` : nothing}
      <svg viewBox="${viewStart} 0 ${viewWidth} ${height}" preserveAspectRatio="none" data-track=${kind} data-total=${total}
        data-view-start=${geometry.view.start} data-view-span=${geometry.view.span} data-zoom=${geometry.view.zoom}
        aria-label=${label || "Editable experiment waveform"}
        @pointermove=${interactive ? (event: PointerEvent) => this.onHover(event, timings, total) : nothing}
        @pointerleave=${interactive ? this.clearHover : nothing}>
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
          return svg`<rect class="segment ${selected ? "selected" : ""}" data-segment=${interactive ? index : nothing}
            x=${x} y="8" width=${Math.max(1, width)} height=${height - 16} tabindex=${interactive ? "0" : nothing} role=${interactive ? "button" : nothing}
            aria-label=${interactive ? `${index % 2 ? "Space" : "Mark"} ${index + 1}, ${timings[index]} microseconds` : nothing}></rect>`;
        })}
        ${path ? svg`<path class="wave" d=${path} vector-effect="non-scaling-stroke"></path>` : nothing}
        ${
          interactive && detailed
            ? segments
                .filter((index) => index < timings.length - 1)
                .map((index) => {
                  const x = (geometry.offsets[index + 1] / total) * 1000;
                  return svg`<line class="edge" data-edge=${index} x1=${x} x2=${x} y1="8" y2=${height - 8}
            tabindex="0" role="slider" aria-label=${`Adjust ${index % 2 ? "space" : "mark"} ${index + 1}`}
            aria-valuemin="1" aria-valuemax="65535" aria-valuenow=${timings[index]}></line>`;
                })
            : nothing
        }
        ${
          interactive && this.showCursors
            ? this.cursors.map((time, index) => {
                const x = clamp((time / Math.max(total, 1)) * 1000, 0, 1000);
                return svg`<g class="cursor ${index ? "cursor-b" : "cursor-a"} ${this.activeCursor === index ? "active" : ""}" data-cursor=${index}
            tabindex="0" role="slider" aria-label=${`Cursor ${index ? "B" : "A"}`} aria-valuemin="0" aria-valuemax=${total} aria-valuenow=${Math.round(time)}>
            <line class="cursor-hit" x1=${x} x2=${x} y1="4" y2=${height - 4}></line>
            <line class="cursor-line" x1=${x} x2=${x} y1="4" y2=${height - 4} vector-effect="non-scaling-stroke"></line>
          </g>`;
              })
            : nothing
        }
        ${showBefore ? svg`<line class="signal-edge signal-start" data-signal-edge="start" x1="0" x2="0" y1=${low} y2=${high} vector-effect="non-scaling-stroke"></line>` : nothing}
        ${showAfter && timings.length % 2 ? svg`<line class="signal-edge signal-end" data-signal-edge="end" x1=${(geometry.signalTotal / total) * 1000} x2=${(geometry.signalTotal / total) * 1000} y1=${high} y2=${low} vector-effect="non-scaling-stroke"></line>` : nothing}
        ${
          interactive && this.showCursors
            ? this.cursors.map((time, index) => {
                const x = clamp((time / Math.max(total, 1)) * 1000, 0, 1000);
                return svg`<circle class="cursor-handle ${index ? "cursor-b" : "cursor-a"} ${this.activeCursor === index ? "active" : ""}"
            cx=${x} cy=${height - 9} r="5"></circle>`;
              })
            : nothing
        }
      </svg>
      ${interactive && this.hovered && this.hovered.index < timings.length ? html`<div class="hover-probe ${hoverPercent < 12 ? "near-start" : ""} ${hoverPercent > 88 ? "near-end" : ""}" style=${`inset-inline-start:${hoverPercent}%`} data-hover-probe><output>${formatDuration(timings[this.hovered.index])} · ${this.hovered.index % 2 ? "space" : "mark"}</output></div>` : nothing}
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
              const role = this.frameRole(frame.index, frames.length);
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
      ${showAfter ? this.renderBoundaryGutter("after", idlePercent) : nothing}
    </div>`;
  }

  private renderBoundaryGutter(
    position: "before" | "after",
    idlePercent: number,
  ): TemplateResult {
    const label = position === "before" ? "Before signal" : "After signal";
    return html`<div class="boundary-gutter ${position}" data-signal-gutter=${position}
      style=${`--idle-y:${idlePercent}%`} role="note"
      aria-label=${`${label}, display only; not part of captured timing`}
      title=${`${label} · display only · not part of captured timing`}>
      <span class="boundary-label">${label}</span>
    </div>`;
  }

  private renderMinimap(timings: number[], total: number): TemplateResult {
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const offsets = timingTotal(timings)
      ? this.minimapPath(timings, total)
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

  private axisTicks(start: number, end: number): number[] {
    const span = Math.max(1, end - start);
    const rough = span / 8;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const step =
      (normalized <= 1
        ? 1
        : normalized <= 2
          ? 2
          : normalized <= 2.5
            ? 2.5
            : normalized <= 5
              ? 5
              : 10) * magnitude;
    const ticks = [start];
    for (let time = Math.ceil(start / step) * step; time < end; time += step) {
      if (time - start > step * 0.4 && end - time > step * 0.4)
        ticks.push(time);
    }
    ticks.push(end);
    return ticks;
  }

  private axisLabel(time: number): string {
    if (time >= 1000) {
      const milliseconds = time / 1000;
      return `${milliseconds >= 10 ? milliseconds.toFixed(1).replace(/\.0$/, "") : milliseconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} ms`;
    }
    return `${Math.round(time)} µs`;
  }

  private onHover(event: PointerEvent, timings: number[], total: number): void {
    if (this.cleanupDrag || event.pointerType === "touch") return;
    const svg = event.currentTarget as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const window = viewWindow(timings, this.zoom, this.pan, total);
    const ratio = clamp(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      0,
      1,
    );
    const time = window.start + ratio * window.span;
    this.hovered = { time, index: timingAtTime(timings, time) };
  }

  private clearHover = (): void => {
    this.hovered = null;
  };

  private densityBuckets(
    timings: number[],
    start: number,
    end: number,
    offsets: number[],
    total: number,
    range: number,
  ) {
    const bucketSize = Math.max(1, Math.ceil((end - start) / 500));
    const result: Array<{ x: number; width: number; height: number }> = [];
    for (let index = start; index < end; index += bucketSize) {
      const stop = Math.min(end, index + bucketSize);
      let marks = 0;
      let duration = 0;
      for (let cursor = index; cursor < stop; cursor++) {
        duration += timings[cursor];
        if (cursor % 2 === 0) marks += timings[cursor];
      }
      result.push({
        x: (offsets[index] / total) * 1000,
        width: Math.max(1, ((offsets[stop] - offsets[index]) / total) * 1000),
        height: Math.max(8, duration ? (marks / duration) * range : 8),
      });
    }
    return result;
  }

  private minimapPath(timings: number[], total: number): string {
    if (timings.length > 800) {
      const geometry = waveGeometry(timings, 1, 0, total, 400);
      return this.densityBuckets(
        timings,
        0,
        timings.length,
        geometry.offsets,
        total,
        32,
      )
        .map(
          (bucket, index) =>
            `${index ? "L" : "M"} ${bucket.x + bucket.width} ${42 - bucket.height}`,
        )
        .join(" ");
    }
    let elapsed = 0;
    let path = "M 0 42 V 10";
    timings.forEach((duration, index) => {
      elapsed += duration;
      path += ` H ${((elapsed / total) * 1000).toFixed(3)}`;
      if (index < timings.length - 1) path += ` V ${index % 2 ? 10 : 42}`;
    });
    if (timings.length % 2) path += " V 42";
    return path;
  }

  private frameRole(index: number, frameCount: number): string {
    const manual = this.frameRoles[index];
    if (manual && manual !== "auto") return manual;
    const roles = Array.isArray(this.analysis.frame_roles)
      ? this.analysis.frame_roles
      : [];
    const frames = Array.isArray(this.analysis.frames)
      ? this.analysis.frames
      : [];
    if (roles.length !== frameCount && frames.length !== frameCount) return "";
    const role = roles.find(
      (item) => Number((item as { index?: unknown }).index) === index,
    ) as { role?: string } | undefined;
    if (role?.role && role.role !== "unclassified") return role.role;
    if (
      index > 0 &&
      (frames[index] as { group?: unknown })?.group ===
        (frames[0] as { group?: unknown })?.group
    )
      return "repeat";
    return index === 0 && frameCount > 1 ? "intro" : "";
  }

  private onShortcut(event: KeyboardEvent): void {
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement
    )
      return;
    const focused = event
      .composedPath()
      .find(
        (item) =>
          item instanceof SVGElement &&
          (item.hasAttribute("data-edge") ||
            item.hasAttribute("data-cursor") ||
            item.hasAttribute("data-segment")),
      ) as SVGElement | undefined;
    if (
      focused?.hasAttribute("data-edge") &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
      emit(this, "lab-shortcut", {
        action: "nudge",
        index: Number(focused.dataset.edge),
        amount: (this.snap || 1) * (event.shiftKey ? 10 : 1) * direction,
      });
      return;
    }
    if (
      focused?.hasAttribute("data-cursor") &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      event.preventDefault();
      const index = Number(focused.dataset.cursor) === 1 ? 1 : 0;
      const total = this.sharedTotal();
      const direction = ["ArrowRight", "ArrowUp"].includes(event.key) ? 1 : -1;
      const time =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? total
            : clamp(
                this.cursors[index] +
                  (this.snap || 1) * (event.shiftKey ? 10 : 1) * direction,
                0,
                total,
              );
      emit(this, "lab-cursor-change", { index, time });
      return;
    }
    if (
      focused?.hasAttribute("data-segment") &&
      ["Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      const index = Number(focused.dataset.segment);
      emit(this, "lab-selection", {
        selected: index,
        start: event.shiftKey ? this.selectionStart : index,
        end: index,
        revealTable: true,
      });
      return;
    }
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
    if (edge) {
      this.beginEdgeDrag(event, Number(edge.dataset.edge));
      return;
    }
    if (cursor) {
      this.beginCursorDrag(event, Number(cursor.dataset.cursor));
      return;
    }
    if (segment) {
      event.preventDefault();
      const index = Number(segment.dataset.segment);
      emit(this, "lab-selection", {
        selected: index,
        start: event.shiftKey ? this.selectionStart : index,
        end: index,
        revealTable: true,
      });
      return;
    }
    if (event.pointerType === "touch") {
      this.beginTouch(event);
      return;
    }
    if (this.zoom > 1) this.beginPan(event);
  }

  private beginPan(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startPan = this.pan;
    const rect = this.plotRect(event);
    const move = (moveEvent: PointerEvent) => {
      const next = clamp(
        startPan -
          (moveEvent.clientX - startX) /
            Math.max(1, rect.width) /
            (1 - 1 / this.zoom),
        0,
        1,
      );
      this.setNavigation(
        this.zoom,
        next,
        viewWindow(this.timings, this.zoom, next, this.sharedTotal()).start +
          viewWindow(this.timings, this.zoom, next, this.sharedTotal()).span /
            2,
      );
    };
    this.listenDrag(move);
  }

  private beginTouch(event: PointerEvent): void {
    event.preventDefault();
    this.touchPoints.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    const rect = this.plotRect(event);
    const points = [...this.touchPoints.values()];
    const distance =
      points.length > 1
        ? Math.max(
            1,
            Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y),
          )
        : 1;
    const midpoint =
      points.length > 1 ? (points[0].x + points[1].x) / 2 : points[0].x;
    const ratio = clamp((midpoint - rect.left) / Math.max(1, rect.width), 0, 1);
    const current = viewWindow(
      this.timings,
      this.zoom,
      this.pan,
      this.sharedTotal(),
    );
    this.touchBaseline = {
      points: new Map(this.touchPoints),
      zoom: this.zoom,
      pan: this.pan,
      distance,
      anchorTime: current.start + ratio * current.span,
      anchorRatio: ratio,
      rect,
      total: this.sharedTotal(),
    };
    if (this.cleanupDrag) return;
    const move = (moveEvent: PointerEvent) => {
      if (!this.touchPoints.has(moveEvent.pointerId) || !this.touchBaseline)
        return;
      moveEvent.preventDefault();
      this.touchPoints.set(moveEvent.pointerId, {
        x: moveEvent.clientX,
        y: moveEvent.clientY,
      });
      const active = [...this.touchPoints.values()];
      const baseline = this.touchBaseline;
      if (active.length > 1) {
        const distanceNow = Math.max(
          1,
          Math.hypot(active[1].x - active[0].x, active[1].y - active[0].y),
        );
        const midpointNow = (active[0].x + active[1].x) / 2;
        const ratioNow = clamp(
          (midpointNow - baseline.rect.left) / Math.max(1, baseline.rect.width),
          0,
          1,
        );
        const nextZoom = clamp(
          (baseline.zoom * distanceNow) / baseline.distance,
          1,
          16,
        );
        const span = baseline.total / nextZoom;
        const maxStart = Math.max(0, baseline.total - span);
        const start = clamp(baseline.anchorTime - ratioNow * span, 0, maxStart);
        this.setNavigation(
          nextZoom,
          maxStart ? start / maxStart : 0,
          baseline.anchorTime,
        );
      } else if (active.length === 1 && baseline.zoom > 1) {
        const first = [...baseline.points.values()][0];
        const delta =
          (active[0].x - first.x) / Math.max(1, baseline.rect.width);
        this.setNavigation(
          baseline.zoom,
          clamp(baseline.pan - delta / (1 - 1 / baseline.zoom), 0, 1),
          baseline.anchorTime,
        );
      }
    };
    const end = (endEvent: PointerEvent) => {
      this.touchPoints.delete(endEvent.pointerId);
      if (this.touchPoints.size) {
        const current = viewWindow(
          this.timings,
          this.zoom,
          this.pan,
          this.sharedTotal(),
        );
        const gestureRect = this.touchBaseline?.rect || rect;
        this.touchBaseline = {
          points: new Map(this.touchPoints),
          zoom: this.zoom,
          pan: this.pan,
          distance: 1,
          anchorTime: current.start + current.span / 2,
          anchorRatio: 0.5,
          rect: gestureRect,
          total: this.sharedTotal(),
        };
        return;
      }
      this.touchBaseline = null;
      this.stopDrag();
    };
    this.listenDrag(move, end);
  }

  private beginEdgeDrag(event: PointerEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    const baseline = [...this.timings];
    const startX = event.clientX;
    const svg = event
      .composedPath()
      .find((item) => item instanceof SVGSVGElement) as
      | SVGSVGElement
      | undefined;
    const rect =
      svg?.getBoundingClientRect() ||
      (event.currentTarget as HTMLElement).getBoundingClientRect();
    const visible = this.sharedTotal() / Math.max(1, this.zoom);
    let latest = baseline;
    const move = (moveEvent: PointerEvent) => {
      const delta =
        ((moveEvent.clientX - startX) / Math.max(1, rect.width)) * visible;
      const next = editBoundary(
        baseline,
        index,
        baseline[index] + delta,
        this.snap || 1,
        this.boundaryMode === "preserve",
      );
      if (!next) return;
      latest = next;
      this.transientTimings = next;
      this.dragLabel = `${index % 2 ? "Space" : "Mark"} ${formatDuration(next[index])} · ${next[index] - baseline[index] >= 0 ? "+" : ""}${next[index] - baseline[index]} µs`;
      emit(this, "lab-edge-change", {
        index,
        timings: next,
        baseline,
        phase: "preview",
      });
    };
    const end = () => {
      this.stopDrag();
      this.transientTimings = null;
      this.dragLabel = "";
      emit(this, "lab-edge-change", {
        index,
        timings: latest,
        baseline,
        phase: "commit",
      });
    };
    const cancel = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      this.stopDrag();
      this.transientTimings = null;
      this.dragLabel = "";
      emit(this, "lab-edge-change", {
        index,
        timings: baseline,
        baseline,
        phase: "cancel",
      });
    };
    this.listenDrag(move, end, cancel);
  }

  private beginCursorDrag(event: PointerEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    const svg = event
      .composedPath()
      .find((item) => item instanceof SVGSVGElement) as
      | SVGSVGElement
      | undefined;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const window = viewWindow(
      this.timings,
      this.zoom,
      this.pan,
      this.sharedTotal(),
    );
    const move = (moveEvent: PointerEvent) => {
      const ratio = clamp(
        (moveEvent.clientX - rect.left) / Math.max(1, rect.width),
        0,
        1,
      );
      emit(this, "lab-cursor-change", {
        index,
        time: Math.round(window.start + ratio * window.span),
      });
    };
    move(event);
    this.listenDrag(move);
  }

  private onRulerDown(event: PointerEvent): void {
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const window = viewWindow(
      this.timings,
      this.zoom,
      this.pan,
      this.sharedTotal(),
    );
    const indexAt = (clientX: number) =>
      timingAtTime(
        this.timings,
        window.start +
          clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) *
            window.span,
      );
    const start = indexAt(event.clientX);
    emit(this, "lab-selection", {
      selected: start,
      start,
      end: start,
      revealTable: true,
    });
    const move = (moveEvent: PointerEvent) =>
      emit(this, "lab-selection", {
        selected: start,
        start,
        end: indexAt(moveEvent.clientX),
        revealTable: false,
      });
    this.listenDrag(move);
  }

  private onMinimapDown(event: PointerEvent): void {
    if (this.zoom <= 1) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const span = 1 / this.zoom;
    const currentStart = this.pan * (1 - span);
    const initialRatio = clamp(
      (event.clientX - rect.left) / Math.max(1, rect.width),
      0,
      1,
    );
    const grab =
      initialRatio >= currentStart && initialRatio <= currentStart + span
        ? initialRatio - currentStart
        : span / 2;
    const move = (moveEvent: PointerEvent) => {
      const ratio = clamp(
        (moveEvent.clientX - rect.left) / Math.max(1, rect.width),
        0,
        1,
      );
      const start = clamp(ratio - grab, 0, 1 - span);
      const pan = start / Math.max(Number.EPSILON, 1 - span);
      const window = viewWindow(
        this.timings,
        this.zoom,
        pan,
        this.sharedTotal(),
      );
      this.setNavigation(this.zoom, pan, window.start + window.span / 2);
    };
    move(event);
    this.listenDrag(move);
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

  private listenDrag(
    move: (event: PointerEvent) => void,
    end?: (event: PointerEvent) => void,
    keydown?: (event: KeyboardEvent) => void,
  ): void {
    this.stopDrag();
    const finish = (event: PointerEvent) => {
      if (end) end(event);
      else this.stopDrag();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    if (keydown) document.addEventListener("keydown", keydown);
    this.cleanupDrag = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (keydown) document.removeEventListener("keydown", keydown);
      this.cleanupDrag = null;
    };
  }

  private stopDrag(): void {
    this.cleanupDrag?.();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-signal-waveform": ImprintSignalWaveform;
  }
}
