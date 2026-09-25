import {
  draftDirty,
  frameRanges,
  previewImpact,
  snapshot,
  validateDraft,
} from "../core/signal";
import { errorMessage, slugify } from "../core/utils";
import type { CommandData, Dict, LabState, RegistryData } from "../types";

export interface SignalLabHost {
  call(action: string, data?: Dict): Promise<any>;
  run(operation: () => Promise<void>, success?: string): Promise<void>;
  registry(): RegistryData;
  testEmitterRef(): string;
  stateChanged(state: LabState | null): void;
  notify(message: string): void;
  setError(message: string): void;
  copyText(value: string, success?: string): Promise<void>;
  reload(): Promise<void>;
  preserveDraft(state: LabState): void;
  clearDraft(): void;
}

/** Owns the Signal Lab draft, reducer, service orchestration, and timer lifecycle. */
export class SignalLabController {
  private current: LabState | null = null;
  private analysisTimer?: number;
  private analysisSequence = 0;

  constructor(private readonly host: SignalLabHost) {}

  get state(): LabState | null {
    return this.current;
  }

  open(profileId: string, commandId: string, command: CommandData): boolean {
    const timings = command.signal?.timings;
    if (!timings?.length) {
      this.host.setError("This command does not contain editable timing data.");
      return false;
    }
    this.preserveCurrentBeforeReplacing(profileId, commandId, false);
    this.cancelAnalysis();
    const total = timings.reduce((sum, value) => sum + value, 0);
    const storedRoles = Array.isArray(command.source?.frame_roles)
      ? command.source.frame_roles
      : command.analysis?.frame_roles;
    const frameRoles = Array.isArray(storedRoles)
      ? storedRoles.map((role: any) =>
          typeof role === "string"
            ? role
            : String(role?.role || role?.kind || "auto"),
        )
      : [];
    this.setState({
      sourceProfileId: profileId,
      remoteProfileId: profileId,
      commandId,
      sourceName: command.name || commandId,
      sourceRevision: command.current_revision || 0,
      original: [...timings],
      timings: [...timings],
      carrierFrequency: command.signal?.carrier_frequency || 38_000,
      originalCarrierFrequency: command.signal?.carrier_frequency || 38_000,
      carrierSource: command.signal?.carrier_source || "assumed",
      sourceAnalysis: command.analysis || {},
      undo: [],
      redo: [],
      selected: 0,
      selectionStart: 0,
      selectionEnd: 0,
      selectedFrame: 0,
      frameRoles: [...frameRoles],
      originalFrameRoles: [...frameRoles],
      zoom: 1,
      pan: 0,
      cursors: [0, total],
      activeCursor: 0,
      view: "edit",
      detailTab: "timings",
      convertFormat: "pronto",
      binaryDecoderMode: "auto",
      saveOpen: false,
      editingOverlays: false,
      snap: 10,
      boundaryMode: "shift",
      dirty: false,
      saveName: `${command.name || commandId} experiment`,
      saveId: this.uniqueCommandId(profileId, `${commandId}_experiment`),
      idTouched: false,
    });
    return true;
  }

