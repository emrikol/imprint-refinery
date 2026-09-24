import { css, html, type CSSResult, type TemplateResult } from "lit";
import {
  haControlChecked,
  haControlValue,
  haSelectedValue,
} from "../../core/ha-controls";
import {
  selectModeRange,
  type ClipboardFormat,
  type SelectionMode,
  type SignalLabState,
} from "../../core/signal-lab";
import { formatDuration } from "../../core/utils";
import type { SignalLabRequest } from "./events";
import {
  renderSignalFrameEditor,
  signalFrameEditorStyles,
} from "./frame-editor";
import type { SignalLabToolsController } from "./tools-controller";

export interface SignalAdvancedToolsProps {
  lab: SignalLabState;
  busy: boolean;
  selectionStart: number;
  selectionEnd: number;
  selectionLength: number;
  frameCount: number;
  selectedDuration: number;
  cursors: [number, number];
  editingOverlays: boolean;
  tools: SignalLabToolsController;
  request: SignalLabRequest;
}

export const signalAdvancedToolsStyles: CSSResult[] = [
  signalFrameEditorStyles,
  css`
    .signal-advanced-tools {
      display: block;
      min-width: 0;
      container: advanced-tools / inline-size;
    }
    .signal-advanced-tools > ha-expansion-panel {
      margin-block-start: 16px;
      border-block-start: 1px solid var(--imprint-line);
      padding-block-start: 12px;
    }
    .signal-advanced-tools .advanced-body { display: grid; gap: 14px; padding-block-start: 14px; }
    .signal-advanced-tools .advanced-section { display: grid; gap: 10px; }
    .signal-advanced-tools .advanced-section h3 { margin: 0; }
    .signal-advanced-tools .selection-settings {
      display: grid;
      grid-template-columns: repeat(4, minmax(130px, 1fr));
      gap: 8px;
    }
    .signal-advanced-tools .advanced-edit-actions { display: flex; flex-wrap: wrap; gap: 7px; }
    .signal-advanced-tools .advanced-section ha-input,
    .signal-advanced-tools .advanced-section ha-select { width: 100%; min-width: 0; }
    .signal-advanced-tools .advanced-edit-actions ha-button { min-height: 44px; }
    .signal-advanced-tools .advanced-choice { display: block; }
    .signal-advanced-tools .advanced-choice small {
      display: block;
      color: var(--imprint-muted);
      margin-block-start: 2px;
    }
    .signal-advanced-tools .transform { display: grid; gap: 9px; }
    .signal-advanced-tools .transform-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 7px;
      align-items: end;
    }
    .signal-advanced-tools .transform-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
    }
    @container advanced-tools (max-width: 720px) {
      .signal-advanced-tools .selection-settings { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @container advanced-tools (max-width: 460px) {
      .signal-advanced-tools .selection-settings,
      .signal-advanced-tools .transform-actions { grid-template-columns: 1fr; }
      .signal-advanced-tools .advanced-edit-actions {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @container advanced-tools (max-width: 320px) {
      .signal-advanced-tools .advanced-edit-actions { grid-template-columns: 1fr; }
    }
  `,
];

