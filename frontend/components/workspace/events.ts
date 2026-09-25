import type { Dict } from "../../types";
import type { BinaryDecoderMode } from "../../core/utils";

export type WorkspaceView =
  "remote_profiles" | "appliances" | "infrared_hardware";

export type InspectorTab = "overview" | "signal" | "code" | "history";

export type RemoteProfileAction =
  | { type: "search-change"; value: string }
  | { type: "test-emitter-change"; emitterRef: string }
  | { type: "add-profile" }
  | { type: "create-custom-signal"; profileId?: string }
  | { type: "find-codes" }
  | { type: "import-signals"; profileId?: string }
  | { type: "backup"; profileId?: string }
  | { type: "learn-command"; profileId: string }
  | { type: "create-appliance"; profileId: string }
  | { type: "manage-appliances" }
  | { type: "edit-profile"; profileId: string }
  | { type: "duplicate-profile"; profileId: string }
  | { type: "delete-profile"; profileId: string }
  | { type: "choose-command-icon"; profileId: string; commandId: string }
  | { type: "start-command-selection"; profileId: string }
  | { type: "cancel-command-selection"; profileId: string }
  | {
      type: "toggle-command-selection";
      profileId: string;
      commandId: string;
      selected: boolean;
    }
  | {
      type: "select-all-commands";
      profileId: string;
      commandIds: string[];
      selected: boolean;
    }
  | {
      type: "move-selected-commands";
      profileId: string;
      commandIds: string[];
    }
  | { type: "open-command"; profileId: string; commandId: string }
  | { type: "test-command"; profileId: string; commandId: string };

export type ApplianceAction =
  | { type: "add-appliance" }
  | { type: "edit-appliance"; applianceId: string }
  | { type: "open-profile"; profileId: string }
  | { type: "delete-appliance"; applianceId: string };

export type InspectorAction =
  | { type: "close" }
  | { type: "tab-change"; tab: InspectorTab }
  | { type: "appliance-change"; applianceId: string }
  | { type: "test-command"; profileId: string; commandId: string }
  | { type: "open-signal-lab"; profileId: string; commandId: string }
  | { type: "edit-command"; profileId: string; commandId: string }
  | { type: "duplicate-command"; profileId: string; commandId: string }
  | { type: "relearn-command"; profileId: string; commandId: string }
  | { type: "delete-command"; profileId: string; commandId: string }
  | { type: "copy-action"; value: string }
  | { type: "copy-entity-id"; value: string }
  | { type: "copy-code"; value: string }
  | { type: "copy-timings"; value: string }
  | { type: "copy-bitstream"; value: string }
  | { type: "binary-mode-change"; mode: BinaryDecoderMode }
  | { type: "signal-navigation"; zoom: number; pan: number }
  | { type: "revision-select"; revision: number; label: string }
  | { type: "revision-label-change"; value: string }
  | {
      type: "save-revision-label";
      profileId: string;
      commandId: string;
      revision: number;
      label: string;
    }
  | {
      type: "compare-revision";
      profileId: string;
      commandId: string;
      revision: number;
      snapshot: Dict;
    }
  | {
      type: "test-revision";
      profileId: string;
      commandId: string;
      revision: number;
      snapshot: Dict;
    }
  | { type: "copy-revision-code"; value: string }
  | {
      type: "export-revision";
      profileId: string;
      commandId: string;
      revision: number;
      record: Dict;
    }
  | { type: "export-command-backup"; profileId: string; commandId: string }
  | {
      type: "code-format-change";
      profileId: string;
      commandId: string;
      format: string;
    }
  | {
      type: "retry-code-format";
      profileId: string;
      commandId: string;
      format: string;
    }
  | {
      type: "restore-revision";
      profileId: string;
      commandId: string;
      revision: number;
      snapshot: Dict;
    };
