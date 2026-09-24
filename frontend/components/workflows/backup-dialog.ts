import { css, html, nothing, type TemplateResult } from "lit";
import { haSelectedValue } from "../../core/ha-controls";
import type {
  AreaSummary,
  Dict,
  InfraredHardwareEntity,
} from "../../types";
import { renderDialogFooter, renderDialogShell } from "../shared/dialog";
import { renderTextarea } from "../shared/textarea";
import { type WorkflowActionHandler, workflowFieldInput } from "./events";
import { areaOptions, emitterOptions } from "./options";

export interface BackupDialogOptions {
  heading?: string;
  data: Dict;
  areas: AreaSummary[];
  emitters: InfraredHardwareEntity[];
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const backupDialogStyles = css`
  .imprint-restore-list { display: grid; gap: 10px; min-width: 0; }
  .imprint-restore-item {
    padding: 12px;
    border: 1px solid var(--imprint-line);
    border-radius: 10px;
    display: grid;
    gap: 10px;
    min-width: 0;
  }
  .imprint-restore-item h3 { margin: 0; font-size: 15px; }
`;

export const renderBackupDialog = ({
  heading = "Backup & restore",
  data,
  areas,
  emitters,
  error = "",
  busy = false,
  onAction,
}: BackupDialogOptions): TemplateResult => {
  const document = data.restore_document as Dict | null;
  const appliances = Object.entries((document?.appliances as Dict) || {});
  const mappings = (data.restore_mappings || {}) as Dict<Dict>;
  const profileOnly = Boolean(data.remote_profile_id);
  return renderDialogShell({
    heading,
    description: "Portable JSON excludes Home Assistant entity IDs and emitter assignments.",
    error,
    busy,
    workflow: "backup-restore",
    onClose: () => onAction({ type: "close" }),
    content: html`
      ${renderTextarea({
        label: "Export JSON",
        readOnly: true,
        value: String(data.export_value || ""),
        placeholder: "Preparing backup…",
      })}
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" .disabled=${!data.export_value} @click=${() => onAction({ type: "backup-copy", value: String(data.export_value || "") })}>
          <ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy backup
        </ha-button>
      </div>
      ${!profileOnly ? html`
        <hr class="imprint-workflow-separator">
        <div>
          <h3>Restore a backup</h3>
          <p class="muted">Review the file first, then map every appliance to this installation's Area and IR emitter.</p>
        </div>
        ${renderTextarea({
          label: "Backup JSON",
          value: String(data.restore_value || ""),
          placeholder: "Paste an Imprint Refinery backup",
          onInput: workflowFieldInput(onAction, "restore_value"),
        })}
        <div class="imprint-workflow-inline-actions">
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !String(data.restore_value || "").trim()} @click=${() => onAction({ type: "backup-review" })}>Review restore</ha-button>
        </div>
        ${document ? html`
          <div class="imprint-restore-list">
            ${appliances.length ? appliances.map(([id, appliance]) => html`
              <div class="imprint-restore-item">
                <h3>${String((appliance as Dict).name || id)}</h3>
                <div class="imprint-workflow-grid">
                  <ha-select .label=${"Home Assistant Area"} .value=${String(mappings[id]?.area_id || "")} .options=${areaOptions(areas)} @selected=${(event: Event) => onAction({ type: "backup-mapping-change", applianceId: id, field: "area_id", value: haSelectedValue(event) })}></ha-select>
                  <ha-select .label=${"IR emitter"} .value=${String(mappings[id]?.infrared_emitter_ref || "")} .options=${emitterOptions(emitters)} @selected=${(event: Event) => onAction({ type: "backup-mapping-change", applianceId: id, field: "infrared_emitter_ref", value: haSelectedValue(event) })}></ha-select>
                </div>
              </div>
            `) : html`<p class="muted">This backup contains remote profiles only, so there are no appliance assignments to map.</p>`}
          </div>
        ` : nothing}
      ` : nothing}
    `,
    footer: document ? renderDialogFooter([
      {
        label: "Restore backup",
        variant: "brand",
        appearance: "accent",
        disabled: busy,
        onClick: () => onAction({ type: "backup-restore" }),
      },
    ]) : nothing,
  });
};
