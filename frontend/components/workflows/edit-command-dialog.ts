import { html, type TemplateResult } from "lit";
import type { Dict, RemoteProfileData } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import { commandRoleOptions, remoteProfileOptions } from "./options";

export interface EditCommandDialogOptions {
  mode?: "edit" | "duplicate";
  data: Dict;
  profiles: Dict<RemoteProfileData>;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderEditCommandDialog = ({
  mode = "edit",
  data,
  profiles,
  error = "",
  busy = false,
  onAction,
}: EditCommandDialogOptions): TemplateResult => {
  const duplicate = mode === "duplicate";
  const ready =
    Boolean(String(data.name || "").trim()) &&
    Boolean(data.target_remote_profile_id) &&
    (!duplicate || Boolean(data.target_command_id));
  const note = duplicate
    ? renderWorkspaceNotice({
        className: "imprint-workflow-wide",
        icon: "mdi:content-copy",
        content: "The copy has its own revision history. Later changes will not affect the original command.",
      })
    : Number(data.shared_count || 0) > 1
      ? renderWorkspaceNotice({
          className: "imprint-workflow-wide",
          icon: "mdi:account-multiple-outline",
          content: "This remote profile is shared. Renaming or moving this command affects every appliance using it.",
        })
      : null;
  return renderDialogShell({
    heading: duplicate ? "Duplicate command" : "Edit command",
    error,
    busy,
    workflow: duplicate ? "duplicate-command" : "edit-command",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-grid">
        <ha-input autofocus .label=${"Command name"} .value=${String(data.name || "")} placeholder="e.g. Warm white" @input=${workflowFieldInput(onAction, "name")}></ha-input>
        ${duplicate ? html`
          <ha-input .label=${"Command ID"} .value=${String(data.target_command_id || "")} placeholder="e.g. warm_white" @input=${workflowFieldInput(onAction, "target_command_id")}></ha-input>
        ` : null}
        ${duplicate ? null : html`<ha-select .label=${"Command role"} .value=${String(data.role || "")} .options=${commandRoleOptions()} @selected=${workflowFieldSelected(onAction, "role")}></ha-select>`}
        <ha-select .label=${"Remote profile"} .value=${String(data.target_remote_profile_id || "")} .options=${remoteProfileOptions(profiles)} @selected=${workflowFieldSelected(onAction, "target_remote_profile_id")}></ha-select>
        ${note}
      </div>
    `,
    footer: renderDialogFooter([
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: duplicate ? "Duplicate" : "Save",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !ready,
        onClick: () => onAction({ type: "submit" }),
      },
    ]),
  });
};