  openCustom(
    profileId: string,
    timings: number[] = [560, 560],
    carrierFrequency = 38_000,
  ): boolean {
    if (!profileId || !this.host.registry().remote_profiles?.[profileId]) {
      this.host.setError("Choose a remote profile before creating a signal.");
      return false;
    }
    if (
      !timings.length ||
      !timings.every(
        (item) => Number.isInteger(item) && item > 0 && item <= 65_535,
      )
    ) {
      this.host.setError("The custom signal timings are not valid.");
      return false;
    }
    this.preserveCurrentBeforeReplacing(profileId, "", true);
    this.cancelAnalysis();
    const total = timings.reduce((sum, value) => sum + value, 0);
    this.setState({
      sourceProfileId: profileId,
      remoteProfileId: profileId,
      commandId: "",
      sourceName: "New custom signal",
      sourceRevision: 0,
      original: [...timings],
      timings: [...timings],
      carrierFrequency,
      originalCarrierFrequency: carrierFrequency,
      carrierSource: "assumed",
      sourceAnalysis: {},
      undo: [],
      redo: [],
      selected: 0,
      selectionStart: 0,
      selectionEnd: 0,
      selectedFrame: 0,
      frameRoles: [],
      originalFrameRoles: [],
      zoom: 1,
      pan: 0,
      cursors: [0, total],
      activeCursor: 0,
      view: "edit",
      detailTab: "timings",
      convertFormat: "pronto",
      binaryDecoderMode: "auto",
      saveOpen: false,
      editingOverlays: false,
      snap: 10,
      boundaryMode: "shift",
      dirty: true,
      custom: true,
      saveName: "New custom signal",
      saveId: this.uniqueCommandId(profileId, "custom_signal"),
      idTouched: false,
    });
    this.scheduleAnalysis();
    return true;
  }

  restore(state: LabState): boolean {
    if (!this.validStoredDraft(state)) return false;
    this.cancelAnalysis();
    this.setState({
      ...state,
      analysisPending: false,
      codeRepresentation: state.codeRepresentation?.loading
        ? undefined
        : state.codeRepresentation,
      leavePrompt: false,
      testCooldownUntil: undefined,
    });
    if (state.dirty) this.scheduleAnalysis();
    return true;
  }

  dispose(): void {
    this.cancelAnalysis();
  }

  /** Apply browser navigation without turning route restoration into a user action. */
  closeForRoute(): void {
    if (this.current?.dirty) {
      this.host.preserveDraft({ ...this.current, leavePrompt: false });
    } else {
      this.host.clearDraft();
    }
    this.close();
  }

  handle(detail: any): void {
    const lab = this.current;
    if (!lab) return;
    switch (detail?.action) {
      case "preview":
        void this.preview(detail);
        break;
      case "rebuild-preview":
        void this.previewProtocolRebuild(detail);
        break;
      case "preview-apply": {
        const timings = detail.timings || lab.preview?.timings;
        if (timings) {
          this.setState({ ...lab, preview: undefined });
          this.commit(
            timings,
            detail.frameRoles || lab.preview?.frameRoles || lab.frameRoles,
            Number(
              detail.carrierFrequency ||
                lab.preview?.carrierFrequency ||
                lab.carrierFrequency,
            ),
          );
        }
        break;
      }
      case "preview-cancel":
        this.setState({ ...lab, preview: undefined });
        break;
      case "undo":
        this.undo(lab);
        break;
      case "redo":
        this.redo(lab);
        break;
      case "reset":
        this.commit(
          [...lab.original],
          [...lab.originalFrameRoles],
          lab.originalCarrierFrequency,
        );
        break;
      case "test":
        void this.test(detail);
        break;
      case "save":
        void this.save(detail);
        break;
      case "leave":
        this.leave();
        break;
      case "discard-leave":
        this.leave(true);
        break;
      case "keep-draft-leave":
        this.leave(false, true);
        break;
      case "target":
        this.setState({
          ...lab,
          remoteProfileId: String(detail.remoteProfileId || ""),
        });
        break;
      case "continue":
        this.setState({ ...lab, leavePrompt: false });
        break;
      case "ui":
        this.setState({ ...lab, ...(detail.patch || {}) });
        break;
      case "view":
        this.setState({ ...lab, view: detail.view });
        break;
      case "zoom":
        this.setState({
          ...lab,
          zoom: Number(detail.zoom),
          ...(detail.pan != null ? { pan: Number(detail.pan) } : {}),
        });
        break;
      case "select":
        this.setState({
          ...lab,
          selected: Number(detail.index),
          selectionStart: Number(detail.selectionStart ?? detail.index),
          selectionEnd: Number(detail.selectionEnd ?? detail.index),
        });
        break;
      case "cursor": {
        const cursors: [number, number] = [...lab.cursors] as [number, number];
        const index = detail.index === 1 ? 1 : 0;
        cursors[index] = Number(detail.time);
        this.setState({ ...lab, cursors, activeCursor: index });
        break;
      }
      case "edge":
        this.handleEdge(lab, detail);
        break;
      case "timing":
        this.updateTiming(lab, detail);
        break;
      case "nudge":
        this.nudgeTiming(lab, detail);
        break;
      case "reset-selected":
        this.resetSelected(lab, detail);
        break;
      case "duplicate-selection":
        this.duplicateSelection(lab, detail);
        break;
      case "delete-selection":
        this.deleteSelection(detail);
        break;
      case "reset-selection":
        this.resetSelection(lab, detail);
        break;
      case "add-pair":
        this.addPair(lab, detail);
        break;
      case "merge":
        this.mergeTimings(lab, detail);
        break;
      case "frame":
        this.frameAction(detail);
        break;
      case "copy":
        void this.copy(detail);
        break;
      case "paste-request":
        void this.paste(detail);
        break;
      case "paste-apply":
        if (Array.isArray(detail.timings)) this.commit(detail.timings);
        break;
      case "clipboard-error":
        this.host.setError(
          String(
            detail.message || "Clipboard access is unavailable on this page.",
          ),
        );
        break;
      case "code-representation":
        void this.loadCodeRepresentation(detail);
        break;
      case "field":
        this.updateField(lab, detail);
        break;
    }
  }

