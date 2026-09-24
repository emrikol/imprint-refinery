import { css, html, nothing, type TemplateResult } from "lit";
import { haSelectedValue } from "../../core/ha-controls";
import type { Validation } from "../../core/signal";
import { estimatedPayloadBytes, type SignalLabState } from "../../core/signal-lab";
import { decodedInteger } from "../../core/utils";
import type { ProtocolRebuild } from "../../types";
import type { SignalLabRequest } from "./events";

export interface SignalDetailsProps {
  lab: SignalLabState;
  analysis: SignalLabState["sourceAnalysis"];
  validation: Validation;
  rebuildId: string;
  request: SignalLabRequest;
}

export const signalDetailsStyles = css`
  .signal-details {
    padding: 18px;
    display: grid;
    align-content: start;
    gap: 16px;
    min-width: 0;
  }
  .signal-details h2,
  .signal-details h3 { margin: 0; }
  .signal-details-list { display: grid; gap: 13px; }
  .signal-detail-row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }
  .signal-detail-row ha-icon {
    color: var(--imprint-muted);
    font-size: 21px;
  }
  .signal-detail-row.success ha-icon { color: var(--imprint-success); }
  .signal-detail-row small {
    display: block;
    color: var(--imprint-muted);
    margin-block-start: 2px;
  }
  .signal-details hr {
    width: 100%;
    border: 0;
    border-block-start: 1px solid var(--imprint-line);
  }
  .signal-generation { display: grid; gap: 12px; }
  .signal-refine-action {
    display: grid;
    gap: 8px;
    padding-block: 2px 12px;
  }
  .signal-refine-action + .signal-refine-action {
    border-block-start: 1px solid var(--imprint-line);
    padding-block-start: 13px;
  }
  .signal-refine-action small { color: var(--imprint-muted); }
  .signal-refine-action ha-button { justify-self: start; }
`;

function decodedValue(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0)
    return decodedInteger(value);
  return String(value);
}

function rebuildLabel(rebuild: ProtocolRebuild, detailed = false): string {
  if (!detailed) return rebuild.protocol;
  const fields = [
    rebuild.address == null ? "" : `address ${decodedValue(rebuild.address)}`,
    rebuild.command == null ? "" : `command ${decodedValue(rebuild.command)}`,
  ].filter(Boolean);
  return fields.length
    ? `${rebuild.protocol} · ${fields.join(" · ")}`
    : rebuild.protocol;
}

function renderRefineSignal(
  lab: SignalLabState,
  analysis: SignalLabState["sourceAnalysis"],
  rebuildId: string,
  request: SignalLabRequest,
): TemplateResult {
  const candidates = Array.isArray(analysis.protocol_candidates)
    ? analysis.protocol_candidates
    : [];
  const rebuilds = Array.isArray(analysis.protocol_rebuilds)
    ? analysis.protocol_rebuilds
    : [];
  const selected =
    rebuilds.find((item) => item.id === rebuildId) || rebuilds[0];
  const unavailable = lab.analysisPending
    ? "Checking whether this draft can be rebuilt…"
    : candidates.length > 1
      ? "Rebuild unavailable: none of the current protocol interpretations has a complete encoder."
      : candidates.length
        ? `${String(
            candidates[0].protocol || "This protocol",
          )} was recognized, but Imprint Refinery cannot rebuild it yet.`
        : "Rebuild unavailable: no supported protocol was recognized.";
  return html`<div class="signal-generation" aria-label="Refine signal">
    <h3>Refine signal</h3>
    <div class="signal-refine-action">
      <strong>${selected
        ? `Align to ${selected.protocol} timing`
        : "Smooth timing jitter"}</strong>
      ${rebuilds.length > 1
        ? html`<ha-select
            label="Protocol interpretation"
            .value=${selected?.id || ""}
            .options=${rebuilds.map((item) => ({
              value: item.id,
              label: rebuildLabel(item, true),
            }))}
            @selected=${(event: Event) =>
              request("rebuild-id", {
                rebuildId: haSelectedValue(event),
              })}
          ></ha-select>`
        : nothing}
      ${selected
        ? html`<small id="protocol-rebuild-help">Recreates the command from decoded fields using ${selected.protocol}-defined timings and ${(selected.carrier_frequency / 1000).toFixed(1)} kHz carrier.${rebuilds.length > 1 ? ` Choose among ${rebuilds.length} materially different alignments if needed.` : ""} The protected source stays unchanged.</small>
            <ha-button appearance="outlined" variant="neutral" aria-describedby="protocol-rebuild-help" @click=${() => request("preview-rebuild", { rebuild: selected })}><ha-icon slot="start" icon="mdi:square-wave"></ha-icon>Preview ${selected.protocol} alignment</ha-button>`
        : html`<small id="smooth-timing-help">Averages similar mark and space durations in the current draft because a complete protocol alignment is not available. Protocol-defined values are not used.</small>
            <ha-button appearance="outlined" variant="neutral" aria-describedby="smooth-timing-help" @click=${() => request("preview-transform", { kind: "normalize", range: [0, lab.timings.length - 1] })}><ha-icon slot="start" icon="mdi:square-wave"></ha-icon>Preview smoothing</ha-button>
            <small>${unavailable}</small>`}
    </div>
  </div>`;
}

export function renderSignalDetails({
  lab,
  analysis: sourceAnalysis,
  validation,
  rebuildId,
  request,
}: SignalDetailsProps): TemplateResult {
  const analysis = sourceAnalysis || {};
  const protocol = String(
    analysis.protocol || analysis.protocol_name || "Unknown protocol",
  );
  const protocolKnown = protocol !== "Unknown protocol";
  return html`<aside class="signal-details" aria-label="Signal details">
    <h2>Signal details</h2>
    <div class="signal-details-list">
      <div class="signal-detail-row">
        <ha-icon icon="mdi:file-document-outline"></ha-icon>
        <div><strong>Protocol: ${protocol}</strong>${!protocolKnown ? html`<small>Raw timings remain fully usable.</small>` : nothing}</div>
      </div>
      <div class="signal-detail-row">
        <ha-icon icon="mdi:sine-wave"></ha-icon>
        <div><strong>Carrier: ${(lab.carrierFrequency / 1000).toFixed(1)} kHz ${lab.carrierSource}</strong><small>${lab.carrierSource === "assumed" ? "The receiver did not report a carrier frequency." : "Provided by the signal source."}</small></div>
      </div>
      <div class="signal-detail-row ${validation.compatible ? "success" : ""}">
        <ha-icon icon=${validation.compatible ? "mdi:check-circle" : "mdi:alert-circle-outline"}></ha-icon>
        <div><strong>${validation.compatible ? "Timing data is valid" : "Timing data needs attention"}</strong><small>${estimatedPayloadBytes(lab.timings).toLocaleString()} byte timing payload</small></div>
      </div>
      ${!validation.valid
        ? validation.issues.map(
            (issue) => html`<div class="signal-detail-row"><ha-icon icon="mdi:alert-outline"></ha-icon><div><strong>${issue}</strong></div></div>`,
          )
        : nothing}
      <div class="signal-detail-row">
        <ha-icon icon="mdi:information-outline"></ha-icon>
        <div><strong>Protocol decoding is best effort</strong><small>Only a one-shot appliance test confirms behavior.</small></div>
      </div>
    </div>
    <hr>
    ${renderRefineSignal(lab, analysis, rebuildId, request)}
  </aside>`;
}
