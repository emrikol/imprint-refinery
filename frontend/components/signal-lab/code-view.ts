import { css, html, nothing, type TemplateResult } from "lit";
import { haSelectedValue } from "../../core/ha-controls";
import type { SignalLabState } from "../../core/signal-lab";
import { downloadText, formatDuration, safeFilename } from "../../core/utils";
import type { LabCodeRepresentation } from "../../types";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import type { SignalLabRequest } from "./events";

export const signalCodeFormatOptions = [
  { value: "zosung_base64", label: "Zosung Base64" },
  { value: "pronto", label: "Pronto Hex" },
  { value: "girr", label: "GIRR 1.2" },
  { value: "flipper", label: "Flipper .ir" },
  { value: "lirc", label: "LIRC raw" },
  { value: "raw_signed", label: "Raw signed" },
  { value: "raw_unsigned", label: "Raw unsigned" },
] as const;

const labels: Record<string, string> = Object.fromEntries(
  signalCodeFormatOptions.map(({ value, label }) => [value, label]),
);

export interface SignalCodeViewProps {
  lab: SignalLabState;
  format: string;
  request: SignalLabRequest;
}

export interface CodeRepresentationViewProps {
  format: string;
  representation?: LabCodeRepresentation;
  description?: string;
  subject?: string;
  filenameBase?: string;
  request: SignalLabRequest;
}

export const signalCodeViewStyles = css`
  .code-tools {
    display: grid;
    gap: 14px;
    min-width: 0;
    container: signal-code-view / inline-size;
  }
  .code-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) auto auto;
    gap: 8px;
    align-items: end;
  }
  .code-surface { min-width: 0; display: grid; gap: 8px; }
  .code-surface-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .code-surface-head strong { min-width: 0; overflow-wrap: anywhere; }
  .encoded-value {
    box-sizing: border-box;
    margin: 0;
    width: 100%;
    min-width: 0;
    max-height: 320px;
    overflow: auto;
    padding: 12px;
    border: 1px solid var(--imprint-line);
    border-radius: 9px;
    background: var(--imprint-surface-2);
    color: var(--imprint-text);
    font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-numeric: tabular-nums;
    white-space: pre;
    overflow-wrap: normal;
    user-select: text;
  }
  .encoded-value code { font: inherit; }
  .code-loading {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    color: var(--imprint-muted);
  }
  .code-loading ha-spinner { flex: 0 0 auto; width: 24px; height: 24px; }
  @container signal-code-view (max-width: 520px) {
    .code-toolbar { grid-template-columns: 1fr; }
    .code-toolbar ha-button { width: 100%; }
  }
`;

export function renderSignalCodeView({
  lab,
  format,
  request,
}: SignalCodeViewProps): TemplateResult {
  const key = `${format}|${lab.carrierFrequency}|${lab.timings.join(",")}`;
  const result = lab.codeRepresentation?.key === key
    ? lab.codeRepresentation
    : undefined;
  return renderCodeRepresentationView({
    format,
    representation: result,
    request,
  });
}

export function renderCodeRepresentationView({
  format,
  representation: result,
  description,
  subject = "current draft",
  filenameBase,
  request,
}: CodeRepresentationViewProps): TemplateResult {
  const label = labels[format] || format;
  const value = result?.value || "";
  const loading = !result || result.loading;
  const trailingSpace = Number(result?.lossReport?.trailing_space_added_us || 0);
  const lossy = result?.lossReport?.lossless === false && !trailingSpace;
  const extension = ({ girr: "xml", flipper: "ir", lirc: "conf" } as Record<string, string>)[format] || "txt";
  const mediaType = format === "girr" ? "application/xml;charset=utf-8" : "text/plain;charset=utf-8";
  return html`<div class="code-tools">
    <p class="muted">${description || `This is the current draft encoded as ${label}. Viewing or copying it does not transmit.`}</p>
    <div class="code-toolbar">
      <ha-select
        label="Representation"
        .value=${format}
        .options=${signalCodeFormatOptions}
        @selected=${(event: Event) =>
          request("code-format", { format: haSelectedValue(event) })}
      ></ha-select>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!value || loading} @click=${() => request("copy-code", { value })}><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy code</ha-button>
      <ha-button appearance="outlined" variant="neutral" .disabled=${!value || loading} @click=${() => downloadText(value, `${safeFilename(filenameBase || subject)}.${extension}`, mediaType)}><ha-icon slot="start" icon="mdi:download"></ha-icon>Download</ha-button>
    </div>
    ${loading
      ? html`<div class="code-loading" role="status" aria-live="polite"><ha-spinner></ha-spinner><span>Encoding the ${subject}…</span></div>`
      : result?.error
        ? html`<ha-alert .alertType=${"error"}>${result.error}<ha-button slot="action" appearance="outlined" variant="neutral" @click=${() => request("retry-code")}>Try again</ha-button></ha-alert>`
        : value
          ? html`<div class="code-surface">
              <div class="code-surface-head">
                <strong>${label}</strong>
                <span class="badge ${lossy ? "warning" : trailingSpace ? "" : "success"}">${lossy ? "Converted with limitations" : trailingSpace ? "Trailing idle encoded" : "Ready to copy"}</span>
              </div>
              <pre class="encoded-value" tabindex="0" aria-label=${`${label} code`}><code>${value}</code></pre>
              ${trailingSpace
                ? renderWorkspaceNotice({
                    content: html`Pronto needs a finite off-time after the final mark. This copy adds ${formatDuration(trailingSpace)} of inactive trailing space, matching the final mark; the saved capture remains unchanged.`,
                  })
                : lossy
                  ? html`<ha-alert .alertType=${"warning"}>This format changes some timing or carrier detail. Choose Raw signed to preserve the editable timing sequence.</ha-alert>`
                  : nothing}
            </div>`
          : html`<ha-alert .alertType=${"error"}>The ${subject} could not be represented as ${label}.<ha-button slot="action" appearance="outlined" variant="neutral" @click=${() => request("retry-code")}>Try again</ha-button></ha-alert>`}
  </div>`;
}