  private setState(state: LabState | null): void {
    this.current = state;
    this.host.stateChanged(state);
  }

  private cancelAnalysis(): void {
    window.clearTimeout(this.analysisTimer);
    this.analysisTimer = undefined;
    this.analysisSequence += 1;
  }

  private uniqueCommandId(profileId: string, base: string): string {
    const commands =
      this.host.registry().remote_profiles?.[profileId]?.commands || {};
    let candidate = slugify(base) || "command";
    let suffix = 2;
    while (commands[candidate]) {
      candidate = `${slugify(base) || "command"}_${suffix++}`;
    }
    return candidate;
  }

  private commit(
    timings: number[],
    frameRoles = this.current?.frameRoles || [],
    carrierFrequency = this.current?.carrierFrequency || 38_000,
  ): void {
    const lab = this.current;
    if (
      !lab ||
      !timings.length ||
      timings.some(
        (value) => !Number.isInteger(value) || value < 1 || value > 65_535,
      )
    ) {
      return;
    }
    const next: LabState = {
      ...lab,
      timings: [...timings],
      frameRoles: [...frameRoles],
      carrierFrequency,
      undo: [...lab.undo, snapshot(lab)].slice(-100),
      redo: [],
    };
    next.dirty = draftDirty(next);
    this.setState(next);
    this.scheduleAnalysis();
  }

  private scheduleAnalysis(): void {
    this.cancelAnalysis();
    const sequence = this.analysisSequence;
    const lab = this.current;
    if (!lab) return;
    if (!lab.dirty) {
      this.setState({
        ...lab,
        draftAnalysis: undefined,
        analysisPending: false,
      });
      return;
    }
    const timings = [...lab.timings];
    const carrierFrequency = lab.carrierFrequency;
    this.setState({ ...lab, draftAnalysis: {}, analysisPending: true });
    this.analysisTimer = window.setTimeout(async () => {
      try {
        const encoded = await this.host.call("encode_signal", {
          timings,
          carrier_frequency: carrierFrequency,
        });
        const analyzed = await this.host.call("analyze_signal", {
          code: encoded.code,
          format: "raw_signed",
          carrier_frequency: carrierFrequency,
        });
        const current = this.current;
        if (
          sequence === this.analysisSequence &&
          current &&
          current.carrierFrequency === carrierFrequency &&
          JSON.stringify(current.timings) === JSON.stringify(timings)
        ) {
          this.setState({
            ...current,
            draftAnalysis: analyzed.analysis || {},
            analysisPending: false,
          });
        }
      } catch {
        const current = this.current;
        if (sequence === this.analysisSequence && current) {
          this.setState({
            ...current,
            draftAnalysis: {},
            analysisPending: false,
          });
        }
      }
    }, 450);
  }

