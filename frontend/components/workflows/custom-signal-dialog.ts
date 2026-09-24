import { html, type TemplateResult } from "lit";
import type { Dict, RemoteProfileData } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderTextarea } from "../shared/textarea";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import { commandRoleOptions, remoteProfileOptions } from "./options";

export interface CustomSignalDialogOptions {
  data: Dict;
  profiles: Dict<RemoteProfileData>;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderCustomSignalDialog = ({
  data,
  profiles,
  error = "",
  busy = false,
  onAction,
}: CustomSignalDialogOptions): TemplateResult => {
  const ready =
    Boolean(String(data.name || "").trim()) &&
    Boolean(data.remote_profile_id) &&
    Boolean(data.command_id) &&
    Boolean(String(data.code || "").trim());
  return renderDialogShell({
    heading: "Create custom signal",
    description: "Store an encoded signal directly in a reusable remote profile.",
    error,
    busy,
    workflow: "custom-signal",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-grid">
        <ha-select class="imprint-workflow-wide" autofocus .label=${"Remote profile"} .value=${String(data.remote_profile_id || "")} .options=${remoteProfileOptions(profiles)} @selected=${workflowFieldSelected(onAction, "remote_profile_id")}></ha-select>
        <ha-input .label=${"Command name"} .value=${String(data.name || "")} placeholder="e.g. Power on" @input=${workflowFieldInput(onAction, "name")}></ha-input>
        <ha-input .label=${"Command ID"} .value=${String(data.command_id || "")} @input=${workflowFieldInput(onAction, "command_id")}></ha-input>
        <ha-select .label=${"Signal format"} .value=${String(data.format || "raw_signed")} .options=${[
          { value: "raw_signed", label: "Raw signed timings" },
          { value: "pronto", label: "Pronto" },
          { value: "zosung_base64", label: "Zosung base64" },
        ]} @selected=${workflowFieldSelected(onAction, "format")}></ha-select>
        <ha-select .label=${"Command role"} .value=${String(data.role || "")} .options=${commandRoleOptions()} @selected=${workflowFieldSelected(onAction, "role")}></ha-select>
        ${renderTextarea({
          className: "imprint-workflow-wide",
          label: "Signal code",
          value: String(data.code || ""),
          placeholder: "Paste the signal representation",
          onInput: workflowFieldInput(onAction, "code"),
        })}
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
