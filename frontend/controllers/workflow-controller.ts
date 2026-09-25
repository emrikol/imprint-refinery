import type { WorkflowAction } from "../components/workflows/events";
import type { DialogState } from "../components/workflows/render";
import { errorMessage, slugify } from "../core/utils";
import type { CommandData, Dict, RegistryData } from "../types";

export interface CustomSignalBootstrap {
  timings?: number[];
  carrierFrequency?: number;
}

export interface WorkflowHost {
  call(action: string, data?: Dict): Promise<any>;
  run(operation: () => Promise<void>, success?: string): Promise<void>;
  registry(): RegistryData;
  testEmitterRef(): string;
  captureTimeout(): number;
  setBusy(busy: boolean): void;
  dialogChanged(dialog: DialogState | null): void;
  capturingChanged(receiverRef: string): void;
  clearInspector(): void;
  clearCommandSelection(): void;
  openCommand(profileId: string, commandId: string): Promise<void>;
  showInspectorHistory(): void;
  changeView(
    view: "remote_profiles" | "appliances",
    selectionId?: string,
  ): void;
  setError(message: string): void;
  copyText(value: string, success?: string): Promise<void>;
  reload(): Promise<void>;
  openCustomSignalDraft?(
    profileId: string,
    bootstrap?: CustomSignalBootstrap,
  ): void;
}

/** Owns temporary workflow state and service orchestration for workspace dialogs. */
export class WorkflowController {
  private current: DialogState | null = null;
  private capturingReceiverRef = "";
  private learnSequence = 0;
  private backupReviewSequence = 0;
  private guidedCooldownTimer?: number;
  private static readonly guidedSessionKey =
    "imprint-refinery.guided-session-id";

  constructor(private readonly host: WorkflowHost) {}

  get dialog(): DialogState | null {
    return this.current;
  }

  get capturing(): boolean {
    return Boolean(this.capturingReceiverRef);
  }

  openProfile(profileId?: string): void {
    const profile = profileId
      ? this.host.registry().remote_profiles?.[profileId]
      : undefined;
    this.setDialog({
      kind: "profile",
      title: profile ? "Edit remote profile" : "Add remote profile",
      data: {
        remote_profile_id: profileId || "",
        name: profile?.name || "",
        appliance_type: profile?.appliance_type || "generic",
        editing: Boolean(profile),
      },
    });
  }

  openDuplicateProfile(profileId: string): void {
    const profile = this.host.registry().remote_profiles?.[profileId];
    this.setDialog({
      kind: "duplicate-profile",
      title: "Duplicate remote profile",
      data: {
        source_id: profileId,
        remote_profile_id: `${profileId}_copy`,
        name: `${profile?.name || profileId} copy`,
      },
    });
  }

  openAppliance(applianceId?: string, remoteProfileId?: string): void {
    const registry = this.host.registry();
    const appliance = applianceId
      ? registry.appliances?.[applianceId]
      : undefined;
    const emitters = registry.infrared_hardware?.emitters || [];
    this.setDialog({
      kind: "appliance",
      title: appliance ? "Edit appliance" : "Add appliance",
      data: {
        appliance_id: applianceId || "",
        name: appliance?.name || "",
        remote_profile_id:
          appliance?.remote_profile_id || remoteProfileId || "",
        infrared_emitter_ref:
          appliance?.infrared_emitter_ref ||
          (emitters.length === 1 ? emitters[0].ref : ""),
        area_id: appliance?.area?.area_id || "",
        preferred_platform: appliance?.preferred_platform || "auto",
        editing: Boolean(appliance),
      },
    });
  }

  openLearn(profileId: string): void {
    this.openLearnSession(profileId);
  }

  private openLearnSession(
    profileId: string,
    commandId = "",
    command?: CommandData,
  ): void {
    const receiver = this.suggestedReceiver(profileId);
    this.setDialog({
      kind: "learn",
      title: "Learn command",
      data: {
        stage: "choose",
        remote_profile_id: profileId,
        infrared_receiver_ref: receiver,
        name: command?.name || "",
        command_id: commandId,
        role: command?.role || "",
        relearn: Boolean(command),
        idTouched: Boolean(command),
      },
    });
  }

  openRelearn(
    profileId: string,
    commandId: string,
    command: CommandData,
  ): void {
    this.openLearnSession(profileId, commandId, command);
  }

  openCustomSignal(profileId = ""): void {
    const targetProfileId = profileId || this.firstProfileId();
    if (!targetProfileId) {
      this.host.setError(
        "Add a remote profile before creating a custom signal.",
      );
      return;
    }
    if (!this.host.openCustomSignalDraft) {
      this.host.setError("Signal Lab is not available in this view.");
      return;
    }
    this.setDialog(null);
    this.host.openCustomSignalDraft(targetProfileId);
  }

  openCommandEdit(profileId: string, commandId: string): void {
    const profile = this.host.registry().remote_profiles?.[profileId];
    const command = profile?.commands?.[commandId];
    if (!profile || !command) return;
    this.setDialog({
      kind: "command-edit",
      title: "Edit command",
      data: {
        remote_profile_id: profileId,
        command_id: commandId,
        name: command.name || commandId,
        icon: command.icon || "",
        role: command.role || "",
        target_remote_profile_id: profileId,
        shared_count: profile.dependent_appliance_ids?.length || 0,
      },
    });
  }

  openDuplicateCommand(profileId: string, commandId: string): void {
    const profiles = this.host.registry().remote_profiles || {};
    const command = profiles[profileId]?.commands?.[commandId];
    if (!command) return;
    const profileIds = Object.keys(profiles);
    const targetProfileId =
      profileIds.find(
        (candidate) =>
          candidate !== profileId &&
          !profiles[candidate]?.commands?.[commandId],
      ) ||
      profileIds.find((candidate) => candidate !== profileId) ||
      profileId;
    this.setDialog({
      kind: "command-duplicate",
      title: "Duplicate command",
      data: {
        remote_profile_id: profileId,
        command_id: commandId,
        name:
          targetProfileId === profileId
            ? `${command.name || commandId} copy`
            : command.name || commandId,
        target_remote_profile_id: targetProfileId,
        target_command_id: this.availableCommandId(targetProfileId, commandId),
        idTouched: false,
      },
    });
  }

  openCommandIcon(profileId: string, commandId: string): void {
    const profile = this.host.registry().remote_profiles?.[profileId];
    const command = profile?.commands?.[commandId];
    if (!profile || !command) return;
    this.setDialog({
      kind: "command-icon",
      title: "Choose icon",
      data: {
        remote_profile_id: profileId,
        command_id: commandId,
        name: command.name || commandId,
        icon: command.icon || "",
        role: command.role || "",
      },
    });
  }

  openMoveCommands(profileId: string, commandIds: string[]): void {
    const profiles = this.host.registry().remote_profiles || {};
    const uniqueIds = [...new Set(commandIds)].filter((commandId) =>
      Boolean(profiles[profileId]?.commands?.[commandId]),
    );
    if (!uniqueIds.length) return;
    const targetProfileId =
      Object.keys(profiles).find(
        (candidate) =>
          candidate !== profileId &&
          uniqueIds.every(
            (commandId) => !profiles[candidate]?.commands?.[commandId],
          ),
      ) || "";
    this.setDialog({
      kind: "command-move",
      title: "Move commands",
      data: {
        remote_profile_id: profileId,
        command_ids: uniqueIds,
        target_remote_profile_id: targetProfileId,
      },
    });
  }