  private async preview(detail: any): Promise<void> {
    const lab = this.current;
    if (!lab || !Array.isArray(detail.timings)) return;
    await this.host.run(async () => {
      let encodedTimings: number[] | null = null;
      let analysis = lab.draftAnalysis || lab.sourceAnalysis;
      let compatible = true;
      try {
        const encoded = await this.host.call("encode_signal", {
          timings: detail.timings,
          carrier_frequency: lab.carrierFrequency,
        });
        const analyzed = await this.host.call("analyze_signal", {
          code: encoded.code,
          format: "raw_signed",
          carrier_frequency: lab.carrierFrequency,
        });
        encodedTimings = analyzed?.signal?.timings || null;
        analysis = analyzed?.analysis || analysis;
      } catch {
        compatible = false;
      }
      const preview = previewImpact(
        detail.kind || "Preview change",
        lab.timings,
        detail.timings,
        encodedTimings,
        analysis,
        detail.warning || "",
      );
      preview.compatible = preview.compatible && compatible;
      preview.description = detail.description;
      preview.timingBasis = detail.timingBasis;
      preview.applyLabel = detail.applyLabel;
      if (this.current === lab) this.setState({ ...lab, preview });
    });
  }

  private async previewProtocolRebuild(detail: any): Promise<void> {
    const lab = this.current;
    if (!lab || !detail.rebuildId) return;
    await this.host.run(async () => {
      const encoded = await this.host.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      const result = await this.host.call("rebuild_signal", {
        code: encoded.code,
        format: "raw_signed",
        carrier_frequency: lab.carrierFrequency,
        rebuild_id: detail.rebuildId,
      });
      const timings = result?.signal?.timings;
      const carrierFrequency = Number(result?.signal?.carrier_frequency || 0);
      if (!Array.isArray(timings) || !timings.length || carrierFrequency < 1) {
        throw new Error("The selected protocol could not rebuild this draft");
      }
      const protocol = String(
        result?.rebuild?.protocol || detail.protocol || "recognized protocol",
      );
      const preview = previewImpact(
        `Align to ${protocol} timing`,
        lab.timings,
        timings,
        timings,
        result.analysis || {},
        "",
      );
      preview.protocol = protocol;
      preview.carrierFrequency = carrierFrequency;
      preview.description = `The decoded command was re-encoded using ${protocol} standard timing. The protected capture is unchanged.`;
      preview.timingBasis = `${protocol} standard timing`;
      preview.applyLabel = `Apply ${protocol} alignment`;
      preview.protocolAlignment = true;
      const interpretationCount = Number(
        result?.rebuild?.equivalent_interpretation_count || 1,
      );
      preview.recognitionLabel =
        interpretationCount > 1
          ? `${protocol} · ${interpretationCount} interpretations agree`
          : `${protocol} · ${preview.evidenceClass}`;
      const roles = result?.analysis?.frame_roles;
      preview.frameRoles = Array.isArray(roles)
        ? roles.map((role: any) =>
            typeof role === "string"
              ? role
              : String(role?.role || role?.kind || "auto"),
          )
        : [];
      if (this.current === lab) this.setState({ ...lab, preview });
    });
  }

