import { html, type TemplateResult } from "lit";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import type { WorkflowActionHandler } from "./events";
import type { WaveformComparisonSignal } from "../../core/waveform-comparison";
import "../signal-lab/waveform-comparison";

export interface ConfirmationDialogOptions {
  heading?: string;
  message?: string;
  actionLabel?: string;
  error?: string;
  busy?: boolean;
  danger?: boolean;
  blocked?: boolean;
  dependentAppliances?: string[];
  comparison?: {
    before: WaveformComparisonSignal;
    after: WaveformComparisonSignal;
  } | null;
  comparisonOnly?: boolean;
  onAction: WorkflowActionHandler;
}

export const renderConfirmationDialog = ({
  heading = "Confirm action",
  message = "This cannot be undone.",
  actionLabel = "Confirm",
  error = "",
  busy = false,
  danger = false,
  blocked = false,
  dependentAppliances = [],
  comparison = null,
  comparisonOnly = false,
  onAction,
}: ConfirmationDialogOptions): TemplateResult => renderDialogShell({
  heading,
  error,
  busy,
  className: comparison ? "revision-restore-dialog" : "",
  workflow: "confirmation",
  onClose: () => onAction({ type: "close" }),
  content: html`
    <p>${message}</p>
    ${comparison
      ? html`<imprint-waveform-comparison
          .beforeSignal=${comparison.before}
          .afterSignal=${comparison.after}
          detail-level=${comparisonOnly ? "full" : "summary"}
        ></imprint-waveform-comparison>`
      : null}
    ${dependentAppliances.length
      ? html`<section aria-labelledby="dependent-appliances-heading">
          <strong id="dependent-appliances-heading">Assigned appliances</strong>
          <ul>
            ${dependentAppliances.map((name) => html`<li>${name}</li>`)}
          </ul>
          <p>Reassign or delete these appliances before deleting this remote profile.</p>
        </section>`
      : null}
  `,
  footer: renderDialogFooter(comparisonOnly
    ? [{ label: "Close", disabled: busy, onClick: requestDialogClose }]
    : [
        { label: "Cancel", disabled: busy, onClick: requestDialogClose },
        {
          label: actionLabel,
          variant: danger ? "danger" : "brand",
          appearance: "accent",
          disabled: busy || blocked,
          onClick: () => onAction({ type: "submit" }),
        },
      ]),
});