  openCatalog(): void {
    const emitterRef = this.host.testEmitterRef() || this.availableEmitterRef();
    this.setDialog({
      kind: "catalog",
      title: "Find remote codes",
      data: {
        mode: "search",
        category: "",
        brand: "",
        model: "",
        results: [],
        infrared_emitter_ref: emitterRef,
        infrared_receiver_ref: this.suggestedReceiver(""),
        identify_appliance_type: "generic",
        identify_role: "",
        identify_captures: [],
        identify_capture_summaries: [],
        identify_results: [],
        identify_snapshots: [],
      },
    });
    void this.resumeGuidedSession();
  }

  openImport(profileId?: string): void {
    this.setDialog({
      kind: "import",
      title: "Import IR signals",
      data: {
        remote_profile_id: profileId || this.firstProfileId(),
        format: "auto",
        code: "",
        file_name: "",
        preview: null,
      },
    });
  }

  async openBackup(remoteProfileId?: string): Promise<void> {
    this.setDialog({
      kind: "backup",
      title: remoteProfileId ? "Export remote profile" : "Backup & restore",
      data: {
        remote_profile_id: remoteProfileId || "",
        export_value: "",
        restore_value: "",
        restore_file_name: "",
        restore_document: null,
        restore_preview: null,
        restore_mappings: {},
      },
    });
    await this.host.run(async () => {
      const exported = await this.host.call("export_backup", {
        ...(remoteProfileId ? { remote_profile_id: remoteProfileId } : {}),
        include_history: true,
      });
      if (this.current?.kind === "backup") {
        this.setDialog({
          ...this.current,
          data: {
            ...this.current.data,
            export_value: JSON.stringify(exported, null, 2),
          },
        });
      }
    });
  }

  confirmRemove(kind: "profile" | "appliance" | "command", data: Dict): void {
    const copy = {
      profile: {
        title: "Delete remote profile?",
        text: "Deletion is blocked while appliances still use this profile.",
        action: "remove-profile",
      },
      appliance: {
        title: "Delete appliance?",
        text: "The shared remote profile and its commands will be preserved.",
        action: "remove-appliance",
      },
      command: {
        title: "Delete command?",
        text: "This removes the command from every appliance using this remote profile.",
        action: "remove-command",
      },
    }[kind];
    const profileId = String(data.remote_profile_id || "");
    const dependentNames =
      kind === "profile"
        ? (
            this.host.registry().remote_profiles?.[profileId]
              ?.dependent_appliance_ids || []
          ).map(
            (applianceId) =>
              this.host.registry().appliances?.[applianceId]?.name ||
              applianceId,
          )
        : [];
    this.setDialog({
      kind: "confirm",
      title: copy.title,
      data: {
        ...data,
        text: dependentNames.length
          ? "This remote profile cannot be deleted while appliances use it."
          : copy.text,
        blocked: Boolean(dependentNames.length),
        dependent_appliance_names: dependentNames,
      },
      confirmAction: copy.action,
      danger: true,
    });
  }

  confirmRevisionRestore(
    profileId: string,
    commandId: string,
    revision: number,
    snapshot: Dict,
  ): void {
    const command =
      this.host.registry().remote_profiles?.[profileId]?.commands?.[commandId];
    const currentSignal = (command?.signal || {}) as Dict;
    const revisionSignal = (snapshot.signal || {}) as Dict;
    this.setDialog({
      kind: "confirm",
      title: `Restore revision ${revision}?`,
      data: {
        remote_profile_id: profileId,
        command_id: commandId,
        revision_id: revision,
        text: "This preserves history and adds a new revision from the selected snapshot.",
        comparison_before: {
          label: `Current revision ${command?.current_revision || ""}`.trim(),
          timings: Array.isArray(currentSignal.timings)
            ? currentSignal.timings.map(Number)
            : [],
          carrierFrequency:
            Number(currentSignal.carrier_frequency || 0) || null,
        },
        comparison_after: {
          label: `Revision ${revision}`,
          timings: Array.isArray(revisionSignal.timings)
            ? revisionSignal.timings.map(Number)
            : [],
          carrierFrequency:
            Number(revisionSignal.carrier_frequency || 0) || null,
        },
      },
      confirmAction: "restore-revision",
    });
  }

  openRevisionComparison(
    profileId: string,
    commandId: string,
    revision: number,
    snapshot: Dict,
  ): void {
    const command =
      this.host.registry().remote_profiles?.[profileId]?.commands?.[commandId];
    const currentSignal = (command?.signal || {}) as Dict;
    const revisionSignal = (snapshot.signal || {}) as Dict;
    this.setDialog({
      kind: "comparison",
      title: `Revision ${revision} compared with current`,
      data: {
        text: "Both waveforms share one time axis and cursor so timing changes stay aligned.",
        comparison_before: {
          label: `Current revision ${command?.current_revision || ""}`.trim(),
          timings: Array.isArray(currentSignal.timings)
            ? currentSignal.timings.map(Number)
            : [],
          carrierFrequency:
            Number(currentSignal.carrier_frequency || 0) || null,
        },
        comparison_after: {
          label: `Revision ${revision}`,
          timings: Array.isArray(revisionSignal.timings)
            ? revisionSignal.timings.map(Number)
            : [],
          carrierFrequency:
            Number(revisionSignal.carrier_frequency || 0) || null,
        },
      },
    });
  }

  updateField(field: string, value: unknown): void {
    const dialog = this.current;
    if (!dialog) return;
    if (
      dialog.kind === "catalog" &&
      field === "identify_appliance_type" &&
      Array.isArray(dialog.data.identify_captures) &&
      dialog.data.identify_captures.length
    ) {
      return;
    }
    const data = { ...dialog.data, [field]: value };
    if (dialog.kind === "catalog" && field === "identify_appliance_type") {
      data.identify_role = "";
    }
    if (field === "name" && !data.editing && !data.idTouched) {
      if (dialog.kind === "profile") {
        data.remote_profile_id = slugify(String(value));
      }
      if (dialog.kind === "appliance") {
        data.appliance_id = slugify(String(value));
      }
      if (dialog.kind === "learn") {
        data.command_id = slugify(String(value));
      }
    }
    if (
      dialog.kind === "command-duplicate" &&
      field === "target_remote_profile_id" &&
      !data.idTouched
    ) {
      data.target_command_id = this.availableCommandId(
        String(value),
        String(data.command_id),
      );
    }
    if (
      [
        "remote_profile_id",
        "appliance_id",
        "command_id",
        "target_command_id",
      ].includes(field)
    ) {
      data.idTouched = true;
    }
    this.setDialog({ ...dialog, data });
  }

  async close(): Promise<void> {
    const receiver = this.capturingReceiverRef;
    this.learnSequence += 1;
    this.setDialog(null);
    this.host.setBusy(false);
    if (receiver) {
      this.setCapturing("");
      await this.host.call("cancel_capture", {
        infrared_receiver_ref: receiver,
      });
    }
  }

