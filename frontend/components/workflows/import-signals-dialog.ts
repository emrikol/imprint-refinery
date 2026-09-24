import { css, html, nothing, type TemplateResult } from "lit";
import type { Dict, RemoteProfileData } from "../../types";
import { renderDialogFooter, renderDialogShell } from "../shared/dialog";
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
    gap: 3px;
  }
  .imprint-file-picker { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .imprint-file-picker input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
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
  const compatibleCommands = commands.filter((command) => command.compatible !== false);
  const commandCount = Number(preview?.command_count || commands.length || 0);
  const chooseFile = (event: Event): void => {
    const input = event.currentTarget as HTMLElement;
    input.closest(".imprint-file-picker")?.querySelector<HTMLInputElement>("input")?.click();
  };
  const readFile = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const value = await file.text();
      onAction({ type: "field-change", field: "code", value });
      onAction({ type: "field-change", field: "file_name", value: file.name });
      onAction({ type: "field-change", field: "format", value: "auto" });
      onAction({ type: "field-change", field: "preview", value: null });
    } catch {
      onAction({ type: "import-file-error", message: "The selected file could not be read." });
    } finally {
      input.value = "";
    }
  };
  return renderDialogShell({
    heading: "Import IR signals",
    description: "Preview first. Multi-command files are added to one reusable remote profile.",
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
        <div class="imprint-file-picker imprint-workflow-wide">
          <input type="file" accept=".json,.ir,.xml,.conf,.txt,application/json,text/plain,application/xml,text/xml" @change=${readFile}>
          <ha-button variant="neutral" appearance="outlined" @click=${chooseFile}><ha-icon slot="start" icon="mdi:file-upload-outline"></ha-icon>Choose file</ha-button>
          <span class="muted">${data.file_name ? String(data.file_name) : "Or paste signal data below"}</span>
        </div>
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
      ${preview ? html`
        <div class="imprint-workflow-stack">
          ${renderWorkspaceNotice({
            icon: "mdi:file-check-outline",
            role: "status",
            content: `${commandCount} compatible command${commandCount === 1 ? "" : "s"}${preview.unsupported_count ? ` · ${preview.unsupported_count} unsupported` : ""}`,
          })}
          <span class="muted">Detected format: ${String(preview.format || data.format || "unknown")}</span>
          <div class="imprint-workflow-stack">
            ${commands.map((command) => {
              const analysis = (command.analysis || {}) as Dict;
              return html`
                <div class="panel imprint-import-preview-item">
                  <strong>${command.name || command.command_id}</strong>
                  <span class="muted">${analysis.protocol || command.format || "Raw timing"}</span>
                </div>
              `;
            })}
          </div>
        </div>
      ` : nothing}
    `,
    footer: preview ? renderDialogFooter([
      {
        label: "Import commands",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !compatibleCommands.length,
        onClick: () => onAction({ type: "import-commands" }),
      },
    ]) : nothing,
  });
};
