import { css, html, type TemplateResult } from "lit";
import { haSelectedValue } from "../../core/ha-controls";
import { frameRanges, timingTotal } from "../../core/signal";
import { clamp } from "../../core/signal-lab";
import { formatDuration } from "../../core/utils";
import type { SignalLabRequest } from "./events";

export interface SignalFrameEditorProps {
  timings: number[];
  frameRoles: string[];
  selectedFrame: number;
  selectedTiming: number;
  request: SignalLabRequest;
}

export const signalFrameEditorStyles = css`
  .frame-editor {
    display: grid;
    gap: 12px;
    padding: 14px;
    border-block: 1px solid var(--imprint-line);
    container: frame-editor / inline-size;
  }
  .frame-editor > header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: start;
  }
  .frame-editor h2 { margin-block-end: 3px; }
  .frame-editor p { margin: 0; color: var(--imprint-muted); }
  .frame-editor .frame-fields {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr);
    gap: 9px;
  }
  .frame-editor .frame-actions { align-items: stretch; }
  .frame-editor .frame-actions ha-button { min-height: 44px; }
  .frame-editor .danger-zone { margin-inline-start: auto; }
  @container frame-editor (max-width: 720px) {
    .frame-editor > header { flex-direction: column; }
    .frame-editor .frame-fields { grid-template-columns: 1fr; }
    .frame-editor .frame-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .frame-editor .danger-zone { margin-inline-start: 0; }
  }
  @container frame-editor (max-width: 430px) {
    .frame-editor .frame-actions { grid-template-columns: 1fr; }
  }
`;

export function renderSignalFrameEditor({
  timings,
  frameRoles,
  selectedFrame,
  selectedTiming,
  request,
}: SignalFrameEditorProps): TemplateResult {
  const frames = frameRanges(timings);
  const selected = clamp(selectedFrame, 0, Math.max(0, frames.length - 1));
  const frame = frames[selected];
  const role = frameRoles[selected] || "auto";
  const canSplit =
    selectedTiming % 2 === 1 &&
    selectedTiming < timings.length - 1 &&
    timings[selectedTiming] < 10_000;
  const hasLeadingIdle =
    timings.length > 3 && timings[0] <= 1 && timings[1] >= 10_000;
  const hasTrailingIdle =
    timings.length > 1 &&
    timings.length % 2 === 0 &&
    timings.at(-1)! >= 10_000;
  const act = (operation: string, detail: Record<string, unknown> = {}) =>
    request("lab-action", {
      labAction: "frame",
      detail: { operation, ...detail },
    });

  return html`<section class="frame-editor" aria-labelledby="frame-editor-title">
    <header>
      <div>
        <h2 id="frame-editor-title">Frame structure</h2>
        <p>Long spaces separate complete transmissions. Roles stay with frames when reordered.</p>
      </div>
      <span class="badge">${frames.length} frame${frames.length === 1 ? "" : "s"}</span>
    </header>
    <div class="frame-fields">
      <ha-select
        label="Frame"
        .value=${String(selected)}
        .options=${frames.map((item, index) => ({
          value: String(index),
          label: `Frame ${index + 1} · ${formatDuration(
            timingTotal(timings.slice(item.start, item.end)),
          )}`,
        }))}
        @selected=${(event: Event) =>
          act("select", { index: Number(haSelectedValue(event)) })}
      ></ha-select>
      <ha-select
        label="Meaning"
        .value=${role}
        .options=${[
          { value: "auto", label: "Automatic" },
          { value: "intro", label: "Intro" },
          { value: "repeat", label: "Repeat" },
          { value: "ending", label: "Ending" },
        ]}
        @selected=${(event: Event) =>
          act("role", { index: selected, role: haSelectedValue(event) })}
      ></ha-select>
    </div>
    <div class="actions frame-actions">
      <ha-button appearance="outlined" variant="neutral" .disabled=${selected <= 0} @click=${() => act("move", { index: selected, delta: -1 })}><ha-icon slot="start" icon="mdi:arrow-left"></ha-icon>Move earlier</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${selected >= frames.length - 1} @click=${() => act("move", { index: selected, delta: 1 })}>Move later<ha-icon slot="end" icon="mdi:arrow-right"></ha-icon></ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!canSplit} @click=${() => act("split", { timingIndex: selectedTiming })}><ha-icon slot="start" icon="mdi:content-cut"></ha-icon>Split at selected space</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${frame?.gapIndex == null} @click=${() => act("join", { index: selected })}><ha-icon slot="start" icon="mdi:link-variant"></ha-icon>Join with next</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!frame} @click=${() => act("duplicate", { index: selected })}><ha-icon slot="start" icon="mdi:content-duplicate"></ha-icon>Duplicate frame</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${frames.length < 2 || role !== "repeat"} @click=${() => act("expand-repeat", { index: selected })}><ha-icon slot="start" icon="mdi:repeat"></ha-icon>Expand repeat once</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!hasLeadingIdle} title=${hasLeadingIdle ? "Remove the explicit leading idle gap" : "No explicit leading idle gap is present"} @click=${() => act("trim-leading")}><ha-icon slot="start" icon="mdi:arrow-collapse-left"></ha-icon>Trim leading idle</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!hasTrailingIdle} title=${hasTrailingIdle ? "Remove the trailing idle gap" : "The final space is not an idle gap"} @click=${() => act("trim-trailing")}><ha-icon slot="start" icon="mdi:arrow-collapse-right"></ha-icon>Trim trailing idle</ha-button>
      <ha-button class="danger-zone" appearance="plain" variant="danger" .disabled=${frames.length < 2} @click=${() => act("remove", { index: selected })}><ha-icon slot="start" icon="mdi:delete-outline"></ha-icon>Remove frame</ha-button>
    </div>
  </section>`;
}