  private async test(detail: any = {}): Promise<void> {
    if (this.current && Array.isArray(detail.timings)) {
      this.setState({
        ...this.current,
        timings: [...detail.timings],
        carrierFrequency: Number(
          detail.carrierFrequency || this.current.carrierFrequency,
        ),
      });
    }
    const lab = this.current;
    const emitterRef = this.host.testEmitterRef();
    if (!lab || !emitterRef || (lab.testCooldownUntil || 0) > Date.now())
      return;
    const validation = validateDraft(
      lab.timings,
      lab.carrierFrequency,
      lab.draftAnalysis || lab.sourceAnalysis,
      lab.dirty,
    );
    if (!validation.valid) return;
    await this.host.run(async () => {
      const encoded = await this.host.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      await this.host.call("send_signal", {
        infrared_emitter_ref: emitterRef,
        code: encoded.code,
        format: "raw_signed",
        carrier_frequency: lab.carrierFrequency,
      });
      if (this.current === lab) {
        this.setState({ ...lab, testCooldownUntil: Date.now() + 2_000 });
      }
      this.host.notify("Experiment sent once.");
    });
  }

  private async save(detail: any = {}): Promise<void> {
    if (this.current && Array.isArray(detail.timings)) {
      this.setState({
        ...this.current,
        timings: [...detail.timings],
        carrierFrequency: Number(
          detail.carrierFrequency || this.current.carrierFrequency,
        ),
        frameRoles: [...(detail.frameRoles || this.current.frameRoles)],
      });
    }
    const lab = this.current;
    if (!lab || !lab.saveId || !lab.saveName.trim()) return;
    const profileId = lab.remoteProfileId;
    if (
      this.host.registry().remote_profiles?.[profileId]?.commands?.[lab.saveId]
    ) {
      this.host.setError(`A command with ID “${lab.saveId}” already exists.`);
      return;
    }
    await this.host.run(async () => {
      const encoded = await this.host.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      await this.host.call("store_command", {
        remote_profile_id: profileId,
        command_id: lab.saveId,
        name: lab.saveName.trim(),
        code: encoded.code,
        format: "raw_signed",
        source: {
          type: "signal_lab",
          based_on_command: lab.commandId || null,
          carrier_frequency: lab.carrierFrequency,
          frame_roles: lab.frameRoles,
        },
      });
      this.host.clearDraft();
      this.close();
      await this.host.reload();
      this.host.notify(`Saved ${lab.saveName.trim()}.`);
    });
  }

  private leave(discard = false, keepDraft = false): void {
    const lab = this.current;
    if (!lab) return;
    if (lab.dirty && !discard && !keepDraft) {
      this.setState({ ...lab, leavePrompt: true });
      return;
    }
    if (keepDraft) {
      this.host.preserveDraft({ ...lab, leavePrompt: false });
    } else {
      this.host.clearDraft();
    }
    this.close();
  }

  private validStoredDraft(value: LabState): boolean {
    if (!value || typeof value !== "object") return false;
    if (!value.sourceProfileId || (!value.custom && !value.commandId))
      return false;
    if (!this.host.registry().remote_profiles?.[value.sourceProfileId])
      return false;
    const validTimings = (items: unknown): items is number[] =>
      Array.isArray(items) &&
      items.length > 0 &&
      items.every(
        (item) =>
          Number.isInteger(item) && Number(item) > 0 && Number(item) <= 65_535,
      );
    return validTimings(value.original) && validTimings(value.timings);
  }

  private preserveCurrentBeforeReplacing(
    profileId: string,
    commandId: string,
    custom: boolean,
  ): void {
    const current = this.current;
    if (
      !current?.dirty ||
      (current.sourceProfileId === profileId &&
        Boolean(current.custom) === custom &&
        (custom || current.commandId === commandId))
    )
      return;
    this.host.preserveDraft({ ...current, leavePrompt: false });
  }

  private close(): void {
    this.cancelAnalysis();
    this.setState(null);
  }

  private undo(lab: LabState): void {
    if (!lab.undo.length) return;
    const previous = lab.undo.at(-1)!;
    const next: LabState = {
      ...lab,
      timings: [...previous.timings],
      frameRoles: [...previous.frameRoles],
      carrierFrequency: previous.carrierFrequency,
      undo: lab.undo.slice(0, -1),
      redo: [...lab.redo, snapshot(lab)],
    };
    next.dirty = draftDirty(next);
    this.setState(next);
    this.scheduleAnalysis();
  }

