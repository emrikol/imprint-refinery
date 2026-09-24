import { nothing, type TemplateResult } from "lit";
import type { Dict, RegistryData } from "../../types";
import type { WaveformComparisonSignal } from "../../core/waveform-comparison";
import { dialogStyles } from "../shared/dialog";
import { textareaFallbackStyles } from "../shared/textarea";
import { workspaceEmptyStyles } from "../shared/workspace-empty-state";
import { workspaceNoticeStyles } from "../shared/workspace-notice";
import { renderApplianceDialog } from "./appliance-dialog";
import { backupDialogStyles, renderBackupDialog } from "./backup-dialog";
import { catalogDialogStyles, renderCatalogDialog } from "./catalog-dialog";
import { renderConfirmationDialog } from "./confirmation-dialog";
import {
  chooseIconDialogStyles,
  renderChooseIconDialog,
} from "./choose-icon-dialog";
import { renderCustomSignalDialog } from "./custom-signal-dialog";
import {
  renderEditCommandDialog,
} from "./edit-command-dialog";
import type { WorkflowActionHandler } from "./events";
import {
  importSignalsDialogStyles,
  renderImportSignalsDialog,
} from "./import-signals-dialog";
import {
  learnCommandDialogStyles,
  renderLearnCommandDialog,
} from "./learn-command-dialog";
import { renderMoveCommandsDialog } from "./move-commands-dialog";
import { renderRemoteProfileDialog } from "./remote-profile-dialog";
import { workflowStyles } from "./styles";

export type DialogKind =
  | "profile"
  | "duplicate-profile"
  | "appliance"
  | "learn"
  | "custom-signal"
  | "command"
  | "command-edit"
  | "command-duplicate"
  | "command-icon"
  | "command-move"
  | "import"
  | "catalog"
  | "catalog-complete"
  | "backup"
  | "comparison"
  | "confirm";

export interface DialogState {
  kind: DialogKind;
  title: string;
  data: Dict;
  confirmAction?: string;
  danger?: boolean;
}

export interface WorkflowDialogContext {
  dialog: DialogState | null;
  registry: RegistryData;
  error: string;
  busy: boolean;
  capturing: boolean;
  captureRemaining: number;
  captureTimeout: number;
  testEmitterRef: string;
  onAction: WorkflowActionHandler;
}

export const workflowDialogStyles = [
  dialogStyles,
  textareaFallbackStyles,
  workflowStyles,
  workspaceNoticeStyles,
  workspaceEmptyStyles,
  chooseIconDialogStyles,
  importSignalsDialogStyles,
  catalogDialogStyles,
  backupDialogStyles,
  learnCommandDialogStyles,
];

export const renderWorkflowDialog = ({
  dialog,
  registry,
  error,
  busy,
  capturing,
  captureRemaining,
  captureTimeout,
  testEmitterRef,
  onAction,
}: WorkflowDialogContext): TemplateResult | typeof nothing => {
  if (!dialog || dialog.kind === "command") return nothing;
  const profiles = registry.remote_profiles || {};
  const emitters = registry.infrared_hardware?.emitters || [];
  const receivers = registry.infrared_hardware?.receivers || [];
  if (dialog.kind === "profile" || dialog.kind === "duplicate-profile") {
    return renderRemoteProfileDialog({
      heading: dialog.title,
      mode: dialog.kind === "profile" ? "profile" : "duplicate",
      data: dialog.data,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "appliance") {
    return renderApplianceDialog({
      heading: dialog.title,
      data: dialog.data,
      areas: registry.areas || [],
      profiles,
      emitters,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "learn") {
    return renderLearnCommandDialog({
      data: dialog.data,
      receivers,
      testEmitter: emitters.find((item) => item.ref === testEmitterRef),
      error,
      busy,
      capturing,
      captureRemaining,
      captureTimeout,
      onAction,
    });
  }
  if (dialog.kind === "custom-signal") {
    return renderCustomSignalDialog({
      data: dialog.data,
      profiles,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "command-edit" || dialog.kind === "command-duplicate") {
    return renderEditCommandDialog({
      mode: dialog.kind === "command-duplicate" ? "duplicate" : "edit",
      data: dialog.data,
      profiles,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "command-icon") {
    return renderChooseIconDialog({
      data: dialog.data,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "command-move") {
    return renderMoveCommandsDialog({
      data: dialog.data,
      profiles,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "catalog" || dialog.kind === "catalog-complete") {
    return renderCatalogDialog({
      stage: dialog.kind === "catalog" ? "search" : "complete",
      data: dialog.data,
      appliances: registry.appliances || {},
      emitters: registry.infrared_hardware?.emitters || [],
      receivers: registry.infrared_hardware?.receivers || [],
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "import") {
    return renderImportSignalsDialog({
      data: dialog.data,
      profiles,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "backup") {
    return renderBackupDialog({
      heading: dialog.title,
      data: dialog.data,
      areas: registry.areas || [],
      emitters,
      error,
      busy,
      onAction,
    });
  }
  if (dialog.kind === "comparison") {
    return renderConfirmationDialog({
      heading: dialog.title,
      message: String(dialog.data.text || "Compare the selected revision with the current command."),
      error,
      busy,
      comparisonOnly: true,
      comparison: {
        before: dialog.data.comparison_before as WaveformComparisonSignal,
        after: dialog.data.comparison_after as WaveformComparisonSignal,
      },
      onAction,
    });
  }
  return renderConfirmationDialog({
    heading: dialog.title,
    message: String(dialog.data.text || "This cannot be undone."),
    actionLabel: dialog.confirmAction === "restore-revision"
      ? "Restore"
      : dialog.danger ? "Delete" : "Confirm",
    error,
    busy,
    danger: Boolean(dialog.danger),
    blocked: Boolean(dialog.data.blocked),
    dependentAppliances: Array.isArray(dialog.data.dependent_appliance_names)
      ? dialog.data.dependent_appliance_names.map(String)
      : [],
    comparison: dialog.confirmAction === "restore-revision"
      ? {
          before: dialog.data.comparison_before as WaveformComparisonSignal,
          after: dialog.data.comparison_after as WaveformComparisonSignal,
        }
      : null,
    onAction,
  });
};
