import { html, type TemplateResult } from "lit";
import type { Dict, RemoteProfileData } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import type { WorkflowActionHandler } from "./events";
import { workflowFieldSelected } from "./events";

export interface MoveCommandsDialogOptions {
  data: Dict;
  profiles: Dict<RemoteProfileData>;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderMoveCommandsDialog = ({
  data,
  profiles,
  error = "",
  busy = false,
  onAction,
}: MoveCommandsDialogOptions): TemplateResult => {
  const sourceId = String(data.remote_profile_id || "");
  const commandIds = Array.isArray(data.command_ids)
    ? data.command_ids.map(String)
    : [];
  const targetId = String(data.target_remote_profile_id || "");
  const options = Object.entries(profiles)
    .filter(([profileId]) => profileId !== sourceId)
    .map(([profileId, profile]) => {
      const conflicts = commandIds.filter((id) => profile.commands?.[id]);
      return {
        value: profileId,
        label: profile.name || profileId,
        secondary: conflicts.length
          ? `${conflicts.length} command ID conflict${conflicts.length === 1 ? "" : "s"}`
          : undefined,
        disabled: Boolean(conflicts.length),
      };
    });
  const available = options.filter((option) => !option.disabled);
  return renderDialogShell({
    heading: "Move commands",
    description: `${commandIds.length} selected`,
    error,
    busy,
    workflow: "move-commands",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-stack">
        ${available.length
          ? html`<ha-select
              autofocus
              .label=${"Destination remote profile"}
              .value=${targetId}
              .options=${options}
              @selected=${workflowFieldSelected(
                onAction,
                "target_remote_profile_id",
              )}
            ></ha-select>`
          : renderWorkspaceNotice({
              tone: "warning",
              role: "alert",
              icon: "mdi:folder-alert-outline",
              content:
                "No other remote profile can accept this selection without a command ID conflict.",
            })}
        ${renderWorkspaceNotice({
          icon: "mdi:history",
          content:
            "Each command keeps its complete revision history. Moving commands does not merge or duplicate their revisions.",
        })}
        ${!available.length
          ? html`<ha-button
              appearance="outlined"
              variant="neutral"
              @click=${() => onAction({ type: "move-create-profile" })}
            ><ha-icon slot="start" icon="mdi:plus"></ha-icon>Add remote profile</ha-button>`
          : null}
      </div>
    `,
    footer: renderDialogFooter([
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: "Move commands",
        icon: "mdi:folder-move-outline",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !targetId || !available.some(({ value }) => value === targetId),
        onClick: () => onAction({ type: "submit" }),
      },
    ]),
  });
};