  private redo(lab: LabState): void {
    if (!lab.redo.length) return;
    const nextSnapshot = lab.redo.at(-1)!;
    const next: LabState = {
      ...lab,
      timings: [...nextSnapshot.timings],
      frameRoles: [...nextSnapshot.frameRoles],
      carrierFrequency: nextSnapshot.carrierFrequency,
      redo: lab.redo.slice(0, -1),
      undo: [...lab.undo, snapshot(lab)],
    };
    next.dirty = draftDirty(next);
    this.setState(next);
    this.scheduleAnalysis();
  }

  private updateWithPrevious(
    timings: number[],
    previousTimings: number[],
    frameRoles = this.current?.frameRoles || [],
    previousRoles = this.current?.frameRoles || [],
  ): void {
    const lab = this.current;
    if (!lab) return;
    const next: LabState = {
      ...lab,
      timings: [...timings],
      frameRoles: [...frameRoles],
      undo: [
        ...lab.undo,
        {
          timings: [...previousTimings],
          frameRoles: [...previousRoles],
          carrierFrequency: lab.carrierFrequency,
        },
      ].slice(-100),
      redo: [],
    };
    next.dirty = draftDirty(next);
    this.setState(next);
    this.scheduleAnalysis();
  }

  private frameAction(detail: any): void {
    const lab = this.current;
    if (!lab) return;
    const frames = frameRanges(lab.timings);
    const index = Math.max(
      0,
      Math.min(
        frames.length - 1,
        Number(detail.index ?? lab.selectedFrame) || 0,
      ),
    );
    const frame = frames[index];
    if (detail.operation === "select" && frame) {
      this.setState({
        ...lab,
        selectedFrame: index,
        selected: frame.start,
        selectionStart: frame.start,
        selectionEnd: frame.end - 1,
      });
      return;
    }
    if (detail.operation === "role") {
      const roles = [...lab.frameRoles];
      while (roles.length < frames.length) roles.push("auto");
      roles[index] = detail.role;
      this.updateWithPrevious(lab.timings, lab.timings, roles, lab.frameRoles);
      return;
    }
    if (!frame) return;
    const chunks = frames.map((range) =>
      lab.timings.slice(range.start, range.end),
    );
    const roles = [...lab.frameRoles];
    while (roles.length < frames.length) roles.push("auto");
    if (detail.operation === "move") {
      const target = index + Number(detail.delta);
      if (target < 0 || target >= chunks.length) return;
      const [chunk] = chunks.splice(index, 1);
      chunks.splice(target, 0, chunk);
      const [role] = roles.splice(index, 1);
      roles.splice(target, 0, role);
      this.updateWithPrevious(
        chunks.flat(),
        lab.timings,
        roles,
        lab.frameRoles,
      );
      const current = this.current;
      if (current) this.setState({ ...current, selectedFrame: target });
      return;
    }
    if (detail.operation === "split") {
      const timingIndex = Number(detail.timingIndex);
      if (
        timingIndex % 2 === 0 ||
        timingIndex >= lab.timings.length - 1 ||
        lab.timings[timingIndex] >= 10_000
      ) {
        return;
      }
      const next = [...lab.timings];
      next[timingIndex] = 10_000;
      roles.splice(index + 1, 0, "auto");
      this.updateWithPrevious(next, lab.timings, roles, lab.frameRoles);
      return;
    }
    if (detail.operation === "join" && frame.gapIndex != null) {
      const next = [...lab.timings];
      next[frame.gapIndex] = 560;
      roles.splice(index + 1, 1);
      this.updateWithPrevious(next, lab.timings, roles, lab.frameRoles);
      return;
    }
    if (["duplicate", "expand-repeat"].includes(detail.operation)) {
      chunks.splice(index + 1, 0, [...chunks[index]]);
      roles.splice(index + 1, 0, roles[index]);
      this.updateWithPrevious(
        chunks.flat(),
        lab.timings,
        roles,
        lab.frameRoles,
      );
      return;
    }
    if (detail.operation === "remove" && chunks.length > 1) {
      chunks.splice(index, 1);
      roles.splice(index, 1);
      this.updateWithPrevious(
        chunks.flat(),
        lab.timings,
        roles,
        lab.frameRoles,
      );
      return;
    }
    if (
      detail.operation === "trim-leading" &&
      lab.timings.length > 3 &&
      lab.timings[0] <= 1 &&
      lab.timings[1] >= 10_000
    ) {
      this.commit(lab.timings.slice(2));
    }
    if (
      detail.operation === "trim-trailing" &&
      lab.timings.length > 1 &&
      lab.timings.length % 2 === 0 &&
      lab.timings.at(-1)! >= 10_000
    ) {
      this.commit(lab.timings.slice(0, -1));
    }
  }

