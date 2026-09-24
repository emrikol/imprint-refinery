import { css, html, nothing, type TemplateResult } from "lit";
import type { SignalLabState } from "../../core/signal-lab";
import { formatDuration } from "../../core/utils";
import type { LabPreview } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderFactGrid } from "../shared/metric-grid";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import type { SignalLabRequest } from "./events";
import "./waveform-comparison";

export interface SignalPreviewDialogProps {
  lab: SignalLabState;
  preview: LabPreview;
  busy: boolean;
  error: string;
  request: SignalLabRequest;
}

export const signalPreviewDialogStyles = css`
  .signal-preview-dialog {
    --ha-dialog-width-md: 760px;
  }
  .signal-dialog-content {
    display: grid;
    gap: 16px;
    min-width: 0;
    container: signal-preview-dialog / inline-size;
  }
  .signal-preview-dialog .irf-dialog-actions {
    width: 100%;
  }
  @media (max-width: 420px) {
    .signal-preview-dialog .irf-dialog-actions {
      display: grid;
      grid-template-columns: 1fr;
    }
  }
`;

export function renderSignalPreviewDialog({
  lab,
  preview,
  busy,
  error,
  request,
}: SignalPreviewDialogProps): TemplateResult {
  const carrier = preview.carrierFrequency || lab.carrierFrequency;
  const carrierChanged = carrier !== lab.carrierFrequency;
  return renderDialogShell({
    heading: preview.kind,
    description:
      preview.description ||
      "Review measured changes before applying them to this experiment.",
    error,
    busy,
    className: "signal-preview-dialog",
    workflow: "signal-preview",
    onClose: () => request("cancel-preview"),
    content: html`<div class="signal-dialog-content">
      ${preview.warning
        ? html`<ha-alert .alertType=${"warning"}>${preview.warning}</ha-alert>`
        : nothing}
      <imprint-waveform-comparison
        .beforeSignal=${{
          label: "Current experiment",
          timings: lab.timings,
          carrierFrequency: lab.carrierFrequency,
        }}
        .afterSignal=${{
          label: preview.kind,
          timings: preview.timings,
          carrierFrequency: carrier,
        }}
        detail-level="summary"
      ></imprint-waveform-comparison>
      ${renderFactGrid({
        facts: [
          {
            label: "Largest timing adjustment",
            value: `${formatDuration(preview.maxTimingError)}${preview.maxTimingErrorPercent == null ? "" : ` (${preview.maxTimingErrorPercent.toFixed(1)}%)`}`,
          },
          {
            label: "Frame count delta",
            value: `${preview.frameDelta >= 0 ? "+" : ""}${preview.frameDelta}`,
          },
          {
            label: "Timing basis",
            value: preview.timingBasis || "Current draft",
          },
          {
            label: "Carrier",
            value: `${carrierChanged ? `${(lab.carrierFrequency / 1000).toFixed(1)} → ` : ""}${(
              carrier / 1000
            ).toFixed(1)} kHz`,
          },
          {
            label: "Encode round-trip drift",
            value:
              preview.roundTripChanges == null
                ? "Checked when encoded"
                : `${preview.roundTripChanges} timings`,
          },
          {
            label: "Recognition",
            value:
              preview.recognitionLabel ||
              `${preview.protocol ? `${preview.protocol} · ` : ""}${preview.evidenceClass}`,
          },
          {
            label: "Emitter representation",
            value: preview.compatible ? "Timing values fit" : "Not representable",
          },
        ],
      })}
      ${renderWorkspaceNotice({
        content:
          preview.protocolAlignment
            ? "The decoded command data is unchanged. Test once before saving to confirm the appliance responds as expected."
            : "Recognition describes a pattern. Only a one-shot appliance test confirms behavior.",
      })}
    </div>`,
    footer: renderDialogFooter([
      {
        label: "Cancel",
        disabled: busy,
        onClick: requestDialogClose,
      },
      {
        label: preview.applyLabel || "Apply to experiment",
        variant: "brand",
        appearance: "accent",
        disabled: busy || !preview.compatible,
        onClick: () => request("apply-preview", { preview }),
      },
    ]),
  });
}
