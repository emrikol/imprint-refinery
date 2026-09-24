import { css, html, nothing, type TemplateResult } from "lit";
import { haControlValue } from "../../core/ha-controls";
import { clamp, selectionRange } from "../../core/signal-lab";
import { formatDuration } from "../../core/utils";
import type { SignalLabRequest } from "./events";
import { renderTimingNudgeButtons } from "./timing-nudge-controls";

export interface SignalTimingEditorProps {
  timings: number[];
  original: number[];
  selected: number;
  selectionStart: number;
  selectionEnd: number;
  snap: number;
  request: SignalLabRequest;
}

export const signalTimingEditorStyles = css`
  .timing-editor {
    display: block;
    min-width: 0;
    container: timing-editor / inline-size;
  }
  .timing-editor .empty {
    min-height: 140px;
    display: grid;
    place-items: center;
    padding: 24px;
    color: var(--imprint-muted);
    text-align: center;
  }
  .timing-editor .timing-columns,
  .timing-editor .timing-row {
    display: grid;
    grid-template-columns: 48px minmax(100px, .75fr) minmax(150px, 1.2fr) 44px;
    align-items: center;
    gap: 8px;
  }
  .timing-editor .timing-columns {
    padding: 0 10px 6px;
    color: var(--imprint-muted);
    font-size: 11px;
    font-weight: 750;
  }
  .timing-editor .timing-rows {
    display: grid;
    gap: 4px;
    max-height: 420px;
    overflow: auto;
    scrollbar-color: var(--imprint-line) transparent;
  }
  .timing-editor .timing-row {
    min-height: 48px;
    width: 100%;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
    padding: 5px 9px;
    text-align: start;
  }
  .timing-editor .timing-row.selected {
    border-color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
  }
  .timing-editor .timing-index {
    color: var(--imprint-muted);
    font-variant-numeric: tabular-nums;
  }
  .timing-editor .timing-kind {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    text-transform: capitalize;
  }
  .timing-editor .timing-kind::before {
    content: "";
    inline-size: 12px;
    block-size: 12px;
    border-radius: 50%;
    background: var(--imprint-accent);
  }
  .timing-editor .timing-kind.space::before { background: var(--imprint-muted); }
  .timing-editor .timing-current { display: flex; align-items: center; gap: 5px; }
  .timing-editor .timing-current ha-input {
    width: 100%;
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }
  .timing-editor .timing-more { min-width: 44px; min-height: 44px; }
  .timing-editor .timing-window {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-block: 8px;
    color: var(--imprint-muted);
    font-size: 12px;
  }
  .timing-editor .timing-mobile { display: none; }
  .timing-editor .timing-mobile-value {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    gap: 7px;
    align-items: center;
  }
  .timing-editor .timing-nudges {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    margin-block-start: 8px;
  }
  .timing-editor .timing-nudges ha-button { width: 100%; }
  @container timing-editor (max-width: 620px) {
    .timing-editor .timing-columns,
    .timing-editor .timing-rows,
    .timing-editor .timing-window { display: none; }
    .timing-editor .timing-mobile { display: grid; gap: 9px; }
    .timing-editor .timing-mobile output {
      color: var(--imprint-muted);
      font-size: 13px;
    }
    .timing-editor .timing-mobile ha-input {
      min-height: 46px;
      font-size: 16px;
      min-width: 0;
    }
  }
`;

interface TimingWindow {
  start: number;
  end: number;
  count: number;
  limited: boolean;
}

function timingWindow(timings: number[], selected: number, limit = 240): TimingWindow {
  const count = timings.length;
  if (count <= limit) return { start: 0, end: count, count, limited: false };
  const start = clamp(selected - Math.floor(limit / 2), 0, count - limit);
  return { start, end: start + limit, count, limited: true };
}