  private deleteSelection(detail: any): void {
    const lab = this.current;
    if (!lab) return;
    const start = Math.max(0, Number(detail.start ?? lab.selectionStart));
    const end = Math.min(
      lab.timings.length - 1,
      Number(detail.end ?? lab.selectionEnd),
    );
    if (end - start + 1 >= lab.timings.length || (end - start + 1) % 2) return;
    const next = [...lab.timings];
    next.splice(start, end - start + 1);
    this.commit(next);
  }

  private async copy(detail: any): Promise<void> {
    if (detail.handled) return;
    if (detail.format !== "pronto") {
      if (detail.text) {
        await this.host.copyText(detail.text, "Timing selection copied.");
      }
      if (detail.cut) this.deleteSelection(detail);
      return;
    }
    await this.host.run(async () => {
      const encoded = await this.host.call("encode_signal", {
        timings: detail.timings,
        carrier_frequency: detail.carrierFrequency,
      });
      const converted = await this.host.call("convert_signal", {
        code: encoded.code,
        format: "raw_signed",
        output_format: "pronto",
        carrier_frequency: detail.carrierFrequency,
        name: this.current?.saveName || "signal",
      });
      await this.host.copyText(
        converted.value,
        "Pronto timing selection copied.",
      );
      if (detail.cut) this.deleteSelection(detail);
    });
  }

  private async paste(detail: any): Promise<void> {
    if (!this.current) return;
    await this.host.run(async () => {
      const lab = this.current;
      if (!lab) return;
      const converted = await this.host.call("convert_signal", {
        code: detail.text,
        format: detail.format,
        output_format: "raw_signed",
        carrier_frequency: detail.carrierFrequency || lab.carrierFrequency,
        name: "Pasted signal",
      });
      const analyzed = await this.host.call("analyze_signal", {
        code: converted.value,
        format: "raw_signed",
      });
      const inserted = analyzed?.signal?.timings;
      if (!Array.isArray(inserted) || !inserted.length) {
        throw new Error("The pasted signal did not contain usable timings");
      }
      const next = [...lab.timings];
      next.splice(detail.start, detail.end - detail.start + 1, ...inserted);
      const preview = previewImpact(
        "Paste timing data",
        lab.timings,
        next,
        inserted,
        analyzed.analysis || {},
        "Review mark/space alignment before applying.",
      );
      if (this.current === lab) this.setState({ ...lab, preview });
    });
  }