  async dispose(): Promise<void> {
    window.clearTimeout(this.guidedCooldownTimer);
    const receiver = this.capturingReceiverRef;
    if (!receiver) return;
    this.learnSequence += 1;
    this.host.setBusy(false);
    this.setCapturing("");
    await this.host.call("cancel_capture", {
      infrared_receiver_ref: receiver,
    });
  }

  handleAction(detail: WorkflowAction): void {
    if (detail.type === "close") {
      void this.close();
    } else if (detail.type === "field-change") {
      this.updateField(detail.field, detail.value);
    } else if (detail.type === "submit") {
      void this.submit();
    } else if (detail.type === "learn-start" || detail.type === "learn-retry") {
      void this.captureLearn();
    } else if (detail.type === "learn-test") {
      void this.testLearnCapture();
    } else if (detail.type === "learn-optimize") {
      void this.optimizeLearnCapture();
    } else if (detail.type === "learn-copy-code") {
      void this.host.copyText(detail.code, "Captured signal code copied.");
    } else if (detail.type === "learn-save") {
      void this.saveLearnCapture(detail.another);
    } else if (detail.type === "learn-duplicate-open") {
      void this.openLearnDuplicate(detail.match);
    } else if (detail.type === "learn-duplicate-replace") {
      this.replaceLearnDuplicate(detail.match);
    } else if (detail.type === "learn-duplicate-ignore") {
      this.updateField("duplicate_match", null);
    } else if (detail.type === "learn-catalog-review") {
      void this.reviewLearnCatalogMatch(detail.match);
    } else if (detail.type === "learn-catalog-review-close") {
      this.updateField("catalog_match_review", null);
    } else if (detail.type === "move-create-profile") {
      this.setDialog(null);
      this.openProfile();
    } else if (detail.type === "catalog-search") {
      void this.searchCatalog();
    } else if (detail.type === "catalog-mode") {
      this.updateField("mode", detail.mode);
    } else if (detail.type === "catalog-identify") {
      void this.identifyCatalogSignal();
    } else if (detail.type === "catalog-identify-remove-last") {
      this.removeLastCatalogIdentification();
    } else if (detail.type === "catalog-identify-reset") {
      this.resetCatalogIdentification();
    } else if (detail.type === "catalog-cancel-capture") {
      void this.cancelCatalogCapture();
    } else if (detail.type === "catalog-guided-start") {
      void this.startGuidedCatalog();
    } else if (detail.type === "catalog-guided-test") {
      void this.testGuidedCatalog();
    } else if (detail.type === "catalog-guided-answer") {
      void this.answerGuidedCatalog(detail.result);
    } else if (detail.type === "catalog-guided-control") {
      void this.controlGuidedCatalog(detail.command);
    } else if (detail.type === "catalog-preview") {
      void this.previewCatalogProfile(detail.profile);
    } else if (detail.type === "catalog-profile-back") {
      this.closeCatalogProfilePreview();
    } else if (detail.type === "catalog-selection-change") {
      this.changeCatalogSelection(detail.commandId, detail.selected);
    } else if (detail.type === "catalog-test-command") {
      void this.testCatalogCommand(detail.command);
    } else if (detail.type === "catalog-import") {
      void this.importCatalogProfile(
        detail.profile,
        detail.commandIds,
        detail.mode,
      );
    } else if (detail.type === "catalog-create-appliance") {
      const profileId = detail.profileId;
      this.setDialog(null);
      this.openAppliance(undefined, profileId);
    } else if (detail.type === "catalog-assign") {
      void this.assignImportedProfile();
    } else if (detail.type === "import-preview") {
      void this.inspectImport();
    } else if (detail.type === "import-commands") {
      void this.importSignals();
    } else if (detail.type === "import-file-error") {
      this.host.setError(detail.message);
    } else if (detail.type === "backup-copy") {
      void this.host.copyText(detail.value, "Copied Imprint backup.");
    } else if (detail.type === "backup-review") {
      void this.reviewRestore();
    } else if (detail.type === "backup-mapping-change") {
      this.setRestoreMapping(detail.applianceId, detail.field, detail.value);
    } else if (detail.type === "backup-restore") {
      void this.restoreBackup();
    }
  }

  async testCommand(profileId: string, command: CommandData): Promise<void> {
    const emitterRef = this.host.testEmitterRef();
    if (!emitterRef) {
      this.host.setError(
        "Choose a temporary IR emitter to test this remote profile.",
      );
      return;
    }
    await this.host.run(
      async () => {
        await this.host.call("send_signal", {
          infrared_emitter_ref: emitterRef,
          code: command.code,
          format: command.format || "raw_signed",
          ...(command.signal?.carrier_frequency
            ? { carrier_frequency: command.signal.carrier_frequency }
            : {}),
        });
      },
      `Sent ${command.name || "command"} once from ${this.profileName(profileId)}.`,
    );
  }

  private setDialog(dialog: DialogState | null): void {
    this.current = dialog;
    this.host.dialogChanged(dialog);
  }

  private setCapturing(receiverRef: string): void {
    this.capturingReceiverRef = receiverRef;
    this.host.capturingChanged(receiverRef);
  }

  private firstProfileId(): string {
    return Object.keys(this.host.registry().remote_profiles || {})[0] || "";
  }

  private availableEmitterRef(): string {
    const emitters = (
      this.host.registry().infrared_hardware?.emitters || []
    ).filter((item) => item.available);
    return emitters.length === 1 ? emitters[0].ref : "";
  }

  private availableCommandId(profileId: string, preferred: string): string {
    const commands =
      this.host.registry().remote_profiles?.[profileId]?.commands || {};
    if (!commands[preferred]) return preferred;
    const base = `${preferred}_copy`;
    if (!commands[base]) return base;
    let suffix = 2;
    while (commands[`${base}_${suffix}`]) suffix += 1;
    return `${base}_${suffix}`;
  }

  private profileName(profileId?: string | null): string {
    if (!profileId) return "Choose a remote profile";
    return (
      this.host.registry().remote_profiles?.[profileId]?.name ||
      "Missing remote profile"
    );
  }

  private suggestedReceiver(profileId: string): string {
    const registry = this.host.registry();
    const hardware = registry.infrared_hardware;
    const receivers = (hardware?.receivers || []).filter(
      (item) => item.available,
    );
    const emitter = (hardware?.emitters || []).find(
      (item) => item.ref === this.host.testEmitterRef(),
    );
    const receiverForDevice = (deviceId?: string | null) => {
      if (!deviceId) return "";
      const matches = receivers.filter((item) => item.device_id === deviceId);
      return matches.length === 1 ? matches[0].ref : "";
    };
    const selectedMatch = receiverForDevice(emitter?.device_id);
    if (selectedMatch) return selectedMatch;
    const deviceIds = new Set(
      (registry.remote_profiles?.[profileId]?.dependent_appliance_ids || [])
        .map(
          (id) =>
            (hardware?.emitters || []).find(
              (item) =>
                item.ref === registry.appliances?.[id]?.infrared_emitter_ref,
            )?.device_id,
        )
        .filter((id): id is string => Boolean(id)),
    );
    if (deviceIds.size === 1) {
      const assignedMatch = receiverForDevice([...deviceIds][0]);
      if (assignedMatch) return assignedMatch;
    }
    return receivers.length === 1 ? receivers[0].ref : "";
  }