export function renderSignalTimingEditor({
  timings,
  original,
  selected,
  selectionStart,
  selectionEnd,
  snap,
  request,
}: SignalTimingEditorProps): TemplateResult {
  if (!timings.length) {
    return html`<div class="timing-editor"><div class="empty">A signal needs at least one timing value.</div></div>`;
  }

  const window = timingWindow(timings, selected);
  const [start, end] = selectionRange(timings.length, selectionStart, selectionEnd);
  const safeSelected = clamp(selected, 0, timings.length - 1);
  const select = (index: number, extend: boolean) => {
    const next = clamp(index, 0, timings.length - 1);
    request("lab-action", {
      labAction: "select",
      detail: {
        index: next,
        selectionStart: extend ? selectionStart : next,
        selectionEnd: next,
        revealWaveform: true,
      },
    });
  };
  const change = (index: number, value: number) =>
    request("lab-action", {
      labAction: "timing",
      detail: { index, value: Math.round(value) },
    });
  const nudge = (index: number, amount: number) =>
    request("lab-action", { labAction: "nudge", detail: { index, amount } });
  const inputKey = (event: KeyboardEvent, index: number) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      const control = event.currentTarget as HTMLElement & { value: string };
      control.value = String(timings[index]);
      control.blur();
      return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    nudge(index, (snap || 1) * (event.shiftKey ? 10 : 1) * direction);
  };

  return html`<div class="timing-editor">
    <div class="timing-columns" aria-hidden="true"><span>#</span><span>Type</span><span>Duration (µs)</span><span></span></div>
    ${window.limited
      ? html`<div class="timing-window" role="status">
          <ha-button appearance="outlined" variant="neutral" .disabled=${!window.start} @click=${() => select(Math.max(0, window.start - 1), false)}><ha-icon slot="start" icon="mdi:chevron-up"></ha-icon>Earlier</ha-button>
          <span>Showing ${window.start + 1}–${window.end} of ${window.count}</span>
          <ha-button appearance="outlined" variant="neutral" .disabled=${window.end >= window.count} @click=${() => select(Math.min(window.count - 1, window.end), false)}>Later<ha-icon slot="end" icon="mdi:chevron-down"></ha-icon></ha-button>
        </div>`
      : nothing}
    <div class="timing-rows" role="list" aria-label="Signal timing values">
      ${timings.slice(window.start, window.end).map((value, offset) => {
        const index = window.start + offset;
        const sourceValue = original[index];
        const delta = sourceValue == null ? null : value - sourceValue;
        return html`<div
          class="timing-row ${index >= start && index <= end ? "selected" : ""}"
          role="listitem"
        >
          <span class="timing-index">${index + 1}</span>
          <strong class="timing-kind ${index % 2 ? "space" : "mark"}">${index % 2 ? "Space" : "Mark"}</strong>
          <label class="timing-current">
            <ha-input
              type="number"
              .min=${1}
              .max=${65535}
              .step=${snap || 1}
              .value=${String(value)}
              aria-label=${`${index % 2 ? "Space" : "Mark"} ${index + 1} in microseconds`}
              @focus=${() => select(index, false)}
              @change=${(event: Event) => change(index, Number(haControlValue(event)))}
              @keydown=${(event: KeyboardEvent) => inputKey(event, index)}
            ></ha-input>
            <small>µs</small>
          </label>
          <ha-icon-button
            class="timing-more"
            .label=${`Select timing ${index + 1}; original ${sourceValue ?? "not present"}${delta == null ? "" : `; delta ${delta >= 0 ? "+" : ""}${delta} microseconds`}`}
            title=${sourceValue == null ? "New timing" : `Original ${sourceValue} µs · Δ ${delta && delta > 0 ? "+" : ""}${delta || 0} µs`}
            @click=${() => select(index, false)}
          ><ha-icon icon="mdi:dots-vertical"></ha-icon></ha-icon-button>
        </div>`;
      })}
    </div>
    <div class="timing-mobile" aria-label="Selected timing editor">
      <output>${safeSelected + 1} · ${safeSelected % 2 ? "Space" : "Mark"} · source ${original[safeSelected] ?? "not present"}</output>
      <div class="timing-mobile-value">
        <ha-icon-button .label=${"Previous timing"} .disabled=${safeSelected <= 0} @click=${() => select(safeSelected - 1, false)}><ha-icon icon="mdi:chevron-left"></ha-icon></ha-icon-button>
        <ha-input label="Duration in microseconds" type="number" .min=${1} .max=${65535} .step=${snap || 1} .value=${String(timings[safeSelected])} @change=${(event: Event) => change(safeSelected, Number(haControlValue(event)))} @keydown=${(event: KeyboardEvent) => inputKey(event, safeSelected)}></ha-input>
        <ha-icon-button .label=${"Next timing"} .disabled=${safeSelected >= timings.length - 1} @click=${() => select(safeSelected + 1, false)}><ha-icon icon="mdi:chevron-right"></ha-icon></ha-icon-button>
      </div>
      <div class="timing-nudges">
        ${renderTimingNudgeButtons(safeSelected, nudge)}
      </div>
      <output>${formatDuration(timings[safeSelected])}</output>
    </div>
  </div>`;
}
