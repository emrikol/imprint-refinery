import { css, html, nothing, type TemplateResult } from "lit";
import { haControlValue, haSelectedValue } from "../../core/ha-controls";
import type { SignalLabState } from "../../core/signal-lab";
import { slugify, validId } from "../../core/utils";
import type { RegistryData } from "../../types";
import { renderDialogFooter, renderDialogShell } from "../shared/dialog";
import type { SignalLabRequest } from "./events";
import "./waveform-comparison";

export interface SignalSaveDialogProps {
  lab: SignalLabState;
  registry: RegistryData;
  busy: boolean;
  valid: boolean;
  error: string;
  request: SignalLabRequest;
}

export const signalSaveDialogStyles = css`
  .signal-save-dialog { --ha-dialog-width-md: 760px; }
  .signal-save-content {
    display: grid;
    gap: 12px;
    min-width: 0;
    container: signal-save-dialog / inline-size;
  }
  .signal-save-dialog .irf-dialog-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 7px;
    width: 100%;
  }
  .signal-save-comparison { padding-block: 10px 4px; }
  @media (max-width: 460px) {
    .signal-save-dialog .irf-dialog-actions { grid-template-columns: 1fr; }
  }
`;

function renderSaveTarget(
  lab: SignalLabState,
  registry: RegistryData,
  request: SignalLabRequest,
): TemplateResult {
  const profiles = Object.entries(registry.remote_profiles || {});
  const hasCurrent = profiles.some(
    ([profileId]) => profileId === lab.remoteProfileId,
  );
  const emptyValue = "__imprint_no_remote_profile__";
  const value = hasCurrent ? lab.remoteProfileId : emptyValue;
  const options = [
    ...(!hasCurrent
      ? [
          {
            value: emptyValue,
            label: "Choose a remote profile",
            disabled: true,
          },
        ]
      : []),
    ...profiles.map(([profileId, profile]) => ({
      value: profileId,
      label: profile.name || profileId,
    })),
  ];
  return html`<ha-select
    label="Remote profile"
    .value=${value}
    .options=${options}
    @selected=${(event: Event) => {
      const selected = haSelectedValue(event);
      request("lab-action", {
        labAction: "target",
        detail: {
          remoteProfileId: selected === emptyValue ? "" : selected,
        },
      });
    }}
  ></ha-select>`;
}

export function renderSignalSaveDialog({
  lab,
  registry,
  busy,
  valid,
  error,
  request,
}: SignalSaveDialogProps): TemplateResult {
  const field = (fieldName: string, value: unknown) =>
    request("lab-action", {
      labAction: "field",
      detail: { field: fieldName, value },
    });
  const changeName = (event: Event) => {
    const value = haControlValue(event);
    request("lab-action", {
      labAction: "field",
      detail: {
        field: "saveName",
        value,
        ...(!lab.idTouched ? { saveId: slugify(value) } : {}),
      },
    });
  };

  return renderDialogShell({
    heading: "Save as new command",
    description:
      "Saving creates a new command. The protected source is never overwritten.",
    error,
    busy,
    className: "signal-save-dialog",
    workflow: "signal-save",
    onClose: () => request("close-save"),
    content: html`<div class="signal-save-content">
      <ha-input
        label="Name"
        autofocus
        placeholder="e.g. Reading light"
        .value=${lab.saveName}
        maxlength="200"
        required
        autoValidate
        pattern=".*[A-Za-z0-9].*"
        .validationMessage=${"Choose a name with at least one letter or number."}
        @input=${changeName}
      ></ha-input>
      <ha-input
        label="Carrier frequency"
        type="number"
        .min=${1}
        .step=${100}
        .value=${String(lab.carrierFrequency)}
        hint="Hz · editable for imported or custom signals; an assumed value was not measured by the receiver."
        @input=${(event: Event) =>
          field("carrierFrequency", Number(haControlValue(event)))}
      ></ha-input>
      ${lab.custom ? renderSaveTarget(lab, registry, request) : nothing}
      ${lab.dirty && lab.original.length
        ? html`<ha-expansion-panel header="Review waveform changes">
            <div class="signal-save-comparison">
              <imprint-waveform-comparison
                .beforeSignal=${{
                  label: "Protected source",
                  timings: lab.original,
                  carrierFrequency: lab.originalCarrierFrequency,
                }}
                .afterSignal=${{
                  label: "New command",
                  timings: lab.timings,
                  carrierFrequency: lab.carrierFrequency,
                }}
                detail-level="summary"
              ></imprint-waveform-comparison>
            </div>
          </ha-expansion-panel>`
        : nothing}
      <ha-expansion-panel header="Advanced">
        <ha-input
          label="Command ID"
          placeholder="reading_light"
          .value=${lab.saveId}
          maxlength="100"
          hint="Used by Home Assistant services and automations."
          @input=${(event: Event) => field("saveId", haControlValue(event))}
        ></ha-input>
      </ha-expansion-panel>
    </div>`,
    footer: renderDialogFooter([
      {
        label: "Copy custom signal",
        icon: "mdi:content-copy",
        disabled: busy,
        onClick: () => request("copy-whole-signal"),
      },
      {
        label: "Save as new command",
        icon: "mdi:content-save-plus-outline",
        variant: "brand",
        appearance: "accent",
        disabled:
          busy ||
          !valid ||
          !lab.saveName.trim() ||
          !validId(lab.saveId) ||
          !lab.remoteProfileId,
        onClick: () =>
          request("lab-action", {
            labAction: "save",
            detail: {
              timings: [...lab.timings],
              carrierFrequency: lab.carrierFrequency,
              frameRoles: [...lab.frameRoles],
            },
          }),
      },
    ]),
  });
}
