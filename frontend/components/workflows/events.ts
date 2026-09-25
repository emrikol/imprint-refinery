import type { Dict } from "../../types";
import { haControlValue, haSelectedValue } from "../../core/ha-controls";

export type WorkflowAction =
  | { type: "close" }
  | { type: "field-change"; field: string; value: unknown }
  | { type: "submit" }
  | { type: "learn-start" }
  | { type: "learn-retry" }
  | { type: "learn-test" }
  | { type: "learn-optimize" }
  | { type: "learn-copy-code"; code: string }
  | { type: "learn-save"; another: boolean }
  | { type: "learn-duplicate-open"; match: Dict }
  | { type: "learn-duplicate-replace"; match: Dict }
  | { type: "learn-duplicate-ignore" }
  | { type: "learn-catalog-review"; match: Dict }
  | { type: "learn-catalog-review-close" }
  | { type: "move-create-profile" }
  | { type: "catalog-search" }
  | { type: "catalog-mode"; mode: string }
  | { type: "catalog-identify" }
  | { type: "catalog-identify-remove-last" }
  | { type: "catalog-identify-reset" }
  | { type: "catalog-cancel-capture" }
  | { type: "catalog-guided-start" }
  | { type: "catalog-guided-test" }
  | {
      type: "catalog-guided-answer";
      result: "worked" | "no_response" | "not_sure";
    }
  | { type: "catalog-guided-control"; command: "resume" | "cancel" }
  | { type: "catalog-preview"; profile: Dict }
  | { type: "catalog-profile-back" }
  | { type: "catalog-selection-change"; commandId: string; selected: boolean }
  | { type: "catalog-test-command"; command: Dict }
  | {
      type: "catalog-import";
      profile: Dict;
      commandIds: string[];
      mode: "starter" | "selected" | "all";
    }
  | { type: "catalog-create-appliance"; profileId: string }
  | { type: "catalog-assign" }
  | { type: "import-preview" }
  | { type: "import-commands" }
  | { type: "import-file-error"; message: string }
  | { type: "backup-copy"; value: string }
  | { type: "backup-review" }
  | {
      type: "backup-mapping-change";
      applianceId: string;
      field: "area_id" | "infrared_emitter_ref";
      value: string;
    }
  | { type: "backup-restore" };

export type WorkflowActionHandler = (action: WorkflowAction) => void;

export interface WorkflowFieldBindingOptions {
  resetFields?: readonly string[];
}

export const workflowFieldInput =
  (
    onAction: WorkflowActionHandler,
    field: string,
    options: WorkflowFieldBindingOptions = {},
  ): ((event: Event) => void) =>
  (event) => {
    onAction({ type: "field-change", field, value: haControlValue(event) });
    for (const resetField of options.resetFields || []) {
      onAction({ type: "field-change", field: resetField, value: null });
    }
  };

export const workflowFieldSelected =
  (onAction: WorkflowActionHandler, field: string): ((event: Event) => void) =>
  (event) => {
    onAction({ type: "field-change", field, value: haSelectedValue(event) });
  };
