import { css, html, nothing, type TemplateResult } from "lit";
import { haSelectedValue } from "../../core/ha-controls";
import type { SignalLabState } from "../../core/signal-lab";
import {
  binaryDecoderChoices,
  binaryDecoderMessage,
  binaryEncodingLabel,
  binaryPayloadExplanation,
  binaryPayloadFor,
  binaryScoreLabel,
  decodedInteger,
  evidenceLabel,
  groupedBinary,
  repeatSummary,
  type BinaryDecoderMode,
} from "../../core/utils";
import { renderFactGrid } from "../shared/metric-grid";
import type { SignalLabRequest } from "./events";

export interface SignalDecodedViewProps {
  analysis: SignalLabState["sourceAnalysis"];
  analysisPending: boolean;
  frameCount: number;
  binaryMode: BinaryDecoderMode;
  request: SignalLabRequest;
}

export const signalDecodedViewStyles = css`
  .decoded {
    display: grid;
    gap: 12px;
    min-width: 0;
    container: signal-decoded-view / inline-size;
  }
  .decoded-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .decoded-fields .imprint-fact small {
    display: block;
    color: var(--imprint-muted);
    font-weight: 400;
  }
  .binary-readout {
    display: grid;
    gap: 10px;
    padding-block: 14px;
    border-block: 1px solid var(--imprint-line);
  }
  .binary-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }
  .binary-head > div { display: grid; gap: 2px; }
  .binary-head small,
  .binary-note { color: var(--imprint-muted); }
  .binary-value {
    margin: 0;
    padding: 13px;
    overflow-x: auto;
    border-radius: 10px;
    background: var(--imprint-surface-2);
    font: 650 16px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    letter-spacing: .035em;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
    user-select: all;
  }
  .binary-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }
  .decoder-control {
    display: grid;
    grid-template-columns: minmax(180px, 320px);
  }
  .candidate {
    background: var(--imprint-surface-2);
    border-radius: 10px;
    padding: 10px;
    display: grid;
    gap: 3px;
  }
  .candidate > span { color: var(--imprint-muted); font-size: 12px; }
  .candidate-facts {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-block-start: 5px;
    color: var(--imprint-muted);
  }
  .candidate-facts code { color: var(--imprint-text); }
  .alternatives {
    border-block-start: 1px solid var(--imprint-line);
    padding-block-start: 9px;
  }
  .decoded .advanced-section { display: grid; gap: 10px; }
  @container signal-decoded-view (max-width: 520px) {
    .decoded-fields { grid-template-columns: 1fr; }
  }
`;

function decodedValue(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return decodedInteger(value);
  return String(value);
}

function renderCandidate(candidate: Record<string, unknown>): TemplateResult {
  const facts = ["address", "command"].filter(
    (key) => candidate[key] !== undefined && candidate[key] !== null,
  );
  return html`<div class="candidate">
    <span>${String(candidate.protocol || "Candidate")}</span>
    <strong>${String(
      candidate.evidence_class || candidate.confidence || "Unranked",
    ).replaceAll("_", " ")}</strong>
    ${candidate.bits ? html`<small>${String(candidate.bits)}-bit frame</small>` : nothing}
    ${facts.length
      ? html`<div class="candidate-facts">${facts.map(
          (key) => html`<span>${key} <code>${decodedValue(candidate[key])}</code></span>`,
        )}</div>`
      : nothing}
  </div>`;
}

export function renderSignalDecodedView({
  analysis: sourceAnalysis,
  analysisPending,
  frameCount,
  binaryMode,
  request,
}: SignalDecodedViewProps): TemplateResult {
  const analysis = sourceAnalysis || {};
  const protocol = String(
    analysis.protocol || analysis.protocol_name || "Unknown protocol",
  );
  const protocolKnown = protocol !== "Unknown protocol";
  const candidates = Array.isArray(analysis.protocol_candidates)
    ? (analysis.protocol_candidates as Record<string, unknown>[])
    : [];
  const binary = binaryPayloadFor(analysis, binaryMode);
  const repeats = repeatSummary(analysis);
  return html`<div class="decoded">
    ${renderFactGrid({
      className: "decoded-fields",
      facts: [
        { label: "Protocol", value: protocol },
        {
          label: "Recognition evidence",
          value: analysisPending ? "Rechecking…" : evidenceLabel(analysis),
        },
        { label: "Frames", value: String(frameCount) },
        {
          label: "Captured repeats",
          value: html`${repeats.captured}${repeats.capturedDetail
            ? html`<small>${repeats.capturedDetail}</small>`
            : nothing}`,
        },
        {
          label: "Required repeats",
          value: html`${repeats.required}${repeats.requiredDetail
            ? html`<small>${repeats.requiredDetail}</small>`
            : nothing}`,
        },
      ],
    })}
    <div class="decoder-control">
      <ha-select
        label="Bitstream decoder"
        .value=${binaryMode}
        .options=${binaryDecoderChoices.map((choice) => ({
          value: choice.value,
          label: choice.label,
        }))}
        @selected=${(event: Event) =>
          request("binary-mode", { mode: haSelectedValue(event) })}
      ></ha-select>
    </div>
    ${binary
      ? html`<section class="binary-readout" aria-labelledby="binary-payload-heading">
          <div class="binary-head">
            <div>
              <strong id="binary-payload-heading">Raw bitstream</strong>
              <small>${binary.bit_count || binary.value.length} bits · ${binaryEncodingLabel(binary.encoding)} · transmission order</small>
            </div>
            <span class="badge">${binaryScoreLabel(binary, binaryMode)}</span>
          </div>
          <pre class="binary-value" aria-label="Binary payload in transmission order"><code>${groupedBinary(binary.value)}</code></pre>
          <div class="binary-actions">
            <span class="binary-note">${binaryPayloadExplanation(
              binary,
              protocolKnown ? protocol : undefined,
            )}</span>
            <ha-button appearance="outlined" variant="neutral" @click=${() =>
              request("copy-code", {
                value: binary.value,
                success: "Raw bitstream copied.",
              })}><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy bits</ha-button>
          </div>
        </section>`
      : html`<ha-alert .alertType=${"warning"}>${binaryDecoderMessage(
          analysis,
          binaryMode,
        )}</ha-alert>`}
    ${candidates.length
      ? html`<ha-expansion-panel class="alternatives" header=${`Protocol interpretations (${candidates.length})`}>
          <div class="advanced-section">${candidates.map(renderCandidate)}</div>
        </ha-expansion-panel>`
      : html`<p class="muted">${binary
          ? "No named protocol is claimed. The raw bitstream comes only from the two timing clusters shown above."
          : "No dependable protocol decode is available. The raw timing sequence remains editable and usable."}</p>`}
  </div>`;
}