  private async loadCodeRepresentation(detail: any): Promise<void> {
    const lab = this.current;
    if (!lab) return;
    const key = String(detail.key || "");
    this.setState({
      ...lab,
      codeRepresentation: { key, format: detail.format, loading: true },
    });
    try {
      const encoded = await this.host.call("encode_signal", {
        timings: detail.timings || lab.timings,
        carrier_frequency: detail.carrierFrequency || lab.carrierFrequency,
      });
      const converted = await this.host.call("convert_signal", {
        code: encoded.code,
        format: "raw_signed",
        output_format: detail.format,
        carrier_frequency: detail.carrierFrequency || lab.carrierFrequency,
        name: lab.saveName,
      });
      const current = this.current;
      if (current?.codeRepresentation?.key === key) {
        this.setState({
          ...current,
          codeRepresentation: {
            key,
            format: detail.format,
            value: String(converted.value),
            loading: false,
            lossReport: converted.loss_report,
          },
        });
      }
    } catch (error) {
      const current = this.current;
      if (current?.codeRepresentation?.key === key) {
        this.setState({
          ...current,
          codeRepresentation: {
            key,
            format: detail.format,
            loading: false,
            error: errorMessage(error),
          },
        });
      }
    }
  }

  private handleEdge(lab: LabState, detail: any): void {
    if (detail.phase === "commit") {
      this.updateWithPrevious(detail.timings, detail.baseline);
      return;
    }
    const next: LabState = {
      ...lab,
      timings: [
        ...(detail.phase === "cancel" ? detail.baseline : detail.timings),
      ],
    };
    next.dirty = draftDirty(next);
    this.setState(next);
  }

  private updateTiming(lab: LabState, detail: any): void {
    const timings = [...lab.timings];
    let value = Math.round(Number(detail.value));
    if (lab.snap) value = Math.round(value / lab.snap) * lab.snap;
    timings[Number(detail.index)] = value;
    this.commit(timings);
  }

  private nudgeTiming(lab: LabState, detail: any): void {
    const timings = [...lab.timings];
    const index = Number(detail.index ?? lab.selected);
    timings[index] = Math.max(
      1,
      Math.min(65_535, timings[index] + Number(detail.amount || 0)),
    );
    this.commit(timings);
  }

  private resetSelected(lab: LabState, detail: any): void {
    const index = Number(detail.index ?? lab.selected);
    if (lab.original[index] == null) return;
    const timings = [...lab.timings];
    timings[index] = lab.original[index];
    this.commit(timings);
  }

  private duplicateSelection(lab: LabState, detail: any): void {
    const start = Number(detail.start);
    const end = Number(detail.end);
    const values = lab.timings.slice(start, end + 1);
    if (!values.length || values.length % 2 !== 0) return;
    const timings = [...lab.timings];
    timings.splice(end + 1, 0, ...values);
    this.commit(timings);
  }

  private resetSelection(lab: LabState, detail: any): void {
    const start = Number(detail.start);
    const end = Number(detail.end);
    if (start < 0 || end >= lab.original.length) return;
    const timings = [...lab.timings];
    for (let index = start; index <= end; index += 1) {
      timings[index] = lab.original[index];
    }
    this.commit(timings);
  }

  private addPair(lab: LabState, detail: any): void {
    const at = Math.min(lab.timings.length, Number(detail.after) + 1);
    const timings = [...lab.timings];
    timings.splice(at, 0, 560, 560);
    this.commit(timings);
  }

  private mergeTimings(lab: LabState, detail: any): void {
    const index = Number(detail.index);
    if (index < 0 || index + 2 >= lab.timings.length) return;
    const timings = [...lab.timings];
    timings[index] += timings[index + 2];
    timings.splice(index + 1, 2);
    this.commit(timings);
  }

  private updateField(lab: LabState, detail: any): void {
    if (detail.field === "carrierFrequency") {
      const next: LabState = {
        ...lab,
        carrierFrequency: Number(detail.value),
        undo: [...lab.undo, snapshot(lab)].slice(-100),
        redo: [],
      };
      next.dirty = draftDirty(next);
      this.setState(next);
      this.scheduleAnalysis();
      return;
    }
    this.setState({
      ...lab,
      [detail.field]: detail.value,
      ...(detail.saveId ? { saveId: detail.saveId } : {}),
      ...(detail.field === "saveId" ? { idTouched: true } : {}),
    });
  }
}
