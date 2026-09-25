import { html, type TemplateResult } from "lit";
import { applianceTypeOptions } from "../../core/appliance-types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import type { Dict } from "../../types";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";

export interface RemoteProfileDialogOptions {
  heading?: string;
  mode?: "profile" | "duplicate";
  data: Dict;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderRemoteProfileDialog = ({
  heading = "Remote profile",
  mode = "profile",
  data,
  error = "",
  busy = false,
  onAction,
}: RemoteProfileDialogOptions): TemplateResult => {
  const hasName = Boolean(String(data.name || "").trim());
  const ready = hasName && Boolean(data.remote_profile_id);
  return renderDialogShell({
    heading,
    error,
    busy,
    workflow: mode === "duplicate" ? "duplicate-profile" : "remote-profile",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-grid">
        <ha-input
          autofocus
          .label=${"Name"}
          .value=${String(data.name || "")}
          placeholder="e.g. Silkycasters RGBW"
          @input=${workflowFieldInput(onAction, "name")}
        ></ha-input>
        <ha-input
          .label=${"Remote profile ID"}
          .value=${String(data.remote_profile_id || "")}
          .disabled=${Boolean(data.editing)}
          @input=${workflowFieldInput(onAction, "remote_profile_id")}
        ></ha-input>
        ${mode === "profile" ? html`
          <ha-select
            .label=${"Appliance type"}
            .value=${String(data.appliance_type || "generic")}
            .options=${applianceTypeOptions(String(data.appliance_type || "generic"))}
            @selected=${workflowFieldSelected(onAction, "appliance_type")}
          ></ha-select>
        ` : null}
      </div>
    `,
    footer: renderDialogFooter([
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: "Save",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !ready,
        onClick: () => onAction({ type: "submit" }),
      },
    ]),
  });
};