export function renderSignalAdvancedTools({
  lab,
  busy,
  selectionStart,
  selectionEnd,
  selectionLength,
  frameCount,
  selectedDuration,
  cursors,
  editingOverlays,
  tools,
  request,
}: SignalAdvancedToolsProps): TemplateResult {
  const [cursorA, cursorB] = cursors;
  const action = (labAction: string, detail: Record<string, unknown> = {}) =>
    request("lab-action", { labAction, detail });
  const selectMode = (event: Event) => {
    const mode = haSelectedValue(event) as SelectionMode;
    if (mode === "range") return;
    const [start, end] = selectModeRange(lab.timings, lab.selected, mode);
    action("select", {
      index: start,
      selectionStart: start,
      selectionEnd: end,
      mode,
    });
  };
  const preview = (
    kind: "scale" | "round" | "normalize" | "gap" | "align_frames",
    range: [number, number] = [selectionStart, selectionEnd],
  ) =>
    request("preview-transform", {
      kind,
      range,
      options: {
        scale: tools.scale,
        quantum: tools.quantum,
        gap: tools.gap,
      },
    });

  return html`<div class="signal-advanced-tools">
    <ha-expansion-panel header="Advanced timing tools">
      <div class="advanced-body">
        <section class="advanced-section">
          <h3>Edit selection</h3>
          <div class="selection-settings">
            <ha-select label="Snap" .value=${String(lab.snap)} .options=${[
              { value: "0", label: "Off" },
              { value: "1", label: "1 µs" },
              { value: "10", label: "10 µs" },
              { value: "50", label: "50 µs" },
              { value: "100", label: "100 µs" },
            ]} @selected=${(event: Event) => action("field", { field: "snap", value: Number(haSelectedValue(event)) })}></ha-select>
            <ha-select label="Edge drag" .value=${lab.boundaryMode} .options=${[
              { value: "shift", label: "Change duration" },
              { value: "preserve", label: "Preserve frame length" },
            ]} @selected=${(event: Event) => action("field", { field: "boundaryMode", value: haSelectedValue(event) })}></ha-select>
            <ha-select label="Select" value="range" .options=${[
              { value: "range", label: "Current range" },
              { value: "duration", label: "Duration" },
              { value: "pair", label: "Mark/space pair" },
              { value: "frame", label: "Complete frame" },
              { value: "all", label: "Entire signal" },
            ]} @selected=${selectMode}></ha-select>
            <ha-select label="Copy as" .value=${tools.copyFormat} .options=${[
              { value: "signed", label: "Signed timings" },
              { value: "unsigned", label: "Alternating integers" },
              { value: "json", label: "JSON" },
              { value: "pronto", label: "Pronto Hex" },
            ]} @selected=${(event: Event) => tools.setCopyFormat(haSelectedValue(event) as ClipboardFormat)}></ha-select>
          </div>
          <div class="advanced-edit-actions">
            <ha-button appearance="outlined" variant="neutral" .disabled=${!lab.undo.length || busy} @click=${() => action("undo")}><ha-icon slot="start" icon="mdi:undo"></ha-icon>Undo</ha-button>
            <ha-button appearance="outlined" variant="neutral" .disabled=${!lab.redo.length || busy} @click=${() => action("redo")}><ha-icon slot="start" icon="mdi:redo"></ha-icon>Redo</ha-button>
            <ha-button appearance="outlined" variant="neutral" @click=${() => request("copy-selection", { cut: false, format: tools.copyFormat })}><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy</ha-button>
            <ha-button appearance="outlined" variant="neutral" .disabled=${selectionLength >= lab.timings.length} @click=${() => request("copy-selection", { cut: true, format: tools.copyFormat })}><ha-icon slot="start" icon="mdi:content-cut"></ha-icon>Cut</ha-button>
            <ha-button appearance="outlined" variant="neutral" @click=${() => request("paste-selection")}><ha-icon slot="start" icon="mdi:content-paste"></ha-icon>Paste</ha-button>
            <ha-button appearance="outlined" variant="neutral" @click=${() => action("duplicate-selection", { start: selectionStart, end: selectionEnd })}><ha-icon slot="start" icon="mdi:content-duplicate"></ha-icon>Duplicate</ha-button>
            <ha-button appearance="outlined" variant="neutral" .disabled=${lab.selected + 2 >= lab.timings.length} @click=${() => action("merge", { index: lab.selected })}><ha-icon slot="start" icon="mdi:merge"></ha-icon>Merge across</ha-button>
            <ha-button appearance="outlined" variant="neutral" @click=${() => action("reset-selection", { start: selectionStart, end: selectionEnd })}><ha-icon slot="start" icon="mdi:restore"></ha-icon>Reset selection</ha-button>
            <ha-button appearance="plain" variant="danger" .disabled=${selectionLength >= lab.timings.length} @click=${() => action("delete-selection", { start: selectionStart, end: selectionEnd })}><ha-icon slot="start" icon="mdi:delete-outline"></ha-icon>Delete</ha-button>
          </div>
          <ha-checkbox class="advanced-choice" .checked=${editingOverlays} @change=${(event: Event) => request("editing-overlays", { value: haControlChecked(event) })}><span><strong>Show editing overlays</strong><small>Reveal frame regions and measurement cursors on the waveform.</small></span></ha-checkbox>
          <div class="muted">${lab.selected + 1} · ${lab.selected % 2 ? "Space" : "Mark"} ${formatDuration(selectedDuration)} · A ${formatDuration(cursorA)} · B ${formatDuration(cursorB)} · Δ ${formatDuration(Math.abs(cursorB - cursorA))}</div>
        </section>
        ${renderSignalFrameEditor({
          timings: lab.timings,
          frameRoles: lab.frameRoles,
          selectedFrame: lab.selectedFrame,
          selectedTiming: lab.selected,
          request,
        })}
        <section class="advanced-section transform">
          <h3>Transform previews</h3>
          <div class="transform-row"><ha-input label="Scale percent" type="number" .min=${1} .max=${1000} .value=${String(tools.scale)} @input=${(event: Event) => tools.setScale(Number(haControlValue(event)))}></ha-input><ha-button appearance="outlined" variant="neutral" @click=${() => preview("scale")}>Preview</ha-button></div>
          <div class="transform-row"><ha-select label="Round to" .value=${String(tools.quantum)} .options=${[
            { value: "10", label: "10 µs" },
            { value: "50", label: "50 µs" },
            { value: "100", label: "100 µs" },
          ]} @selected=${(event: Event) => tools.setQuantum(Number(haSelectedValue(event)))}></ha-select><ha-button appearance="outlined" variant="neutral" @click=${() => preview("round")}>Preview</ha-button></div>
          <div class="transform-row"><ha-input label="Interframe gap" type="number" .min=${1} .max=${65535} .value=${String(tools.gap)} @input=${(event: Event) => tools.setGap(Number(haControlValue(event)))}></ha-input><ha-button appearance="outlined" variant="neutral" @click=${() => preview("gap")}>Preview</ha-button></div>
          <div class="transform-actions"><ha-button appearance="outlined" variant="neutral" @click=${() => preview("normalize")}><ha-icon slot="start" icon="mdi:square-wave"></ha-icon>Smooth selection</ha-button><ha-button appearance="outlined" variant="neutral" .disabled=${frameCount < 2} @click=${() => preview("align_frames", [0, lab.timings.length - 1])}><ha-icon slot="start" icon="mdi:format-align-middle"></ha-icon>Align repeated frames</ha-button></div>
        </section>
      </div>
    </ha-expansion-panel>
  </div>`;
}
