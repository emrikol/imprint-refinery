import { LitElement, css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { clamp, selectionRange } from "../../core/signal-lab";
import { emit, formatDuration } from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { tokens } from "../../styles";

@safeCustomElement("imprint-signal-timing-editor")
export class ImprintSignalTimingEditor extends LitElement {
  @property({ attribute: false }) timings: number[] = [];
  @property({ attribute: false }) original: number[] = [];
  @property({ type: Number }) selected = 0;
  @property({ type: Number }) selectionStart = 0;
  @property({ type: Number }) selectionEnd = 0;
  @property({ type: Number }) snap = 10;

  static styles = [
    tokens,
    css`
    :host { display: block; min-width: 0; }
    .columns, .row {
      display: grid; grid-template-columns: 48px minmax(100px,.75fr) minmax(150px,1.2fr) 44px;
      align-items: center; gap: 8px;
    }
    .columns { padding: 0 10px 6px; color: var(--imprint-muted); font-size: 11px; font-weight: 750; }
    .rows { display: grid; gap: 4px; max-height: 420px; overflow: auto; scrollbar-color: var(--imprint-line) transparent; }
    .row {
      min-height: 48px; width: 100%; border: 1px solid transparent; border-radius: 9px; background: transparent;
      padding: 5px 9px; text-align: start;
    }
    .row:hover { background: var(--imprint-surface-2); }
    .row.selected { border-color: var(--imprint-accent); background: var(--imprint-accent-soft); }
    .index { color: var(--imprint-muted); font-variant-numeric: tabular-nums; }
    .kind { display: inline-flex; align-items: center; gap: 9px; text-transform: capitalize; }
    .kind::before { content: ""; inline-size: 12px; block-size: 12px; border-radius: 50%; background: var(--imprint-accent); }
    .kind.space::before { background: var(--imprint-muted); }
    .current { display: flex; align-items: center; gap: 5px; }
    input { width: 100%; min-width: 0; min-height: 38px; border: 1px solid var(--imprint-line); border-radius: 7px; background: var(--imprint-surface); padding: 6px 8px; text-align: end; font-variant-numeric: tabular-nums; }
    .more { border: 0; background: transparent; min-width: 44px; min-height: 44px; padding: 0; border-radius: 8px; }
    .more:hover { background: var(--imprint-surface-2); }
    .window { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-block: 8px; color: var(--imprint-muted); font-size: 12px; }
    .mobile { display: none; }
    .mobile-value { display: grid; grid-template-columns: 44px minmax(0,1fr) 44px; gap: 7px; align-items: center; }
    .nudges { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; margin-block-start: 8px; }
    @media (max-width: 620px) {
      .columns, .rows, .window { display: none; }
      .mobile { display: grid; gap: 9px; }
      .mobile output { color: var(--imprint-muted); font-size: 13px; }
      .mobile input { min-height: 46px; font-size: 16px; }
    }
  `,
  ];

  render() {
    if (!this.timings.length)
      return html`<div class="empty">A signal needs at least one timing value.</div>`;
    const window = this.timingWindow();
    const [start, end] = selectionRange(
      this.timings.length,
      this.selectionStart,
      this.selectionEnd,
    );
    const safeSelected = clamp(this.selected, 0, this.timings.length - 1);
    return html`
      <div class="columns" aria-hidden="true"><span>#</span><span>Type</span><span>Duration (µs)</span><span></span></div>
      ${window.limited ? html`<div class="window" role="status"><button class="btn" ?disabled=${!window.start} @click=${() => this.select(Math.max(0, window.start - 1), false)}><ha-icon icon="mdi:chevron-up"></ha-icon>Earlier</button><span>Showing ${window.start + 1}–${window.end} of ${window.count}</span><button class="btn" ?disabled=${window.end >= window.count} @click=${() => this.select(Math.min(window.count - 1, window.end), false)}>Later<ha-icon icon="mdi:chevron-down"></ha-icon></button></div>` : nothing}
      <div class="rows" role="list" aria-label="Signal timing values">
        ${this.timings.slice(window.start, window.end).map((value, offset) => {
          const index = window.start + offset;
          const original = this.original[index];
          const delta = original == null ? null : value - original;
          return html`<div class="row ${index >= start && index <= end ? "selected" : ""}" role="listitem"
            @click=${(event: MouseEvent) => {
              if (!(event.composedPath()[0] instanceof HTMLInputElement))
                this.select(index, event.shiftKey);
            }}>
            <span class="index">${index + 1}</span><strong class="kind ${index % 2 ? "space" : "mark"}">${index % 2 ? "Space" : "Mark"}</strong>
            <label class="current"><span class="sr-only">${index % 2 ? "Space" : "Mark"} ${index + 1} in microseconds</span><input type="number" min="1" max="65535" step=${this.snap || 1} .value=${String(value)}
              @focus=${() => this.select(index, false)} @change=${(event: Event) => this.change(index, Number((event.target as HTMLInputElement).value))}
              @keydown=${(event: KeyboardEvent) => this.inputKey(event, index)}><small>µs</small></label>
            <button class="more" aria-label=${`Select timing ${index + 1}; original ${original ?? "not present"}${delta == null ? "" : `; delta ${delta >= 0 ? "+" : ""}${delta} microseconds`}`} title=${original == null ? "New timing" : `Original ${original} µs · Δ ${delta && delta > 0 ? "+" : ""}${delta || 0} µs`} @click=${() => this.select(index, false)}><ha-icon icon="mdi:dots-vertical"></ha-icon></button>
          </div>`;
        })}
      </div>
      <div class="mobile" aria-label="Selected timing editor">
        <output>${safeSelected + 1} · ${safeSelected % 2 ? "Space" : "Mark"} · source ${this.original[safeSelected] ?? "not present"}</output>
        <div class="mobile-value"><button class="btn icon" title="Previous timing" aria-label="Previous timing" ?disabled=${safeSelected <= 0} @click=${() => this.select(safeSelected - 1, false)}><ha-icon icon="mdi:chevron-left"></ha-icon></button><label class="field">Duration in microseconds<input type="number" min="1" max="65535" step=${this.snap || 1} .value=${String(this.timings[safeSelected])} @change=${(event: Event) => this.change(safeSelected, Number((event.target as HTMLInputElement).value))} @keydown=${(event: KeyboardEvent) => this.inputKey(event, safeSelected)}></label><button class="btn icon" title="Next timing" aria-label="Next timing" ?disabled=${safeSelected >= this.timings.length - 1} @click=${() => this.select(safeSelected + 1, false)}><ha-icon icon="mdi:chevron-right"></ha-icon></button></div>
        <div class="nudges"><button class="btn" @click=${() => this.nudge(safeSelected, -10)}>−10</button><button class="btn" @click=${() => this.nudge(safeSelected, -1)}>−1</button><button class="btn" @click=${() => this.nudge(safeSelected, 1)}>+1</button><button class="btn" @click=${() => this.nudge(safeSelected, 10)}>+10</button></div>
        <output>${formatDuration(this.timings[safeSelected])}</output>
      </div>`;
  }

  private timingWindow(limit = 240) {
    const count = this.timings.length;
    if (count <= limit) return { start: 0, end: count, count, limited: false };
    const start = clamp(
      this.selected - Math.floor(limit / 2),
      0,
      count - limit,
    );
    return { start, end: start + limit, count, limited: true };
  }

  private select(index: number, extend: boolean): void {
    const selected = clamp(index, 0, this.timings.length - 1);
    emit(this, "lab-selection", {
      selected,
      start: extend ? this.selectionStart : selected,
      end: selected,
      revealWaveform: true,
    });
  }

  private change(index: number, value: number): void {
    emit(this, "lab-timing-change", { index, value: Math.round(value) });
  }

  private nudge(index: number, amount: number): void {
    emit(this, "lab-nudge", { index, amount });
  }

  private inputKey(event: KeyboardEvent, index: number): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      (event.target as HTMLInputElement).value = String(this.timings[index]);
      (event.target as HTMLInputElement).blur();
      return;
    }
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    this.nudge(index, (this.snap || 1) * (event.shiftKey ? 10 : 1) * direction);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-signal-timing-editor": ImprintSignalTimingEditor;
  }
}
