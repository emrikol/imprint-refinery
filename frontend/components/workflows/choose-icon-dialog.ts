import { css, html, nothing, type TemplateResult } from "lit";
import { hasHaComponent } from "../../core/ha-components";
import type { Dict } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import type { WorkflowActionHandler } from "./events";
import { workflowFieldInput } from "./events";

export interface ChooseIconDialogOptions {
  data: Dict;
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const chooseIconDialogStyles = css`
  .imprint-icon-choice { display: grid; gap: 16px; min-width: 0; }
  .imprint-icon-preview {
    min-width: 0;
    padding: 14px;
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 14px;
    align-items: center;
    border: 1px solid var(--imprint-line);
    border-radius: 12px;
    background: var(--imprint-surface-2);
  }
  .imprint-icon-preview-symbol {
    width: 56px;
    height: 56px;
    display: grid;
    place-items: center;
    color: var(--imprint-accent);
  }
  .imprint-icon-preview-symbol ha-icon { --mdc-icon-size: 34px; }
  .imprint-icon-preview-copy { min-width: 0; display: grid; gap: 3px; }
  .imprint-icon-preview-copy strong,
  .imprint-icon-preview-copy span { overflow-wrap: anywhere; }
  .imprint-icon-preview-copy span { color: var(--imprint-muted); }
  .imprint-icon-guidance { margin: 0; color: var(--imprint-muted); }
`;

const qualifiedIcon = (value: string): boolean =>
  !value || /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(value);

export const renderChooseIconDialog = ({
  data,
  error = "",
  busy = false,
  onAction,
}: ChooseIconDialogOptions): TemplateResult => {
  const icon = String(data.icon || "").trim();
  const valid = qualifiedIcon(icon);
  return renderDialogShell({
    heading: "Choose icon",
    description: String(data.name || "Command"),
    error,
    busy,
    workflow: "choose-command-icon",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-icon-choice">
        <div class="imprint-icon-preview">
          <span class="imprint-icon-preview-symbol">
            <ha-icon icon=${icon || "mdi:remote"}></ha-icon>
          </span>
          <span class="imprint-icon-preview-copy">
            <strong>${icon ? "Custom icon" : "Default icon"}</strong>
            <span>${icon || "mdi:remote · supplied automatically"}</span>
          </span>
        </div>
        ${hasHaComponent("ha-icon-picker")
          ? html`<ha-icon-picker
              autofocus
              .value=${icon}
              .label=${"Home Assistant icon"}
              .helper=${"Search any icon installed in Home Assistant."}
              .placeholder=${"mdi:remote"}
              @value-changed=${(event: CustomEvent<{ value?: string }>) =>
                onAction({
                  type: "field-change",
                  field: "icon",
                  value: String(event.detail?.value || ""),
                })}
            ></ha-icon-picker>`
          : html`<ha-input
              autofocus
              .label=${"Home Assistant icon"}
              .value=${icon}
              placeholder="mdi:remote"
              @input=${workflowFieldInput(onAction, "icon")}
            ></ha-input>`}
        ${valid
          ? nothing
          : html`<ha-alert alert-type="error" .alertType=${"error"}>
              Enter a qualified Home Assistant icon such as mdi:power.
            </ha-alert>`}
        <p class="imprint-icon-guidance">
          Search across lighting and color, fans, power, media and volume,
          timers, blinds, or playback controls.
        </p>
      </div>
    `,
    footer: renderDialogFooter([
      {
        label: "Use default",
        icon: "mdi:restore",
        disabled: busy || !icon,
        onClick: () =>
          onAction({ type: "field-change", field: "icon", value: "" }),
      },
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: "Save",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !valid,
        onClick: () => onAction({ type: "submit" }),
      },
    ]),
  });
};