  private async reviewRestore(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "backup") return;
    const restoreValue = String(dialog.data.restore_value || "");
    const sequence = ++this.backupReviewSequence;
    await this.host.run(async () => {
      const document = JSON.parse(restoreValue) as Dict;
      const preview = await this.host.call("inspect_import", {
        code: restoreValue,
        format: "native_json",
        name: "Imprint backup",
      });
      if (
        !document ||
        typeof document !== "object" ||
        preview.format !== "native_json" ||
        !preview.remote_profiles
      )
        throw new Error("This is not an Imprint Refinery backup.");
      const registry = this.host.registry();
      const emitters = registry.infrared_hardware?.emitters || [];
      const onlyEmitter = emitters.length === 1 ? emitters[0].ref : "";
      const mappings: Dict = {};
      for (const [id, appliance] of Object.entries(preview.appliances || {})) {
        const current = registry.appliances?.[id];
        const suggestedArea = String(
          (appliance as Dict).area_name || "",
        ).toLocaleLowerCase();
        const area = registry.areas?.find(
          (item) => item.name.toLocaleLowerCase() === suggestedArea,
        );
        mappings[id] = {
          area_id: current?.area?.area_id || area?.area_id || "",
          infrared_emitter_ref: current?.infrared_emitter_ref || onlyEmitter,
        };
      }
      if (
        sequence !== this.backupReviewSequence ||
        this.current?.kind !== "backup" ||
        String(this.current.data.restore_value || "") !== restoreValue
      )
        return;
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          restore_document: document,
          restore_preview: preview,
          restore_mappings: mappings,
        },
      });
      this.host.setError("");
    });
  }

  private setRestoreMapping(
    applianceId: string,
    field: string,
    value: string,
  ): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "backup") return;
    const mappings = {
      ...((dialog.data.restore_mappings as Dict<Dict>) || {}),
    };
    mappings[applianceId] = {
      ...(mappings[applianceId] || {}),
      [field]: value,
    };
    this.setDialog({
      ...dialog,
      data: { ...dialog.data, restore_mappings: mappings },
    });
  }

  private async restoreBackup(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "backup") return;
    const document = dialog.data.restore_document as Dict | null;
    if (!document) {
      this.host.setError("Review the backup before restoring it.");
      return;
    }
    const preview = (dialog.data.restore_preview || document) as Dict;
    const mappings = (dialog.data.restore_mappings || {}) as Dict<Dict>;
    const applianceIds = Object.keys((preview.appliances as Dict) || {});
    const missingEmitter = applianceIds.find(
      (id) => !String(mappings[id]?.infrared_emitter_ref || ""),
    );
    if (missingEmitter) {
      this.host.setError("Choose an IR emitter for every restored appliance.");
      return;
    }
    await this.host.run(async () => {
      await this.host.call("import_backup", { code: JSON.stringify(document) });
      for (const id of applianceIds) {
        await this.host.call("update_appliance", {
          appliance_id: id,
          area_id: String(mappings[id]?.area_id || ""),
          infrared_emitter_ref: String(
            mappings[id]?.infrared_emitter_ref || "",
          ),
        });
      }
      this.setDialog(null);
      await this.host.reload();
    }, "Backup restored. Review each appliance before using it in automations.");
  }

  private async inspectImport(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "import") return;
    const data = dialog.data;
    await this.host.run(async () => {
      const preview = await this.host.call("inspect_import", {
        code: String(data.code || ""),
        format: String(data.format || "auto"),
        name: "Imported command",
      });
      if (this.current?.kind === "import") {
        this.setDialog({
          ...this.current,
          data: { ...this.current.data, preview },
        });
      }
    });
  }

  private async importSignals(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "import") return;
    const data = dialog.data;
    const preview = data.preview as any;
    const profileId = String(data.remote_profile_id || "");
    const commands = (preview?.commands || []).filter(
      (command: any) => command.compatible !== false,
    );
    if (!profileId || !commands.length) return;
    await this.host.run(
      async () => {
        const existing = new Set(
          Object.keys(
            this.host.registry().remote_profiles?.[profileId]?.commands || {},
          ),
        );
        for (const command of commands) {
          let commandId =
            slugify(String(command.command_id || command.name || "command")) ||
            "command";
          const base = commandId;
          let suffix = 2;
          while (existing.has(commandId)) commandId = `${base}_${suffix++}`;
          existing.add(commandId);
          if (command.native_command) {
            await this.host.call("import_command_backup", {
              remote_profile_id: profileId,
              command_id: commandId,
              payload: command.native_command,
            });
          } else {
            await this.host.call("store_command", {
              remote_profile_id: profileId,
              command_id: commandId,
              name: command.name || commandId,
              code: command.code,
              format: command.format || "raw_signed",
              role: command.role || "",
              source: command.source || {
                type: "import",
                format: preview.format || data.format,
              },
            });
          }
        }
        this.setDialog(null);
        await this.host.reload();
      },
      `Imported ${commands.length} command${commands.length === 1 ? "" : "s"}.`,
    );
  }

  private async searchCatalog(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const data = dialog.data;
    await this.host.run(async () => {
      const result = await this.host.call("catalog_search", {
        category: data.category || "",
        brand: data.brand || "",
        model: data.model || "",
      });
      if (this.current?.kind === "catalog") {
        this.setDialog({
          ...this.current,
          data: {
            ...this.current.data,
            results: result.profiles || [],
            searched: true,
          },
        });
      }
    });
  }

  private guidedSessionId(): string {
    try {
      return (
        window.localStorage.getItem(WorkflowController.guidedSessionKey) || ""
      );
    } catch {
      return "";
    }
  }

  private rememberGuidedSession(sessionId = ""): void {
    try {
      if (sessionId)
        window.localStorage.setItem(
          WorkflowController.guidedSessionKey,
          sessionId,
        );
      else window.localStorage.removeItem(WorkflowController.guidedSessionKey);
    } catch {
      // Storage is optional; the active dialog still owns the session.
    }
  }

  private applyGuidedSession(session: Dict): void {
    if (this.current?.kind !== "catalog") return;
    const status = String(session.status || "");
    const pauseReason = String(session.pause_reason || "");
    const mode =
      status === "completed"
        ? "guided-no-match"
        : status === "cancelled"
          ? "guided-setup"
          : pauseReason === "worked"
            ? "guided-confirm"
            : "guided";
    if (status === "completed" || status === "cancelled")
      this.rememberGuidedSession();
    else this.rememberGuidedSession(String(session.session_id || ""));
    const delay = Math.max(0, Number(session.remaining_delay_seconds || 0));
    window.clearTimeout(this.guidedCooldownTimer);
    if (delay > 0) {
      this.guidedCooldownTimer = window.setTimeout(
        () => {
          if (this.current?.kind !== "catalog") return;
          this.setDialog({
            ...this.current,
            data: { ...this.current.data, guided_cooldown: 0 },
          });
        },
        Math.ceil(delay * 1000),
      );
    }
    this.setDialog({
      ...this.current,
      data: {
        ...this.current.data,
        mode,
        guided_session: session,
        guided_cooldown: delay,
      },
    });
  }

  private async resumeGuidedSession(): Promise<void> {
    const sessionId = this.guidedSessionId();
    if (!sessionId || this.current?.kind !== "catalog") return;
    const openingDialog = this.current;
    try {
      const result = await this.host.call("catalog_guided_control", {
        session_id: sessionId,
        session_action: "status",
      });
      if (this.current === openingDialog)
        this.applyGuidedSession((result?.session || result) as Dict);
    } catch {
      this.rememberGuidedSession();
    }
  }

  private async startGuidedCatalog(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const category = String(dialog.data.category || "").trim();
    const brand = String(dialog.data.brand || "").trim();
    if (!category || !brand) {
      this.host.setError(
        "Choose a category and enter a brand to start guided matching.",
      );
      return;
    }
    await this.host.run(async () => {
      const result = await this.host.call("catalog_guided_start", {
        category,
        brand,
      });
      this.applyGuidedSession((result?.session || result) as Dict);
    });
  }

  private async testGuidedCatalog(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const session = dialog.data.guided_session as Dict | undefined;
    const candidate = session?.current_candidate as Dict | undefined;
    const emitterRef = String(
      dialog.data.infrared_emitter_ref || this.host.testEmitterRef() || "",
    );
    if (!emitterRef) {
      this.host.setError("Choose an IR emitter for the one-shot test.");
      return;
    }
    await this.host.run(async () => {
      const result = await this.host.call("catalog_guided_test", {
        session_id: session?.session_id,
        candidate_id: candidate?.candidate_id,
        infrared_emitter_ref: emitterRef,
      });
      this.applyGuidedSession((result?.session || result) as Dict);
    }, "Test command sent once.");
  }

  private async answerGuidedCatalog(
    resultValue: "worked" | "no_response" | "not_sure",
  ): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const session = dialog.data.guided_session as Dict | undefined;
    const candidate = session?.current_candidate as Dict | undefined;
    await this.host.run(async () => {
      const result = await this.host.call("catalog_guided_answer", {
        session_id: session?.session_id,
        candidate_id: candidate?.candidate_id,
        result: resultValue,
      });
      this.applyGuidedSession((result?.session || result) as Dict);
    });
  }

  private async controlGuidedCatalog(
    command: "resume" | "cancel",
  ): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const session = dialog.data.guided_session as Dict | undefined;
    if (!session?.session_id) return;
    await this.host.run(async () => {
      const result = await this.host.call("catalog_guided_control", {
        session_id: session.session_id,
        session_action: command,
      });
      this.applyGuidedSession((result?.session || result) as Dict);
    });
  }

  private async identifyCatalogSignal(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const receiver = String(dialog.data.infrared_receiver_ref || "");
    if (!receiver) {
      this.host.setError("Choose an IR receiver before identifying a remote.");
      return;
    }
    const previousCaptures = Array.isArray(dialog.data.identify_captures)
      ? (dialog.data.identify_captures as Dict[])
      : [];
    const expectedRole = String(dialog.data.identify_role || "");
    const sequence = ++this.learnSequence;
    this.host.setError("");
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        mode: "identify",
        identifying: true,
        identify_stage: "listening",
      },
    });
    this.host.setBusy(true);
    try {
      this.setCapturing(receiver);
      const captured = await this.host.call("capture_signal", {
        infrared_receiver_ref: receiver,
        timeout: this.host.captureTimeout(),
      });
      this.setCapturing("");
      if (sequence !== this.learnSequence || this.current?.kind !== "catalog")
        return;
      if (!captured.code) throw new Error("No IR code was received");
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          identify_stage: "matching",
        },
      });
      const nextCaptures = [
        ...previousCaptures,
        {
          code: captured.code,
          format: captured.format || "raw_signed",
          role: expectedRole,
          ...(captured.signal?.carrier_frequency
            ? { carrier_frequency: captured.signal.carrier_frequency }
            : {}),
        },
      ];
      const result = await this.host.call("catalog_identify_signals", {
        captures: nextCaptures,
        appliance_type: String(
          dialog.data.identify_appliance_type || "generic",
        ),
        limit: 25,
      });
      if (sequence !== this.learnSequence || this.current?.kind !== "catalog")
        return;
      const snapshot = {
        captures: nextCaptures,
        capture_summaries: result.captures || [],
        results: result.matches || [],
        match_count: Number(result.match_count || 0),
        truncated: Boolean(result.truncated),
      };
      const snapshots = Array.isArray(this.current.data.identify_snapshots)
        ? (this.current.data.identify_snapshots as Dict[])
        : [];
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          mode: "identify",
          identifying: false,
          identify_stage: "idle",
          identify_role: "",
          identify_captures: nextCaptures,
          identify_capture_summaries: snapshot.capture_summaries,
          identify_results: snapshot.results,
          identify_match_count: snapshot.match_count,
          identify_truncated: snapshot.truncated,
          identify_snapshots: [...snapshots, snapshot],
          identified: true,
        },
      });
    } catch (error) {
      if (sequence === this.learnSequence)
        this.host.setError(errorMessage(error));
    } finally {
      if (sequence === this.learnSequence) {
        this.setCapturing("");
        this.host.setBusy(false);
        if (this.current?.kind === "catalog") {
          this.setDialog({
            ...this.current,
            data: {
              ...this.current.data,
              identifying: false,
              identify_stage: "idle",
            },
          });
        }
      }
    }
  }

  private removeLastCatalogIdentification(): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const snapshots = Array.isArray(dialog.data.identify_snapshots)
      ? (dialog.data.identify_snapshots as Dict[])
      : [];
    const remaining = snapshots.slice(0, -1);
    const previous = remaining.at(-1);
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        identify_captures: (previous?.captures as Dict[]) || [],
        identify_capture_summaries:
          (previous?.capture_summaries as Dict[]) || [],
        identify_results: (previous?.results as Dict[]) || [],
        identify_match_count: Number(previous?.match_count || 0),
        identify_truncated: Boolean(previous?.truncated),
        identify_snapshots: remaining,
        identified: Boolean(previous),
      },
    });
  }

  private resetCatalogIdentification(): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        identify_role: "",
        identify_captures: [],
        identify_capture_summaries: [],
        identify_results: [],
        identify_match_count: 0,
        identify_truncated: false,
        identify_snapshots: [],
        identified: false,
      },
    });
  }

  private async cancelCatalogCapture(): Promise<void> {
    const receiver = this.capturingReceiverRef;
    this.learnSequence += 1;
    this.host.setBusy(false);
    this.setCapturing("");
    if (this.current?.kind === "catalog") {
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          identifying: false,
          identify_stage: "idle",
        },
      });
    }
    if (receiver)
      await this.host.call("cancel_capture", {
        infrared_receiver_ref: receiver,
      });
  }

  private async previewCatalogProfile(summary: Dict): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    const returnMode = String(dialog.data.mode || "search");
    await this.host.run(async () => {
      const profile = await this.host.call("catalog_profile", {
        catalog_profile_id: summary.profile_id,
      });
      if (this.current?.kind !== "catalog") return;
      const plan = (profile.import_plan || {}) as Dict;
      const allIds = new Set(
        ((plan.all_command_ids || []) as unknown[]).map(String),
      );
      const starterIds = ((plan.starter_command_ids || []) as unknown[])
        .map(String)
        .filter((commandId) => allIds.has(commandId));
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          mode: "profile",
          preview_return_mode: returnMode,
          selected_profile: profile,
          selected_command_ids: starterIds,
        },
      });
    });
  }

  private closeCatalogProfilePreview(): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog") return;
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        mode: String(dialog.data.preview_return_mode || "search"),
        selected_profile: null,
        selected_command_ids: [],
      },
    });
  }

  private changeCatalogSelection(commandId: string, selected: boolean): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog" || dialog.data.mode !== "profile")
      return;
    const selectedIds = new Set(
      ((dialog.data.selected_command_ids || []) as unknown[]).map(String),
    );
    if (selected) selectedIds.add(commandId);
    else selectedIds.delete(commandId);
    this.setDialog({
      ...dialog,
      data: { ...dialog.data, selected_command_ids: [...selectedIds] },
    });
  }

  private async testCatalogCommand(command: Dict): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog" || dialog.data.mode !== "profile")
      return;
    const emitterRef = String(dialog.data.infrared_emitter_ref || "");
    if (!emitterRef) {
      this.host.setError("Choose an IR emitter for the one-shot test.");
      return;
    }
    if (!command.code) {
      this.host.setError(
        "This catalog command has no compatible signal to test.",
      );
      return;
    }
    await this.host.run(
      async () => {
        const signal = (command.signal || {}) as Dict;
        await this.host.call("send_signal", {
          infrared_emitter_ref: emitterRef,
          code: command.code,
          format: command.format || "raw_signed",
          ...(signal.carrier_frequency
            ? { carrier_frequency: signal.carrier_frequency }
            : {}),
        });
      },
      `Sent ${String(command.name || command.command_id || "command")} once.`,
    );
  }

  private async importCatalogProfile(
    profile: Dict,
    commandIds: string[],
    mode: "starter" | "selected" | "all",
  ): Promise<void> {
    const allowedIds = new Set(commandIds.map(String));
    const commands = ((profile.commands || []) as Dict[]).filter(
      (command) =>
        allowedIds.has(String(command.command_id || "")) &&
        Boolean(command.code) &&
        command.compatible !== false,
    );
    if (!commands.length) {
      this.host.setError("Choose at least one compatible command to import.");
      return;
    }
    const registry = this.host.registry();
    const base = slugify(
      String(profile.name || profile.model || "remote_profile"),
    );
    let profileId = base || "remote_profile";
    let suffix = 2;
    while (registry.remote_profiles?.[profileId]) {
      profileId = `${base}_${suffix++}`;
    }
    await this.host.run(async () => {
      await this.host.call("create_remote_profile", {
        remote_profile_id: profileId,
        name: profile.name || profileId,
        appliance_type: profile.category || "generic",
      });
      for (const command of commands) {
        await this.host.call("store_command", {
          remote_profile_id: profileId,
          command_id: command.command_id,
          name: command.name || command.command_id,
          code: command.code,
          format: command.format || "raw_signed",
          role: command.role || "",
          source: {
            ...((command.source || { type: "catalog" }) as Dict),
            ...((((command.import || {}) as Dict).provenance || {}) as Dict),
            profile_id: profile.profile_id,
            import_mode: mode,
          },
        });
      }
      await this.host.reload();
      this.setDialog({
        kind: "catalog-complete",
        title: "Remote profile imported",
        data: {
          remote_profile_id: profileId,
          remote_profile_name: profile.name || profileId,
          imported_command_count: commands.length,
          appliance_id: "",
        },
      });
    });
  }

  private async assignImportedProfile(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "catalog-complete") return;
    const applianceId = String(dialog.data.appliance_id || "");
    const profileId = String(dialog.data.remote_profile_id || "");
    if (!applianceId || !profileId) return;
    await this.host.run(async () => {
      await this.host.call("update_appliance", {
        appliance_id: applianceId,
        remote_profile_id: profileId,
      });
      this.setDialog(null);
      await this.host.reload();
      this.host.changeView("appliances", applianceId);
    }, "Remote profile assigned to the appliance.");
  }

  private async submit(): Promise<void> {
    const dialog = this.current;
    if (!dialog) return;
    const { kind, data, confirmAction } = dialog;
    if (kind === "confirm") {
      await this.submitConfirmation(data, confirmAction);
      return;
    }
    if (kind === "profile") {
      await this.submitProfile(data);
      return;
    }
    if (kind === "duplicate-profile") {
      await this.submitDuplicateProfile(data);
      return;
    }
    if (kind === "appliance") {
      await this.submitAppliance(data);
      return;
    }
    if (kind === "command-edit") {
      await this.submitCommandEdit(data);
      return;
    }
    if (kind === "command-duplicate") {
      await this.submitDuplicateCommand(data);
      return;
    }
    if (kind === "command-icon") {
      await this.submitCommandIcon(data);
      return;
    }
    if (kind === "command-move") {
      await this.submitMoveCommands(data);
      return;
    }
    if (kind === "learn") await this.captureLearn();
  }

  private async submitConfirmation(
    data: Dict,
    confirmAction?: string,
  ): Promise<void> {
    await this.host.run(
      async () => {
        if (confirmAction === "remove-profile") {
          await this.host.call("remove_remote_profile", {
            remote_profile_id: data.remote_profile_id,
            confirm: true,
          });
        } else if (confirmAction === "remove-appliance") {
          await this.host.call("remove_appliance", {
            appliance_id: data.appliance_id,
            confirm: true,
          });
        } else if (confirmAction === "remove-command") {
          await this.host.call("remove_command", {
            remote_profile_id: data.remote_profile_id,
            command_id: data.command_id,
          });
          this.host.clearInspector();
        } else if (confirmAction === "restore-revision") {
          await this.host.call("restore_revision", {
            remote_profile_id: data.remote_profile_id,
            command_id: data.command_id,
            revision_id: data.revision_id,
          });
        }
        this.setDialog(null);
        await this.host.reload();
        if (confirmAction === "restore-revision") {
          await this.host.openCommand(
            String(data.remote_profile_id),
            String(data.command_id),
          );
          this.host.showInspectorHistory();
        }
      },
      confirmAction === "restore-revision" ? "Revision restored." : "Removed.",
    );
  }

  private async submitProfile(data: Dict): Promise<void> {
    await this.host.run(
      async () => {
        const action = data.editing
          ? "update_remote_profile"
          : "create_remote_profile";
        await this.host.call(action, {
          remote_profile_id: String(data.remote_profile_id),
          name: String(data.name).trim(),
          appliance_type: String(data.appliance_type || "generic"),
        });
        this.setDialog(null);
        this.host.clearInspector();
        await this.host.reload();
      },
      data.editing ? "Remote profile updated." : "Remote profile created.",
    );
  }

  private async submitDuplicateProfile(data: Dict): Promise<void> {
    await this.host.run(async () => {
      await this.host.call("duplicate_remote_profile", {
        remote_profile_id: data.source_id,
        target_remote_profile_id: data.remote_profile_id,
        name: String(data.name).trim(),
      });
      this.setDialog(null);
      await this.host.reload();
    }, "Remote profile duplicated.");
  }

  private async submitAppliance(data: Dict): Promise<void> {
    const multipleEmitters =
      (this.host.registry().infrared_hardware?.emitters || []).length > 1;
    if (!data.editing && multipleEmitters && !data.infrared_emitter_ref) {
      this.host.setError("Choose an IR emitter for this appliance.");
      return;
    }
    await this.host.run(
      async () => {
        const action = data.editing ? "update_appliance" : "create_appliance";
        await this.host.call(action, {
          appliance_id: String(data.appliance_id),
          name: String(data.name).trim(),
          remote_profile_id: String(data.remote_profile_id || ""),
          infrared_emitter_ref: String(data.infrared_emitter_ref || ""),
          area_id: String(data.area_id || ""),
          preferred_platform: String(data.preferred_platform || "auto"),
        });
        this.setDialog(null);
        await this.host.reload();
      },
      data.editing ? "Appliance updated." : "Appliance created.",
    );
  }

  private async submitCommandEdit(data: Dict): Promise<void> {
    await this.host.run(async () => {
      await this.host.call("update_command", {
        remote_profile_id: data.remote_profile_id,
        command_id: data.command_id,
        name: String(data.name).trim(),
        icon: String(data.icon || ""),
        role: String(data.role || ""),
      });
      if (data.target_remote_profile_id !== data.remote_profile_id) {
        await this.host.call("move_command", {
          remote_profile_id: data.remote_profile_id,
          command_id: data.command_id,
          target_remote_profile_id: data.target_remote_profile_id,
        });
      }
      this.setDialog(null);
      const nextProfileId = String(data.target_remote_profile_id);
      const commandId = String(data.command_id);
      await this.host.reload();
      await this.host.openCommand(nextProfileId, commandId);
    }, "Command updated.");
  }

  private async submitDuplicateCommand(data: Dict): Promise<void> {
    await this.host.run(async () => {
      await this.host.call("duplicate_command", {
        remote_profile_id: data.remote_profile_id,
        command_id: data.command_id,
        target_remote_profile_id: data.target_remote_profile_id,
        target_command_id: data.target_command_id,
        name: String(data.name).trim(),
      });
      this.setDialog(null);
      const profileId = String(data.target_remote_profile_id);
      const commandId = String(data.target_command_id);
      await this.host.reload();
      await this.host.openCommand(profileId, commandId);
    }, "Command duplicated.");
  }

  private async submitCommandIcon(data: Dict): Promise<void> {
    await this.host.run(async () => {
      await this.host.call("update_command", {
        remote_profile_id: data.remote_profile_id,
        command_id: data.command_id,
        name: String(data.name).trim(),
        icon: String(data.icon || ""),
        role: String(data.role || ""),
      });
      this.setDialog(null);
      await this.host.reload();
    }, "Command icon updated.");
  }

  private async submitMoveCommands(data: Dict): Promise<void> {
    const sourceId = String(data.remote_profile_id || "");
    const targetId = String(data.target_remote_profile_id || "");
    const commandIds = Array.isArray(data.command_ids)
      ? data.command_ids.map(String)
      : [];
    if (!sourceId || !targetId || !commandIds.length) return;
    await this.host.run(
      async () => {
        for (const commandId of commandIds) {
          await this.host.call("move_command", {
            remote_profile_id: sourceId,
            command_id: commandId,
            target_remote_profile_id: targetId,
          });
        }
        this.setDialog(null);
        this.host.clearInspector();
        this.host.clearCommandSelection();
        await this.host.reload();
      },
      `Moved ${commandIds.length} command${commandIds.length === 1 ? "" : "s"}.`,
    );
  }

  private async captureLearn(): Promise<void> {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "learn") return;
    const receiver = String(dialog.data.infrared_receiver_ref || "");
    if (!receiver) {
      this.host.setError("Choose an IR receiver before learning.");
      return;
    }
    const sequence = ++this.learnSequence;
    this.host.setError("");
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        stage: "waiting",
        capture_error: "",
        preview: null,
        optimized: false,
        original_preview: null,
        original_capture_saved: false,
        analysis_error: "",
        duplicate_match: null,
        catalog_matches: [],
        catalog_match_review: null,
      },
    });
    this.host.setBusy(true);
    try {
      this.setCapturing(receiver);
      const captured = await this.host.call("capture_signal", {
        infrared_receiver_ref: receiver,
        timeout: this.host.captureTimeout(),
      });
      this.setCapturing("");
      if (sequence !== this.learnSequence || this.current?.kind !== "learn") {
        return;
      }
      if (!captured.code) throw new Error("No IR code was received");
      this.setDialog({
        ...this.current,
        data: { ...this.current.data, stage: "preparing" },
      });
      const format = captured.format || "raw_signed";
      const carrierFrequency = captured.signal?.carrier_frequency;
      let analyzed: Dict | null = null;
      let analysisError = "";
      try {
        analyzed = await this.host.call("analyze_signal", {
          code: captured.code,
          format,
          ...(carrierFrequency ? { carrier_frequency: carrierFrequency } : {}),
        });
      } catch (error) {
        analysisError = errorMessage(error);
      }
      if (sequence !== this.learnSequence || this.current?.kind !== "learn") {
        return;
      }
      const preview: Dict = {
        code: captured.code,
        format,
        signal: analyzed?.signal || captured.signal || {},
        analysis: analyzed?.analysis || {},
      };
      let catalogMatches: Dict[] = [];
      try {
        const matched = await this.host.call("catalog_match_signal", {
          code: captured.code,
          format,
          ...(carrierFrequency ? { carrier_frequency: carrierFrequency } : {}),
          limit: 12,
        });
        catalogMatches = Array.isArray(matched.matches)
          ? (matched.matches as Dict[])
          : [];
      } catch {
        // The offline catalog is optional; a capture remains useful without it.
      }
      if (sequence !== this.learnSequence || this.current?.kind !== "learn") {
        return;
      }
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          stage: "review",
          preview,
          analysis_error: analysisError,
          catalog_matches: catalogMatches,
          duplicate_match: this.findLearnDuplicate(preview, this.current.data),
        },
      });
    } catch (error) {
      if (sequence === this.learnSequence && this.current?.kind === "learn") {
        this.setDialog({
          ...this.current,
          data: {
            ...this.current.data,
            stage: "error",
            capture_error: errorMessage(error),
          },
        });
      }
    } finally {
      if (sequence === this.learnSequence) {
        this.setCapturing("");
        this.host.setBusy(false);
      }
    }
  }

  private learnPreview(): Dict | null {
    if (this.current?.kind !== "learn") return null;
    const preview = this.current.data.preview;
    return preview && typeof preview === "object" ? (preview as Dict) : null;
  }

  private findLearnDuplicate(preview: Dict, learn: Dict): Dict | null {
    const analysis = (preview.analysis || {}) as Dict;
    const fingerprints = (analysis.fingerprints || {}) as Dict;
    const normalized = String(fingerprints.normalized_50us || "");
    const exact = String(fingerprints.exact || "");
    if (!normalized && !exact) return null;
    for (const [profileId, profile] of Object.entries(
      this.host.registry().remote_profiles || {},
    )) {
      for (const [commandId, command] of Object.entries(
        profile.commands || {},
      )) {
        if (
          profileId === String(learn.remote_profile_id || "") &&
          commandId === String(learn.command_id || "")
        )
          continue;
        const saved = (command.analysis?.fingerprints || {}) as Dict;
        const matchBasis =
          normalized && normalized === saved.normalized_50us
            ? "normalized_50us"
            : exact && exact === saved.exact
              ? "exact"
              : "";
        if (!matchBasis) continue;
        return {
          remote_profile_id: profileId,
          remote_profile_name: profile.name || profileId,
          command_id: commandId,
          command_name: command.name || commandId,
          match_basis: matchBasis,
        };
      }
    }
    return null;
  }

  private async openLearnDuplicate(match: Dict): Promise<void> {
    const profileId = String(match.remote_profile_id || "");
    const commandId = String(match.command_id || "");
    if (!profileId || !commandId) return;
    this.learnSequence += 1;
    this.setDialog(null);
    await this.host.openCommand(profileId, commandId);
  }

  private replaceLearnDuplicate(match: Dict): void {
    const dialog = this.current;
    if (!dialog || dialog.kind !== "learn") return;
    const profileId = String(match.remote_profile_id || "");
    const commandId = String(match.command_id || "");
    const command =
      this.host.registry().remote_profiles?.[profileId]?.commands?.[commandId];
    if (!profileId || !commandId || !command) return;
    this.setDialog({
      ...dialog,
      data: {
        ...dialog.data,
        remote_profile_id: profileId,
        command_id: commandId,
        name: command.name || match.command_name || commandId,
        role: command.role || "",
        relearn: true,
        idTouched: true,
        duplicate_match: null,
        duplicate_replacement: true,
      },
    });
  }

  private async reviewLearnCatalogMatch(match: Dict): Promise<void> {
    const profile = (match.profile || {}) as Dict;
    const profileId = String(profile.profile_id || match.profile_id || "");
    if (!profileId || this.current?.kind !== "learn") return;
    await this.host.run(async () => {
      const review = await this.host.call("catalog_profile", {
        catalog_profile_id: profileId,
      });
      if (this.current?.kind !== "learn") return;
      this.setDialog({
        ...this.current,
        data: { ...this.current.data, catalog_match_review: review },
      });
    });
  }

  private async testLearnCapture(): Promise<void> {
    const preview = this.learnPreview();
    if (!preview) return;
    const emitterRef = this.host.testEmitterRef();
    if (!emitterRef) {
      this.host.setError(
        "Choose a temporary IR emitter before testing this capture.",
      );
      return;
    }
    const signal = (preview.signal || {}) as Dict;
    await this.host.run(async () => {
      await this.host.call("send_signal", {
        infrared_emitter_ref: emitterRef,
        code: preview.code,
        format: preview.format || "raw_signed",
        ...(signal.carrier_frequency
          ? { carrier_frequency: signal.carrier_frequency }
          : {}),
      });
    }, "Captured signal sent once.");
  }

  private async optimizeLearnCapture(): Promise<void> {
    const dialog = this.current;
    const preview = this.learnPreview();
    if (!dialog || dialog.kind !== "learn" || !preview) return;
    const analysis = (preview.analysis || {}) as Dict;
    const candidate = analysis.single_press_candidate as Dict | undefined;
    const timings = Array.isArray(candidate?.timings)
      ? candidate.timings.map(Number)
      : [];
    if (!timings.length) return;
    const signal = (preview.signal || {}) as Dict;
    await this.host.run(async () => {
      const encoded = await this.host.call("encode_signal", {
        timings,
        carrier_frequency: signal.carrier_frequency || 38000,
      });
      const analyzed = await this.host.call("analyze_signal", {
        code: encoded.code,
        format: "raw_signed",
        carrier_frequency: signal.carrier_frequency || 38000,
      });
      if (this.current?.kind !== "learn") return;
      this.setDialog({
        ...this.current,
        data: {
          ...this.current.data,
          optimized: true,
          original_preview: this.current.data.original_preview || preview,
          original_capture_saved: false,
          preview: {
            code: encoded.code,
            format: "raw_signed",
            signal: analyzed.signal || { ...signal, timings },
            analysis: analyzed.analysis || {},
          },
        },
      });
    });
  }

  private async saveLearnCapture(another: boolean): Promise<void> {
    const dialog = this.current;
    const preview = this.learnPreview();
    if (!dialog || dialog.kind !== "learn" || !preview) return;
    const data = dialog.data;
    const profileId = String(data.remote_profile_id || "");
    const commandId = String(data.command_id || "");
    const name = String(data.name || "").trim();
    if (!profileId || !commandId || !name) return;
    const existing =
      this.host.registry().remote_profiles?.[profileId]?.commands?.[commandId];
    if (existing && !data.relearn && !data.original_capture_saved) {
      this.host.setError(
        "That command ID already exists in this remote profile. Choose another ID.",
      );
      return;
    }
    const signal = (preview.signal || {}) as Dict;
    const originalPreview =
      data.original_preview && typeof data.original_preview === "object"
        ? (data.original_preview as Dict)
        : null;
    let saved = false;
    await this.host.run(
      async () => {
        if (data.optimized && originalPreview && !data.original_capture_saved) {
          const originalSignal = (originalPreview.signal || {}) as Dict;
          await this.host.call("store_command", {
            remote_profile_id: profileId,
            command_id: commandId,
            name,
            code: originalPreview.code,
            format: originalPreview.format || "raw_signed",
            role: data.role || "",
            source: {
              type: "captured_signal",
              infrared_receiver_ref: data.infrared_receiver_ref,
              carrier_frequency: originalSignal.carrier_frequency,
              carrier_source: originalSignal.carrier_source,
              retained_before_single_press_optimization: true,
            },
          });
          if (this.current?.kind === "learn") {
            this.setDialog({
              ...this.current,
              data: { ...this.current.data, original_capture_saved: true },
            });
          }
        }
        await this.host.call("store_command", {
          remote_profile_id: profileId,
          command_id: commandId,
          name,
          code: preview.code,
          format: preview.format || "raw_signed",
          role: data.role || "",
          source: {
            type: data.optimized ? "single_press_optimization" : "learn",
            infrared_receiver_ref: data.infrared_receiver_ref,
            carrier_frequency: signal.carrier_frequency,
            carrier_source: signal.carrier_source,
            ...(data.optimized
              ? { original_capture_retained_as_prior_revision: true }
              : {}),
          },
        });
        await this.host.reload();
        saved = true;
      },
      another
        ? "Command saved. Listening for another."
        : "Command learned and saved.",
    );
    if (!saved) return;
    if (another) this.openLearn(profileId);
    else this.setDialog(null);
  }
}
