import { html, type TemplateResult } from "lit";
import type {
  AreaSummary,
  Dict,
  InfraredHardwareEntity,
  RemoteProfileData,
} from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import {
  areaOptions,
  emitterOptions,
  remoteProfileOptions,
} from "./options";

export interface ApplianceDialogOptions {
  heading?: string;
  data: Dict;
  areas: AreaSummary[];
  profiles: Dict<RemoteProfileData>;
  emitters: InfraredHardwareEntity[];
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderApplianceDialog = ({
  heading = "Appliance",
  data,
  areas,
  profiles,
  emitters,
  error = "",
  busy = false,
  onAction,
}: ApplianceDialogOptions): TemplateResult => {
  const ready =
    Boolean(String(data.name || "").trim()) &&
    Boolean(data.appliance_id);
  return renderDialogShell({
    heading,
    error,
    busy,
    workflow: "appliance",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-workflow-grid">
        <ha-input autofocus .label=${"Name"} .value=${String(data.name || "")} placeholder="e.g. Living room sconce" @input=${workflowFieldInput(onAction, "name")}></ha-input>
        <ha-input .label=${"Appliance ID"} .value=${String(data.appliance_id || "")} .disabled=${Boolean(data.editing)} @input=${workflowFieldInput(onAction, "appliance_id")}></ha-input>
        <ha-select .label=${"Home Assistant Area"} .value=${String(data.area_id || "")} .options=${areaOptions(areas)} @selected=${workflowFieldSelected(onAction, "area_id")}></ha-select>
        <ha-select .label=${"Remote profile"} .value=${String(data.remote_profile_id || "")} .options=${remoteProfileOptions(profiles, "Choose a remote profile")} @selected=${workflowFieldSelected(onAction, "remote_profile_id")}></ha-select>
        <ha-select .label=${"Preferred IR emitter"} .value=${String(data.infrared_emitter_ref || "")} .options=${emitterOptions(emitters)} @selected=${workflowFieldSelected(onAction, "infrared_emitter_ref")}></ha-select>
        <ha-select .label=${"Home Assistant entity type"} .value=${String(data.preferred_platform || "auto")} .options=${[
          { value: "auto", label: "Automatic" },
          { value: "remote", label: "Remote" },
          { value: "media_player", label: "Media player" },
          { value: "switch", label: "Switch" },
        ]} @selected=${workflowFieldSelected(onAction, "preferred_platform")}></ha-select>
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
