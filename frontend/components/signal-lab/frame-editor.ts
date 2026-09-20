import { LitElement, css, html } from "lit";
import { property } from "lit/decorators.js";
import { frameRanges, timingTotal } from "../../core/signal";
import { clamp } from "../../core/signal-lab";
import { emit, formatDuration } from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { tokens } from "../../styles";

@safeCustomElement("imprint-signal-frame-editor")
export class ImprintSignalFrameEditor extends LitElement {
  @property({ attribute: false }) timings: number[] = [];
  @property({ attribute: false }) frameRoles: string[] = [];
  @property({ type: Number }) selectedFrame = 0;
  @property({ type: Number }) selectedTiming = 0;

  static styles = [
    tokens,
    css`
    :host { display: block; }
    section { display: grid; gap: 12px; padding: 14px; border-block: 1px solid var(--imprint-line); }
    header { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    h2 { margin-block-end: 3px; }
    p { margin: 0; color: var(--imprint-muted); }
    .fields { display: grid; grid-template-columns: minmax(150px,1fr) minmax(150px,1fr); gap: 9px; }
    .actions { align-items: stretch; }
    .actions .btn { min-height: 44px; }
    .danger-zone { margin-inline-start: auto; }
    @media (max-width: 720px) {
      header { flex-direction: column; }
      .fields { grid-template-columns: 1fr; }
      .actions { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); }
      .danger-zone { margin-inline-start: 0; }
    }
    @media (max-width: 430px) { .actions { grid-template-columns: 1fr; } }
  `,
  ];

  render() {
    const frames = frameRanges(this.timings);
    const selected = clamp(
      this.selectedFrame,
      0,
      Math.max(0, frames.length - 1),
    );
    const frame = frames[selected];
    const role = this.frameRoles[selected] || "auto";
    const canSplit =
      this.selectedTiming % 2 === 1 &&
      this.selectedTiming < this.timings.length - 1 &&
      this.timings[this.selectedTiming] < 10_000;
    const hasLeadingIdle =
      this.timings.length > 3 &&
      this.timings[0] <= 1 &&
      this.timings[1] >= 10_000;
    const hasTrailingIdle =
      this.timings.length > 1 &&
      this.timings.length % 2 === 0 &&
      this.timings.at(-1)! >= 10_000;
    return html`<section aria-labelledby="frame-editor-title">
      <header><div><h2 id="frame-editor-title">Frame structure</h2><p>Long spaces separate complete transmissions. Roles stay with frames when reordered.</p></div><span class="badge">${frames.length} frame${frames.length === 1 ? "" : "s"}</span></header>
      <div class="fields">
        <label class="field">Frame<select .value=${String(selected)} @change=${(event: Event) => this.act("select", { index: Number((event.target as HTMLSelectElement).value) })}>${frames.map((item, index) => html`<option value=${index}>Frame ${index + 1} · ${formatDuration(timingTotal(this.timings.slice(item.start, item.end)))}</option>`)}</select></label>
        <label class="field">Meaning<select .value=${role} @change=${(event: Event) => this.act("role", { index: selected, role: (event.target as HTMLSelectElement).value })}><option value="auto">Automatic</option><option value="intro">Intro</option><option value="repeat">Repeat</option><option value="ending">Ending</option></select></label>
      </div>
      <div class="actions">
        <button class="btn" ?disabled=${selected <= 0} @click=${() => this.act("move", { index: selected, delta: -1 })}><ha-icon icon="mdi:arrow-left"></ha-icon>Move earlier</button>
        <button class="btn" ?disabled=${selected >= frames.length - 1} @click=${() => this.act("move", { index: selected, delta: 1 })}>Move later<ha-icon icon="mdi:arrow-right"></ha-icon></button>
        <button class="btn" ?disabled=${!canSplit} @click=${() => this.act("split", { timingIndex: this.selectedTiming })}><ha-icon icon="mdi:content-cut"></ha-icon>Split at selected space</button>
        <button class="btn" ?disabled=${frame?.gapIndex == null} @click=${() => this.act("join", { index: selected })}><ha-icon icon="mdi:link-variant"></ha-icon>Join with next</button>
        <button class="btn" ?disabled=${!frame} @click=${() => this.act("duplicate", { index: selected })}><ha-icon icon="mdi:content-duplicate"></ha-icon>Duplicate frame</button>
        <button class="btn" ?disabled=${frames.length < 2 || role !== "repeat"} @click=${() => this.act("expand-repeat", { index: selected })}><ha-icon icon="mdi:repeat"></ha-icon>Expand repeat once</button>
        <button class="btn" ?disabled=${!hasLeadingIdle} title=${hasLeadingIdle ? "Remove the explicit leading idle gap" : "No explicit leading idle gap is present"} @click=${() => this.act("trim-leading")}><ha-icon icon="mdi:arrow-collapse-left"></ha-icon>Trim leading idle</button>
        <button class="btn" ?disabled=${!hasTrailingIdle} title=${hasTrailingIdle ? "Remove the trailing idle gap" : "The final space is not an idle gap"} @click=${() => this.act("trim-trailing")}><ha-icon icon="mdi:arrow-collapse-right"></ha-icon>Trim trailing idle</button>
        <button class="btn danger danger-zone" ?disabled=${frames.length < 2} @click=${() => this.act("remove", { index: selected })}><ha-icon icon="mdi:delete-outline"></ha-icon>Remove frame</button>
      </div>
    </section>`;
  }

  private act(operation: string, detail: Record<string, unknown> = {}): void {
    emit(this, "lab-frame-action", { operation, ...detail });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-signal-frame-editor": ImprintSignalFrameEditor;
  }
}
