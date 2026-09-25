import { css, html, nothing, type TemplateResult } from "lit";
import type { Dict, RemoteProfileData } from "../../types";
import { renderDialogFooter, renderDialogShell } from "../shared/dialog";
import { renderFilePicker } from "../shared/file-picker";
import { renderTextarea } from "../shared/textarea";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import { remoteProfileOptions } from "./options";

export interface ImportSignalsDialogOptions {
  data: Dict;
  profiles: Dict<RemoteProfileData>;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const importSignalsDialogStyles = css`
  .imprint-import-preview-item {
    padding: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px 12px;
    align-items: start;
  }
  .imprint-import-preview-item > div { display: grid; gap: 3px; min-width: 0; }
  .imprint-import-preview-item span { overflow-wrap: anywhere; }
  .imprint-import-preview-item details { grid-column: 1 / -1; min-width: 0; }
  .imprint-import-preview-item summary { cursor: pointer; }
  .imprint-import-preview-item pre {
    overflow: auto;
    margin: 8px 0 0;
    padding: 10px;
    border-radius: 8px;
    background: var(--secondary-background-color);
    font: 13px/1.45 var(--code-font-family, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .imprint-import-status { font-weight: 600; }
  .imprint-import-status.ready { color: var(--imprint-success); }
  .imprint-import-status.warning { color: var(--imprint-warning); }
  .imprint-import-detail-list { margin: 8px 0 0; padding-inline-start: 22px; }
`;

export const renderImportSignalsDialog = ({
  data,
  profiles,
  error = "",
  busy = false,
  onAction,
}: ImportSignalsDialogOptions): TemplateResult => {
  const preview = (data.preview || null) as Dict | null;
  const commands = (preview?.commands || []) as Dict[];
  const compatibleCommands = commands.filter(
    (command) => command.compatible !== false,
  );
  const unsupportedCommands = (preview?.unsupported_commands || []) as Dict[];
  const lossyCommands = compatibleCommands.filter(
    (command) => (command.loss_report as Dict | undefined)?.lossless === false,
  );
  const readFile = async (file: File): Promise<void> => {
      const value = await file.text();
      onAction({ type: "field-change", field: "code", value });
      onAction({ type: "field-change", field: "file_name", value: file.name });
      onAction({ type: "field-change", field: "format", value: "auto" });
      onAction({ type: "field-change", field: "preview", value: null });
  };
  return renderDialogShell({
    heading: "Import IR signals",
    description:
      "Preview first. Multi-command files are added to one reusable remote profile.",
    error,
    busy,
    workflow: "import-signals",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-grid">
        <ha-select autofocus .label=${"Remote profile"} .value=${String(data.remote_profile_id || "")} .options=${remoteProfileOptions(profiles, "Choose a remote profile")} @selected=${workflowFieldSelected(onAction, "remote_profile_id")}></ha-select>
        <ha-select .label=${"Format"} .value=${String(data.format || "auto")} .options=${[
          { value: "auto", label: "Auto-detect" },
          { value: "native_json", label: "Imprint backup" },
          { value: "flipper", label: "Flipper .ir" },
          { value: "girr", label: "GIRR" },
          { value: "lirc", label: "LIRC raw" },
          { value: "pronto", label: "Pronto Hex" },
          { value: "raw_signed", label: "Raw signed timings" },
          { value: "raw_unsigned", label: "Raw unsigned timings" },
          { value: "zosung_base64", label: "Zosung Base64" },
        ]} @selected=${workflowFieldSelected(onAction, "format")}></ha-select>
        ${renderFilePicker({
          accept:
            ".json,.ir,.xml,.conf,.txt,application/json,text/plain,application/xml,text/xml",
          buttonLabel: "Choose file",
          emptyLabel: "Or paste signal data below",
          selectedName: String(data.file_name || ""),
          className: "imprint-workflow-wide",
          disabled: busy,
          onFile: readFile,
          onError: (message) =>
            onAction({ type: "import-file-error", message }),
          errorMessage: "The selected file could not be read.",
        })}
        ${renderTextarea({
          className: "imprint-workflow-wide",
          label: "Signal data",
          value: String(data.code || ""),
          placeholder: "Paste one signal or a multi-command profile",
          onInput: workflowFieldInput(onAction, "code", {
            resetFields: ["preview"],
          }),
        })}
      </div>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !data.remote_profile_id || !String(data.code || "").trim()} @click=${() => onAction({ type: "import-preview" })}>Preview import</ha-button>
      </div>
      ${
        preview
          ? html`
        <div class="imprint-workflow-stack">
          ${renderWorkspaceNotice({
            icon: "mdi:file-check-outline",
            role: "status",
            content: `${compatibleCommands.length} compatible command${compatibleCommands.length === 1 ? "" : "s"}${preview.unsupported_count ? ` · ${preview.unsupported_count} unsupported` : ""}${lossyCommands.length ? ` · ${lossyCommands.length} with documented representation loss` : ""}`,
          })}
          <span class="muted">Detected format: ${String(preview.format || data.format || "unknown")}${data.file_name ? ` · ${String(data.file_name)}` : ""}</span>
          <div class="imprint-workflow-stack">
            ${commands.map((command) => {
              const analysis = (command.analysis || {}) as Dict;
              const signal = (command.signal || {}) as Dict;
              const loss = (command.loss_report || {}) as Dict;
              const losses = Array.isArray(loss.losses)
                ? loss.losses.map(String)
                : [];
              const source = (command.source ||
                command.backup_origin ||
                {}) as Dict;
              const compatible = command.compatible !== false;
              return html`
                <div class="panel imprint-import-preview-item">
                  <div>
                  <strong>${command.name || command.command_id}</strong>
                    <span class="muted">${[
                      analysis.protocol || command.format || "Raw timing",
                      signal.carrier_frequency
                        ? `${(Number(signal.carrier_frequency) / 1000).toFixed(1)} kHz`
                        : "Carrier not reported",
                    ].join(" · ")}</span>
                    ${
                      !compatible
                        ? html`<span class="muted">${command.compatibility_error || "Unsupported representation"}</span>`
                        : nothing
                    }
                  </div>
                  <span class=${`imprint-import-status ${compatible ? "ready" : "warning"}`}>
                    ${compatible ? "Ready" : "Skipped"}
                  </span>
                  ${
                    loss.lossless === false || Object.keys(source).length
                      ? html`
                    <details>
                      <summary>Conversion and provenance details</summary>
                      ${
                        loss.lossless === false
                          ? html`
                        <ul class="imprint-import-detail-list">
                          ${losses.map((item) => html`<li>${item.replaceAll("_", " ")}</li>`)}
                          ${loss.maximum_timing_error_us ? html`<li>Maximum timing change: ${Number(loss.maximum_timing_error_us)} µs</li>` : nothing}
                          ${loss.carrier_error_hz ? html`<li>Carrier change: ${Number(loss.carrier_error_hz)} Hz</li>` : nothing}
                        </ul>
                      `
                          : html`<p class="muted">No representation loss was reported.</p>`
                      }
                      <pre>${JSON.stringify(source, null, 2)}</pre>
                    </details>
                  `
                      : nothing
                  }
                </div>
              `;
            })}
          </div>
          ${
            unsupportedCommands.length
              ? renderWorkspaceNotice({
                  tone: "warning",
                  role: "alert",
                  icon: "mdi:alert-outline",
                  content: html`<div><strong>${unsupportedCommands.length} unsupported command${unsupportedCommands.length === 1 ? "" : "s"} will be skipped</strong><ul class="imprint-import-detail-list">${unsupportedCommands.map((command) => html`<li><strong>${command.name || "Unnamed command"}:</strong> ${command.error || command.compatibility_error || "Unsupported representation"}${command.source ? ` · ${String(command.source)}` : ""}</li>`)}</ul></div>`,
                })
              : nothing
          }
        </div>
      `
          : nothing
      }
    `,
    footer: preview
      ? renderDialogFooter([
      {
        label: "Import commands",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !compatibleCommands.length,
        onClick: () => onAction({ type: "import-commands" }),
      },
        ])
      : nothing,
  });
};
