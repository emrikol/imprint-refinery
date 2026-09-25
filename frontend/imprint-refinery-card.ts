import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import { SignalLabController } from "./controllers/signal-lab-controller";
import { WorkflowController } from "./controllers/workflow-controller";
import { ImprintServices } from "./core/services";
import { REQUIRED_HA_COMPONENTS } from "./core/ha-components";
import { showHomeAssistantToast } from "./core/notifications";
import { buildHomeAssistantUse } from "./core/home-assistant-use";
import { captureTimingState } from "./core/capture-timing";
import { safeCustomElement } from "./core/registration";
import {
  workspaceRouteFromUrl,
  workspaceUrl,
  type WorkspaceRoute,
  type WorkspaceRouteState,
} from "./core/workspace-route";
import {
  copyText as writeClipboard,
  downloadText,
  errorMessage,
  safeFilename,
  type BinaryDecoderMode,
} from "./core/utils";
import { tokens } from "./styles";
import "./components/signal-lab";
import { feedbackStyles, renderFeedback } from "./components/shared/feedback";
import { factGridStyles } from "./components/shared/metric-grid";
import { statusStyles } from "./components/shared/status";
import { workspaceEmptyStyles } from "./components/shared/workspace-empty-state";
import {
  workspaceHeaderStyles,
  renderWorkspaceHeader,
} from "./components/shared/workspace-header";
import { workspaceHeadingStyles } from "./components/shared/workspace-heading";
import {
  renderWorkspaceNotice,
  workspaceNoticeStyles,
} from "./components/shared/workspace-notice";
import {
  appliancesWorkspaceStyles,
  renderAppliancesWorkspace,
} from "./components/workspace/appliances-workspace";
import { applianceCardStyles } from "./components/workspace/appliance-card";
import { commandCardStyles } from "./components/workspace/command-card";
import {
  commandInspectorStyles,
  renderCommandInspector,
} from "./components/workspace/command-inspector";
import { hardwareRowStyles } from "./components/workspace/hardware-row";
import {
  infraredHardwareWorkspaceStyles,
  renderInfraredHardwareWorkspace,
} from "./components/workspace/infrared-hardware-workspace";
import { remoteProfileCardStyles } from "./components/workspace/remote-profile-card";
import {
  remoteProfileWorkspaceStyles,
  renderRemoteProfileWorkspace,
} from "./components/workspace/remote-profile-workspace";
import type {
  ApplianceAction,
  InspectorAction,
  InspectorTab,
  RemoteProfileAction,
  WorkspaceView,
} from "./components/workspace/events";
import type { WorkflowAction } from "./components/workflows/events";
import {
  renderWorkflowDialog,
  workflowDialogStyles,
  type DialogState,
} from "./components/workflows/render";
import type {
  CommandData,
  CommandSelectionState,
  Dict,
  HomeAssistant,
  LabCodeRepresentation,
  LabState,
  RegistryData,
} from "./types";

interface CardConfig extends Dict {
  title?: string;
  workspace?: boolean;
  appliance_id?: string;
  timeout?: number;
}

interface StoredLabDraftEnvelope {
  version: 2;
  drafts: Record<string, LabState>;
  suspendedKey?: string;
}

const VERSION = "0.3.0";
const SIGNAL_LAB_SESSION_KEY = "imprint-refinery:signal-lab-drafts:v2";
const LEGACY_SIGNAL_LAB_SESSION_KEY = "imprint-refinery:signal-lab-draft:v1";
const WORKSPACE_SESSION_KEY = "imprint-refinery:workspace-state:v1";

@safeCustomElement("imprint-refinery-card")
export class ImprintRefineryCard extends LitElement {
  @property({ reflect: true }) presentation: "card" | "panel" = "card";
  private hassValue?: HomeAssistant;
  @property({
    attribute: false,
    hasChanged: (
      _value: HomeAssistant | undefined,
      oldValue: HomeAssistant | undefined,
    ) => oldValue === undefined,
  })
  get hass(): HomeAssistant | undefined {
    return this.hassValue;
  }

  set hass(value: HomeAssistant | undefined) {
    this.hassValue = value;
    if (!value) return;
    if (!this.services) this.services = new ImprintServices(value);
    else this.services.hass = value;
    if (!this.loaded) {
      this.loaded = true;
      this.restoreRoute();
      void this.load();
    }
  }

  @state() private config: CardConfig = {};
  @state() private registry: RegistryData = {
    remote_profiles: {},
    appliances: {},
    infrared_hardware: { emitters: [], receivers: [] },
    areas: [],
  };
  @state() private view: WorkspaceView = "appliances";
  @state() private selectedProfileId = "";
  @state() private selectedApplianceId = "";
  @state() private search = "";
  @state() private loading = true;
  @state() private busy = false;
  @state() private error = "";
  @state() private dialog: DialogState | null = null;
  @state() private inspector: DialogState | null = null;
  @state() private inspectorTab: InspectorTab = "overview";
  @state() private compactInspector = false;
  @state() private testEmitterRef = "";
  @state() private capturePromptActive = false;
  @state() private captureRemaining = 0;
  @state() private lab: LabState | null = null;
  @state() private suspendedLab: LabState | null = null;
  @state() private commandSelection: CommandSelectionState | null = null;
  private storedLabDrafts: Record<string, LabState> = {};
  private suspendedLabKey = "";
  private services?: ImprintServices;
  private loaded = false;
  private readonly labController = new SignalLabController({
    call: (action, data) => {
      if (!this.services) {
        return Promise.reject(new Error("Imprint Refinery is not ready."));
      }
      return this.services.call(action, data);
    },
    run: (operation, success) => this.run(operation, success),
    registry: () => this.registry,
    testEmitterRef: () => this.testEmitterRef,
    stateChanged: (lab) => {
      const previous = this.lab;
      this.lab = lab;
      if (lab) this.storeLabDraft(lab);
      if (
        !this.applyingRoute &&
        this.routeRelevantLabStateChanged(previous, lab)
      ) {
        this.syncWorkspaceRoute(this.labRouteChangeMode(previous, lab));
      }
    },
    notify: (message) => this.notify(message),
    setError: (error) => {
      this.error = error;
    },
    copyText: (value, success) => this.copyText(value, success),
    reload: () => this.load(),
    preserveDraft: (lab) => {
      this.storeLabDraft(lab, true);
    },
    clearDraft: () => {
      if (this.lab) this.clearStoredLabDraft(this.lab);
    },
  });
  private readonly workflowController = new WorkflowController({
    call: (action, data) => {
      if (!this.services) {
        return Promise.reject(new Error("Imprint Refinery is not ready."));
      }
      return this.services.call(action, data);
    },
    run: (operation, success) => this.run(operation, success),
    registry: () => this.registry,
    testEmitterRef: () => this.testEmitterRef,
    captureTimeout: () => Number(this.config.timeout || 60),
    setBusy: (busy) => {
      this.busy = busy;
    },
    dialogChanged: (dialog) => {
      this.dialog = dialog;
    },
    capturingChanged: (receiverRef) => this.setCapturingReceiver(receiverRef),
    clearInspector: () => {
      this.inspector = null;
      this.syncWorkspaceRoute();
    },
    clearCommandSelection: () => {
      this.commandSelection = null;
      this.storeWorkspaceSession();
    },
    openCommand: (profileId, commandId) =>
      this.openCommand(profileId, commandId),
    showInspectorHistory: () => {
      this.setInspectorTab("history");
    },
    changeView: (view, selectionId) => this.changeView(view, selectionId),
    setError: (error) => {
      this.error = error;
    },
    copyText: (value, success) => this.copyText(value, success),
    reload: () => this.load(),
    openCustomSignalDraft: (profileId, bootstrap) => {
      if (
        !this.labController.openCustom(
          profileId,
          bootstrap?.timings,
          bootstrap?.carrierFrequency,
        )
      )
        return;
      this.view = "remote_profiles";
      this.selectedProfileId = profileId;
      this.selectedApplianceId = "";
      this.inspector = null;
      this.syncWorkspaceRoute();
    },
  });
  private sizeObserver?: ResizeObserver;
  private captureTimer?: number;
  private inspectorReturnFocus: HTMLElement | null = null;
  private inspectorCodeSequence = 0;
  private applyingRoute = false;
  private registryLoaded = false;
  private pendingRoute?: WorkspaceRoute;
  private routeApplySequence = 0;
  private storedLabDraftLoaded = false;
  private workspaceSessionLoaded = false;
  private readonly handlePopState = () => {
    this.restoreRoute();
  };

  static styles = [
    tokens,
    ...workflowDialogStyles,
    feedbackStyles,
    factGridStyles,
    statusStyles,
    workspaceEmptyStyles,
    workspaceHeaderStyles,
    workspaceHeadingStyles,
    workspaceNoticeStyles,
    applianceCardStyles,
    appliancesWorkspaceStyles,
    commandCardStyles,
    commandInspectorStyles,
    hardwareRowStyles,
    infraredHardwareWorkspaceStyles,
    remoteProfileCardStyles,
    remoteProfileWorkspaceStyles,
    css`
      :host { display: block; container: imprint-refinery / inline-size; }
      :host([presentation="panel"]) { min-height: 100%; background: var(--primary-background-color, #111); }
      .shell { min-width: 0; color: var(--imprint-text); }
      .panel-shell { min-height: 100%; background: var(--primary-background-color, #111); }
      .app { width: min(1600px, 100%); margin: auto; padding: 16px; display: grid; align-content: start; gap: 18px; }
      :host([presentation="panel"]) .app { min-height: 100%; padding: 0 24px 40px; }
      .loading { min-height: 180px; display: grid; place-items: center; align-content: center; gap: 12px; color: var(--imprint-muted); }
      .compact-card { display: grid; gap: 12px; padding: 16px; }
      .compact-card header { display: grid; gap: 2px; }
      .compact-card h2 { margin: 0; font-size: 19px; line-height: 1.3; }
      .compact-card header span { color: var(--imprint-muted); font-size: 13px; }
      .compact-command-list { display: grid; gap: 6px; }
      .compact-command-row {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        min-height: 48px;
        padding: 4px 4px 4px 10px;
        border: 1px solid var(--imprint-line);
        border-radius: 10px;
        background: var(--imprint-surface-2);
      }
      .compact-command-row > ha-icon { color: var(--imprint-accent); }
      .compact-command-copy { min-width: 0; }
      .compact-command-copy strong,
      .compact-command-copy span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .compact-command-copy span { color: var(--imprint-muted); font-size: 12px; }
      .suspended-draft-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      @container imprint-refinery (max-width: 760px) {
        .app { padding: 14px; gap: 16px; }
        :host([presentation="panel"]) .app { padding: 0 14px 28px; }
      }
    `,
  ];

  setConfig(config: CardConfig) {
    const wasWorkspace = Boolean(this.config.workspace);
    this.config = { ...config };
    this.presentation = config.workspace ? "panel" : "card";
    if (!wasWorkspace && config.workspace && this.loaded) this.restoreRoute();
  }

  getCardSize() {
    return 8;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("popstate", this.handlePopState);
    if (typeof ResizeObserver !== "undefined") {
      this.sizeObserver = new ResizeObserver(([entry]) => {
        if (!entry) return;
        const compact = entry.contentRect.width <= 1200;
        if (compact === this.compactInspector) return;
        this.compactInspector = compact;
      });
      this.sizeObserver.observe(this);
    }
  }

  disconnectedCallback() {
    window.removeEventListener("popstate", this.handlePopState);
    window.clearInterval(this.captureTimer);
    this.captureTimer = undefined;
    this.sizeObserver?.disconnect();
    this.sizeObserver = undefined;
    void this.workflowController.dispose();
    this.labController.dispose();
    super.disconnectedCallback();
  }

  private setCapturingReceiver(receiverRef: string): void {
    window.clearInterval(this.captureTimer);
    this.captureTimer = undefined;
    this.capturePromptActive = false;
    if (!receiverRef) {
      this.captureRemaining = 0;
      return;
    }
    const captureWindow = Math.max(1, Number(this.config.timeout || 60));
    const startedAt = Date.now();
    const updateTiming = (): void => {
      const timing = captureTimingState(startedAt, Date.now(), captureWindow);
      this.capturePromptActive = timing.promptActive;
      this.captureRemaining = timing.remaining;
      if (!timing.expired) return;
      window.clearInterval(this.captureTimer);
      this.captureTimer = undefined;
    };
    updateTiming();
    this.captureTimer = window.setInterval(updateTiming, 250);
  }

  private restoreRoute(): void {
    if (!this.config.workspace) return;
    const url = new URL(window.location.href);
    const route = workspaceRouteFromUrl(url);
    this.pendingRoute = route;
    this.view = route.view;
    this.selectedProfileId =
      route.view === "remote_profiles" ? route.selectionId : "";
    this.selectedApplianceId =
      route.view === "appliances" ? route.selectionId : "";
    if (route.canonicalize) {
      this.writeWorkspaceRoute(route, "replace");
    }
    if (this.registryLoaded) {
      void this.applyWorkspaceRoute(route);
    }
  }

  private routeState(): WorkspaceRouteState {
    if (this.lab) {
      return {
        view: "remote_profiles",
        selectionId: this.lab.sourceProfileId,
        commandId: this.lab.commandId,
        inspectorTab: "overview",
        signalLab: true,
        customSignal: Boolean(this.lab.custom),
        signalLabView: this.lab.view,
        signalLabTab: this.lab.detailTab || "timings",
        binaryDecoderMode: this.lab.binaryDecoderMode || "auto",
        codeFormat: this.lab.convertFormat || "pronto",
        zoom: this.lab.zoom,
        pan: this.lab.pan,
        selectedRevision: 0,
        saveOpen: Boolean(this.lab.saveOpen),
        editingOverlays: Boolean(this.lab.editingOverlays),
      };
    }
    const commandInspector =
      this.inspector?.kind === "command" ? this.inspector : null;
    return {
      view: this.view,
      selectionId: this.selectedProfileId || this.selectedApplianceId,
      commandId: commandInspector
        ? String(commandInspector.data.command_id || "")
        : "",
      inspectorTab: this.inspectorTab,
      signalLab: false,
      customSignal: false,
      signalLabView: "edit",
      signalLabTab: "timings",
      binaryDecoderMode: commandInspector
        ? (commandInspector.data.binary_decoder_mode as BinaryDecoderMode) ||
          "auto"
        : "auto",
      codeFormat: commandInspector
        ? String(commandInspector.data.code_format || "")
        : "",
      zoom: commandInspector
        ? Number(commandInspector.data.signal_zoom || 1)
        : 1,
      pan: commandInspector ? Number(commandInspector.data.signal_pan || 0) : 0,
      selectedRevision: commandInspector
        ? Number(commandInspector.data.revision_selected || 0)
        : 0,
      saveOpen: false,
      editingOverlays: false,
    };
  }

  private writeWorkspaceRoute(
    route: WorkspaceRouteState,
    mode: "push" | "replace" = "push",
  ): void {
    if (!this.config.workspace) return;
    const current = new URL(window.location.href);
    const next = workspaceUrl(current, route);
    const present = `${current.pathname}${current.search}${current.hash}`;
    if (next === present) return;
    window.history[mode === "replace" ? "replaceState" : "pushState"](
      {},
      "",
      next,
    );
  }

  private syncWorkspaceRoute(mode: "push" | "replace" = "push"): void {
    if (this.applyingRoute) return;
    this.writeWorkspaceRoute(this.routeState(), mode);
  }

  private routeRelevantLabStateChanged(
    previous: LabState | null,
    next: LabState | null,
  ): boolean {
    if (!previous || !next) return previous !== next;
    return (
      previous.sourceProfileId !== next.sourceProfileId ||
      previous.commandId !== next.commandId ||
      previous.view !== next.view ||
      (previous.detailTab || "timings") !== (next.detailTab || "timings") ||
      (previous.binaryDecoderMode || "auto") !==
        (next.binaryDecoderMode || "auto") ||
      (previous.convertFormat || "pronto") !==
        (next.convertFormat || "pronto") ||
      previous.zoom !== next.zoom ||
      previous.pan !== next.pan ||
      Boolean(previous.saveOpen) !== Boolean(next.saveOpen) ||
      Boolean(previous.editingOverlays) !== Boolean(next.editingOverlays)
    );
  }

  private labRouteChangeMode(
    previous: LabState | null,
    next: LabState | null,
  ): "push" | "replace" {
    if (!previous || !next) return "push";
    const sameStructuralRoute =
      previous.sourceProfileId === next.sourceProfileId &&
      previous.commandId === next.commandId &&
      previous.view === next.view &&
      (previous.detailTab || "timings") === (next.detailTab || "timings") &&
      (previous.binaryDecoderMode || "auto") ===
        (next.binaryDecoderMode || "auto") &&
      (previous.convertFormat || "pronto") ===
        (next.convertFormat || "pronto") &&
      Boolean(previous.saveOpen) === Boolean(next.saveOpen) &&
      Boolean(previous.editingOverlays) === Boolean(next.editingOverlays);
    return sameStructuralRoute ? "replace" : "push";
  }

  private async applyWorkspaceRoute(route: WorkspaceRoute): Promise<void> {
    const sequence = ++this.routeApplySequence;
    this.pendingRoute = undefined;
    this.applyingRoute = true;
    try {
      this.view = route.view;
      this.selectedProfileId =
        route.view === "remote_profiles" ? route.selectionId : "";
      this.selectedApplianceId =
        route.view === "appliances" ? route.selectionId : "";

      const selectionExists =
        route.view === "remote_profiles"
          ? !route.selectionId ||
            Boolean(this.registry.remote_profiles?.[route.selectionId])
        : route.view === "appliances"
            ? !route.selectionId ||
              Boolean(this.registry.appliances?.[route.selectionId])
          : true;
      if (!selectionExists) {
        this.selectedProfileId = "";
        this.selectedApplianceId = "";
        this.inspector = null;
        if (this.lab) this.labController.closeForRoute();
        if (sequence === this.routeApplySequence) {
          this.writeWorkspaceRoute(this.routeState(), "replace");
        }
        return;
      }

      if (
        route.view !== "remote_profiles" ||
        (!route.commandId && !route.customSignal)
      ) {
        this.inspector = null;
        if (this.lab) this.labController.closeForRoute();
        return;
      }

      const command =
        this.registry.remote_profiles?.[route.selectionId]?.commands?.[
        route.commandId
      ];
      if (!command && !route.customSignal) {
        this.inspector = null;
        if (this.lab) this.labController.closeForRoute();
        if (sequence === this.routeApplySequence) {
          this.writeWorkspaceRoute(this.routeState(), "replace");
        }
        return;
      }

      if (route.signalLab) {
        this.inspector = null;
        const alreadyOpen =
          this.lab?.sourceProfileId === route.selectionId &&
          (route.customSignal
            ? Boolean(this.lab.custom)
            : this.lab.commandId === route.commandId);
        const storedDraftKey = this.labDraftKeyFor(
          route.selectionId,
          route.commandId,
          route.customSignal,
        );
        const storedDraft = this.storedLabDrafts[storedDraftKey];
        const restoredDraft =
          !alreadyOpen && storedDraft
            ? this.labController.restore(storedDraft)
            : false;
        if (restoredDraft) this.activateStoredLabDraft(storedDraftKey);
        const openedDraft =
          alreadyOpen || restoredDraft
            ? true
            : route.customSignal
              ? this.labController.openCustom(route.selectionId)
              : this.labController.open(
                  route.selectionId,
                  route.commandId,
                  command!,
                );
        if (!alreadyOpen && !restoredDraft && !openedDraft) {
          await this.openCommand(
            route.selectionId,
            route.commandId,
            "signal",
            false,
          );
          if (sequence === this.routeApplySequence) {
            this.writeWorkspaceRoute(this.routeState(), "replace");
          }
          return;
        }
        this.labController.handle({
          action: "ui",
          patch: {
            detailTab: route.signalLabTab,
            binaryDecoderMode: route.binaryDecoderMode,
            convertFormat: route.codeFormat || "pronto",
            zoom: route.zoom,
            pan: route.pan,
            saveOpen: route.saveOpen,
            editingOverlays: route.editingOverlays,
          },
        });
        this.labController.handle({
          action: "view",
          view: route.signalLabView,
        });
      } else {
        if (this.lab) this.labController.closeForRoute();
        await this.openCommand(
          route.selectionId,
          route.commandId,
          route.inspectorTab,
          false,
          route.binaryDecoderMode,
          route.codeFormat,
          route.selectedRevision,
          route.zoom,
          route.pan,
        );
      }
    } finally {
      if (sequence === this.routeApplySequence) {
        this.applyingRoute = false;
        void this.focusRouteSelection();
      }
    }
  }

  private changeView(view: WorkspaceView, selectionId = "") {
    const changingProfile =
      view !== "remote_profiles" || this.selectedProfileId !== selectionId;
    this.view = view;
    if (changingProfile) {
      this.inspector = null;
      this.commandSelection = null;
    }
    this.selectedProfileId = view === "remote_profiles" ? selectionId : "";
    this.selectedApplianceId = view === "appliances" ? selectionId : "";
    this.syncWorkspaceRoute();
    void this.focusRouteSelection();
  }

  private async focusRouteSelection() {
    await this.updateComplete;
    const selected =
      this.view === "remote_profiles"
        ? this.selectedProfileId
        : this.selectedApplianceId;
    if (!selected || this.view === "infrared_hardware") return;
    const attribute =
      this.view === "remote_profiles" ? "data-profile-id" : "data-appliance-id";
    const escaped =
      typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(selected)
      : selected.replaceAll('"', '\\"');
    const target = this.renderRoot.querySelector<HTMLElement>(
      `[${attribute}="${escaped}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
    target?.focus({ preventScroll: true });
  }

  private labDraftKeyFor(
    profileId: string,
    commandId: string,
    custom: boolean,
  ): string {
    return JSON.stringify([profileId, custom ? "new" : commandId]);
  }

  private labDraftKey(lab: LabState): string {
    return this.labDraftKeyFor(
      lab.sourceProfileId,
      lab.commandId,
      Boolean(lab.custom),
    );
  }

  private writeStoredLabDrafts(): void {
    try {
      if (Object.keys(this.storedLabDrafts).length) {
        const envelope: StoredLabDraftEnvelope = {
          version: 2,
          drafts: this.storedLabDrafts,
          ...(this.suspendedLabKey
            ? { suspendedKey: this.suspendedLabKey }
            : {}),
        };
        window.sessionStorage.setItem(
          SIGNAL_LAB_SESSION_KEY,
          JSON.stringify(envelope),
        );
      } else {
        window.sessionStorage.removeItem(SIGNAL_LAB_SESSION_KEY);
      }
      window.sessionStorage.removeItem(LEGACY_SIGNAL_LAB_SESSION_KEY);
    } catch {
      // Signal Lab remains usable when browser storage is unavailable.
    }
  }

  private storeLabDraft(lab: LabState, suspended = false): void {
    const key = this.labDraftKey(lab);
    this.storedLabDrafts = { ...this.storedLabDrafts, [key]: lab };
    if (suspended) {
      this.suspendedLabKey = key;
      this.suspendedLab = lab;
    }
    this.writeStoredLabDrafts();
  }

  private storeWorkspaceSession(): void {
    if (!this.config.workspace) return;
    try {
      window.sessionStorage.setItem(
        WORKSPACE_SESSION_KEY,
        JSON.stringify({
          search: this.search,
          commandSelection: this.commandSelection,
        }),
      );
    } catch {
      // Workspace state remains usable when browser storage is unavailable.
    }
  }

  private loadWorkspaceSession(): void {
    if (this.workspaceSessionLoaded || !this.config.workspace) return;
    this.workspaceSessionLoaded = true;
    try {
      const raw = window.sessionStorage.getItem(WORKSPACE_SESSION_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as {
        search?: unknown;
        commandSelection?: CommandSelectionState | null;
      };
      this.search = typeof stored.search === "string" ? stored.search : "";
      const selection = stored.commandSelection;
      const profile = selection
        ? this.registry.remote_profiles?.[selection.remoteProfileId]
        : undefined;
      if (selection && profile && Array.isArray(selection.commandIds)) {
        const commandIds = selection.commandIds.filter((id) =>
          Boolean(profile.commands?.[id]),
        );
        this.commandSelection = {
          remoteProfileId: selection.remoteProfileId,
          commandIds,
        };
      }
    } catch {
      try {
        window.sessionStorage.removeItem(WORKSPACE_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
    }
  }

  private loadStoredLabDraft(): void {
    if (this.storedLabDraftLoaded || !this.config.workspace) return;
    this.storedLabDraftLoaded = true;
    try {
      const raw =
        window.sessionStorage.getItem(SIGNAL_LAB_SESSION_KEY) ||
        window.sessionStorage.getItem(LEGACY_SIGNAL_LAB_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredLabDraftEnvelope | LabState;
      if (
        "version" in parsed &&
        parsed.version === 2 &&
        parsed.drafts &&
        typeof parsed.drafts === "object"
      ) {
        this.storedLabDrafts = parsed.drafts;
        this.suspendedLabKey = String(parsed.suspendedKey || "");
        this.suspendedLab = this.storedLabDrafts[this.suspendedLabKey] || null;
        return;
      }
      const legacy = parsed as LabState;
      if (!this.validStoredLabShape(legacy))
        throw new Error("Invalid Signal Lab draft");
      const key = this.labDraftKey(legacy);
      this.storedLabDrafts = { [key]: legacy };
      this.suspendedLabKey = key;
      this.suspendedLab = legacy;
      this.writeStoredLabDrafts();
    } catch {
      try {
        window.sessionStorage.removeItem(SIGNAL_LAB_SESSION_KEY);
        window.sessionStorage.removeItem(LEGACY_SIGNAL_LAB_SESSION_KEY);
      } catch {
        // Ignore unavailable browser storage.
      }
    }
  }

  private validStoredLabShape(lab: LabState): boolean {
    return Boolean(
      lab &&
      typeof lab === "object" &&
      Array.isArray(lab.original) &&
      Array.isArray(lab.timings) &&
      lab.original.length > 0 &&
      lab.timings.length > 0,
    );
  }

  private activateStoredLabDraft(key: string): void {
    if (this.suspendedLabKey !== key) return;
    this.suspendedLabKey = "";
    this.suspendedLab = null;
    this.writeStoredLabDrafts();
  }

  private clearStoredLabDraft(lab: LabState | null = this.suspendedLab): void {
    if (!lab) return;
    const key = this.labDraftKey(lab);
    const { [key]: _removed, ...remaining } = this.storedLabDrafts;
    this.storedLabDrafts = remaining;
    if (this.suspendedLabKey === key) {
      this.suspendedLabKey = "";
      this.suspendedLab = null;
    }
    this.writeStoredLabDrafts();
  }

  private resumeStoredLabDraft(): void {
    const lab = this.suspendedLab;
    if (!lab || !this.labController.restore(lab)) {
      this.clearStoredLabDraft(lab);
      this.error = "The saved Signal Lab draft could not be resumed.";
      return;
    }
    this.activateStoredLabDraft(this.labDraftKey(lab));
    this.view = "remote_profiles";
    this.selectedProfileId = lab.sourceProfileId;
    this.selectedApplianceId = "";
    this.inspector = null;
    this.syncWorkspaceRoute();
  }

  private async load() {
    if (!this.services) return;
    this.loading = true;
    try {
      this.registry = await this.services.call("get_library");
      this.registryLoaded = true;
      this.error = "";
      const emitters = this.registry.infrared_hardware?.emitters || [];
      if (!emitters.some((item) => item.ref === this.testEmitterRef)) {
        this.testEmitterRef = emitters.length === 1 ? emitters[0].ref : "";
      }
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.loading = false;
      this.loadWorkspaceSession();
      this.loadStoredLabDraft();
      const route = this.pendingRoute;
      if (route && this.registryLoaded) await this.applyWorkspaceRoute(route);
      else void this.focusRouteSelection();
    }
  }

  private async run(operation: () => Promise<void>, success?: string) {
    this.busy = true;
    this.error = "";
    try {
      await operation();
      if (success) this.notify(success);
    } catch (error) {
      this.error = errorMessage(error);
    } finally {
      this.busy = false;
    }
  }

  private profiles() {
    return Object.entries(this.registry.remote_profiles || {}).filter(
      ([id, profile]) => {
        const needle = this.search.trim().toLocaleLowerCase();
        if (!needle) return true;
        return [
          id,
          profile.name,
          ...Object.values(profile.commands || {}).map((item) => item.name),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle);
      },
    );
  }

  private emitters() {
    return this.registry.infrared_hardware?.emitters || [];
  }

  private receivers() {
    return this.registry.infrared_hardware?.receivers || [];
  }

  private emitter(ref?: string | null) {
    return this.emitters().find((item) => item.ref === ref);
  }

  private async openCommand(
    profileId: string,
    commandId: string,
    tab?: InspectorTab,
    navigate = true,
    binaryMode?: BinaryDecoderMode,
    requestedFormat = "",
    selectedRevision = 0,
    signalZoom?: number,
    signalPan?: number,
  ) {
    const profile = this.registry.remote_profiles?.[profileId];
    const command = profile?.commands?.[commandId];
    if (!profile || !command) return;
    const active =
      this.renderRoot instanceof ShadowRoot
        ? this.renderRoot.activeElement
        : document.activeElement;
    this.inspectorReturnFocus =
      !this.compactInspector && active instanceof HTMLElement ? active : null;
    const dependents = profile.dependent_appliance_ids || [];
    const resolvedTab =
      tab || (this.inspector ? this.inspectorTab : "overview");
    const resolvedBinaryMode =
      binaryMode ||
      (this.inspector?.data.binary_decoder_mode as BinaryDecoderMode) ||
      "auto";
    const nativeFormat = command.format || "raw_signed";
    const codeFormat =
      requestedFormat ||
      String(this.inspector?.data.code_format || "") ||
      nativeFormat;
    const codeKey = this.inspectorCodeKey(
      profileId,
      commandId,
      command,
      codeFormat,
    );
    const resolvedSignalZoom =
      signalZoom ?? Number(this.inspector?.data.signal_zoom || 1);
    const resolvedSignalPan =
      signalPan ?? Number(this.inspector?.data.signal_pan || 0);
    this.inspectorCodeSequence += 1;
    this.view = "remote_profiles";
    this.selectedProfileId = profileId;
    this.selectedApplianceId = "";
    this.inspectorTab = resolvedTab;
    this.inspector = {
      kind: "command",
      title: command.name || commandId,
      data: {
        remote_profile_id: profileId,
        command_id: commandId,
        appliance_id: dependents[0] || "",
        history: null,
        binary_decoder_mode: resolvedBinaryMode,
        revision_selected: selectedRevision,
        signal_zoom: resolvedSignalZoom,
        signal_pan: resolvedSignalPan,
        code_format: codeFormat,
        code_representation: {
          key: codeKey,
          format: codeFormat,
          ...(codeFormat === nativeFormat
            ? { value: command.code || "", loading: false }
            : { loading: true }),
        },
      },
    };
    if (navigate) this.syncWorkspaceRoute();
    void this.loadCommandHistory(profileId, commandId);
    if (codeFormat !== nativeFormat) {
      void this.loadInspectorCodeRepresentation(
        { profileId, commandId, format: codeFormat },
        true,
      );
    }
  }

  private async loadCommandHistory(
    profileId: string,
    commandId: string,
  ): Promise<void> {
    try {
      const history = await this.services?.call("command_history", {
        remote_profile_id: profileId,
        command_id: commandId,
      });
      if (
        this.inspector?.kind === "command" &&
        this.inspector.data.remote_profile_id === profileId &&
        this.inspector.data.command_id === commandId
      ) {
        const revisions = (history?.revisions || []) as Dict[];
        const requestedRevision = Number(
          this.inspector.data.revision_selected ||
            history?.current_revision ||
            0,
        );
        const requestedRecord = revisions.find(
          (revision) => Number(revision.revision) === requestedRevision,
        );
        const currentRevision = Number(history?.current_revision || 0);
        const fallbackRecord =
          revisions.find(
            (revision) => Number(revision.revision) === currentRevision,
          ) || revisions.at(-1);
        const revisionRecord = requestedRecord || fallbackRecord;
        const revisionSelected = Number(revisionRecord?.revision || 0);
        const correctedRevision = requestedRevision !== revisionSelected;
        this.inspector = {
          ...this.inspector,
          data: {
            ...this.inspector.data,
            history,
            revision_selected: revisionSelected,
            revision_label: correctedRevision
              ? String(revisionRecord?.label || "")
              : (this.inspector.data.revision_label ??
                String(revisionRecord?.label || "")),
          },
        };
        if (correctedRevision) this.syncWorkspaceRoute("replace");
      }
    } catch {
      /* Current command details remain useful when history is unavailable. */
    }
  }

  private inspectorCodeKey(
    profileId: string,
    commandId: string,
    command: CommandData,
    format: string,
  ): string {
    return `${profileId}|${commandId}|${command.current_revision || command.code || "current"}|${format}`;
  }

  private setInspectorCodeRepresentation(
    profileId: string,
    commandId: string,
    format: string,
    representation: LabCodeRepresentation,
  ): void {
    if (
      this.inspector?.kind !== "command" ||
      this.inspector.data.remote_profile_id !== profileId ||
      this.inspector.data.command_id !== commandId
    ) {
      return;
    }
    this.inspector = {
      ...this.inspector,
      data: {
        ...this.inspector.data,
        code_format: format,
        code_representation: representation,
      },
    };
  }

  private async loadInspectorCodeRepresentation(
    detail: {
      profileId: string;
      commandId: string;
      format: string;
    },
    force: boolean,
  ): Promise<void> {
    const command =
      this.registry.remote_profiles?.[detail.profileId]?.commands?.[
        detail.commandId
      ];
    if (!command) return;
    const format = detail.format || command.format || "raw_signed";
    const key = this.inspectorCodeKey(
      detail.profileId,
      detail.commandId,
      command,
      format,
    );
    const current = this.inspector?.data.code_representation as
      LabCodeRepresentation | undefined;
    if (!force && current?.key === key && !current.error) return;

    const sequence = ++this.inspectorCodeSequence;
    const nativeFormat = command.format || "raw_signed";
    if (format === nativeFormat) {
      this.setInspectorCodeRepresentation(
        detail.profileId,
        detail.commandId,
        format,
        {
          key,
          format,
          value: command.code || "",
          loading: false,
        },
      );
      return;
    }

    this.setInspectorCodeRepresentation(
      detail.profileId,
      detail.commandId,
      format,
      { key, format, loading: true },
    );
    if (!this.services) return;
    try {
      const converted = await this.services.call("convert_signal", {
        code: command.code || "",
        format: nativeFormat,
        output_format: format,
        ...(command.signal?.carrier_frequency
          ? { carrier_frequency: command.signal.carrier_frequency }
          : {}),
        name: command.name || detail.commandId,
      });
      if (sequence !== this.inspectorCodeSequence) return;
      this.setInspectorCodeRepresentation(
        detail.profileId,
        detail.commandId,
        format,
        {
          key,
          format,
          value: String(converted.value || ""),
          loading: false,
          lossReport: converted.loss_report,
        },
      );
    } catch (error) {
      if (sequence !== this.inspectorCodeSequence) return;
      this.setInspectorCodeRepresentation(
        detail.profileId,
        detail.commandId,
        format,
        {
          key,
          format,
          loading: false,
          error: errorMessage(error),
        },
      );
    }
  }

  private async closeInspector() {
    const returnFocus = this.inspectorReturnFocus;
    this.inspector = null;
    this.inspectorReturnFocus = null;
    this.syncWorkspaceRoute();
    await this.updateComplete;
    if (returnFocus?.isConnected) returnFocus.focus();
  }

  private setInspectorTab(tab: InspectorTab): void {
    if (this.inspectorTab === tab) return;
    this.inspectorTab = tab;
    this.syncWorkspaceRoute();
  }

  private async copyText(
    value: string,
    success = "Copied Home Assistant action.",
  ) {
    try {
      await writeClipboard(value);
      this.notify(success);
    } catch {
      this.error = "The browser blocked clipboard access.";
    }
  }

  private notify(message: string): void {
    showHomeAssistantToast(this, message);
  }

  private openExperimentCopy(
    profileId: string,
    commandId: string,
    command: CommandData,
  ) {
    if (!this.labController.open(profileId, commandId, command)) return;
    void this.workflowController.close();
    this.inspector = null;
  }

  private handleRemoteProfileAction(detail: RemoteProfileAction) {
    if (detail.type === "search-change") {
      this.search = detail.value;
      this.storeWorkspaceSession();
    } else if (detail.type === "test-emitter-change")
      this.testEmitterRef = detail.emitterRef;
    else if (detail.type === "add-profile")
      this.workflowController.openProfile();
    else if (detail.type === "create-custom-signal")
      this.workflowController.openCustomSignal(detail.profileId);
    else if (detail.type === "find-codes")
      this.workflowController.openCatalog();
    else if (detail.type === "import-signals")
      this.workflowController.openImport(detail.profileId);
    else if (detail.type === "backup")
      void this.workflowController.openBackup(detail.profileId);
    else if (detail.type === "learn-command")
      this.workflowController.openLearn(detail.profileId);
    else if (detail.type === "create-appliance")
      this.workflowController.openAppliance(undefined, detail.profileId);
    else if (detail.type === "manage-appliances") this.changeView("appliances");
    else if (detail.type === "edit-profile")
      this.workflowController.openProfile(detail.profileId);
    else if (detail.type === "delete-profile") {
      this.workflowController.confirmRemove("profile", {
        remote_profile_id: detail.profileId,
      });
    } else if (detail.type === "choose-command-icon") {
      this.workflowController.openCommandIcon(
        detail.profileId,
        detail.commandId,
      );
    } else if (detail.type === "start-command-selection") {
      this.inspector = null;
      this.commandSelection = {
        remoteProfileId: detail.profileId,
        commandIds: [],
      };
      this.storeWorkspaceSession();
    } else if (detail.type === "cancel-command-selection") {
      if (this.commandSelection?.remoteProfileId === detail.profileId) {
        this.commandSelection = null;
        this.storeWorkspaceSession();
      }
    } else if (detail.type === "toggle-command-selection") {
      if (this.commandSelection?.remoteProfileId !== detail.profileId) return;
      const selected = new Set(this.commandSelection.commandIds);
      if (detail.selected) selected.add(detail.commandId);
      else selected.delete(detail.commandId);
      this.commandSelection = {
        remoteProfileId: detail.profileId,
        commandIds: [...selected],
      };
      this.storeWorkspaceSession();
    } else if (detail.type === "select-all-commands") {
      if (this.commandSelection?.remoteProfileId !== detail.profileId) return;
      this.commandSelection = {
        remoteProfileId: detail.profileId,
        commandIds: detail.selected ? [...detail.commandIds] : [],
      };
      this.storeWorkspaceSession();
    } else if (detail.type === "move-selected-commands") {
      this.workflowController.openMoveCommands(
        detail.profileId,
        detail.commandIds,
      );
    } else if (detail.type === "duplicate-profile") {
      this.workflowController.openDuplicateProfile(detail.profileId);
    } else if (detail.type === "open-command") {
      void this.openCommand(detail.profileId, detail.commandId);
    } else if (detail.type === "test-command") {
      const command =
        this.registry.remote_profiles?.[detail.profileId]?.commands?.[
          detail.commandId
        ];
      if (command)
        void this.workflowController.testCommand(detail.profileId, command);
    }
  }

  private handleApplianceAction(detail: ApplianceAction) {
    if (detail.type === "add-appliance")
      this.workflowController.openAppliance();
    else if (detail.type === "edit-appliance")
      this.workflowController.openAppliance(detail.applianceId);
    else if (detail.type === "open-profile")
      this.changeView("remote_profiles", detail.profileId);
    else if (detail.type === "delete-appliance") {
      this.workflowController.confirmRemove("appliance", {
        appliance_id: detail.applianceId,
      });
    }
  }

  private handleInspectorAction(detail: InspectorAction) {
    if (detail.type === "close") void this.closeInspector();
    else if (detail.type === "tab-change") this.setInspectorTab(detail.tab);
    else if (detail.type === "appliance-change")
      this.setInspectorAppliance(detail.applianceId);
    else if (detail.type === "copy-action") void this.copyText(detail.value);
    else if (detail.type === "copy-entity-id")
      void this.copyText(detail.value, "Entity ID copied.");
    else if (detail.type === "copy-code")
      void this.copyText(detail.value, "Signal code copied.");
    else if (detail.type === "copy-timings")
      void this.copyText(detail.value, "Timings copied.");
    else if (detail.type === "copy-bitstream")
      void this.copyText(detail.value, "Raw bitstream copied.");
    else if (detail.type === "signal-navigation") {
      if (!this.inspector) return;
      this.inspector = {
        ...this.inspector,
        data: {
          ...this.inspector.data,
          signal_zoom: Math.max(1, Math.min(16, detail.zoom)),
          signal_pan: Math.max(0, Math.min(1, detail.pan)),
        },
      };
      this.syncWorkspaceRoute("replace");
    } else if (detail.type === "binary-mode-change") {
      if (!this.inspector) return;
      this.inspector = {
        ...this.inspector,
        data: {
          ...this.inspector.data,
          binary_decoder_mode: detail.mode,
        },
      };
      this.syncWorkspaceRoute();
    } else if (detail.type === "copy-revision-code")
      void this.copyText(detail.value, "Revision code copied.");
    else if (detail.type === "revision-select") {
      if (!this.inspector) return;
      this.inspector = {
        ...this.inspector,
        data: {
          ...this.inspector.data,
          revision_selected: detail.revision,
          revision_label: detail.label,
        },
      };
      this.syncWorkspaceRoute();
    } else if (detail.type === "revision-label-change") {
      if (!this.inspector) return;
      this.inspector = {
        ...this.inspector,
        data: { ...this.inspector.data, revision_label: detail.value },
      };
    } else if (detail.type === "save-revision-label") {
      void this.saveRevisionLabel(detail);
    } else if (detail.type === "compare-revision") {
      this.workflowController.openRevisionComparison(
        detail.profileId,
        detail.commandId,
        detail.revision,
        detail.snapshot,
      );
    } else if (detail.type === "test-revision") {
      void this.workflowController.testCommand(detail.profileId, {
        ...(detail.snapshot as CommandData),
        name: `Revision ${detail.revision}`,
      });
    } else if (detail.type === "export-command-backup") {
      void this.exportCommandBackup(detail.profileId, detail.commandId);
    } else if (detail.type === "export-revision") {
      const profile = this.registry.remote_profiles?.[detail.profileId];
      const command = profile?.commands?.[detail.commandId];
      const value = JSON.stringify(
        {
        schema: "imprint_refinery.command_revision",
        version: 1,
        remote_profile_id: detail.profileId,
        command_id: detail.commandId,
        ...detail.record,
        },
        null,
        2,
      );
      downloadText(
        value,
        `${safeFilename(`${profile?.name || detail.profileId}-${command?.name || detail.commandId}-revision-${detail.revision}`)}.json`,
        "application/json;charset=utf-8",
      );
    } else if (detail.type === "code-format-change") {
      void this.loadInspectorCodeRepresentation(detail, false);
      this.syncWorkspaceRoute();
    } else if (detail.type === "retry-code-format") {
      void this.loadInspectorCodeRepresentation(detail, true);
    } else if (detail.type === "restore-revision") {
      this.workflowController.confirmRevisionRestore(
        detail.profileId,
        detail.commandId,
        detail.revision,
        detail.snapshot,
      );
    } else {
      const command =
        this.registry.remote_profiles?.[detail.profileId]?.commands?.[
          detail.commandId
        ];
      if (!command) return;
      if (detail.type === "test-command")
        void this.workflowController.testCommand(detail.profileId, command);
      else if (detail.type === "open-signal-lab")
        this.openExperimentCopy(detail.profileId, detail.commandId, command);
      else if (detail.type === "edit-command")
        this.workflowController.openCommandEdit(
          detail.profileId,
          detail.commandId,
        );
      else if (detail.type === "duplicate-command")
        this.workflowController.openDuplicateCommand(
          detail.profileId,
          detail.commandId,
        );
      else if (detail.type === "relearn-command")
        this.workflowController.openRelearn(
          detail.profileId,
          detail.commandId,
          command,
        );
      else if (detail.type === "delete-command") {
        this.workflowController.confirmRemove("command", {
          remote_profile_id: detail.profileId,
          command_id: detail.commandId,
        });
      }
    }
  }

  private async exportCommandBackup(
    profileId: string,
    commandId: string,
  ): Promise<void> {
    if (!this.services) return;
    await this.run(async () => {
      const document = await this.services!.call("export_backup", {
        remote_profile_id: profileId,
        include_history: true,
      });
      const profile = document?.remote_profiles?.[profileId];
      const command = profile?.commands?.[commandId];
      if (!profile || !command) {
        throw new Error("The command backup could not be created.");
      }
      const value = JSON.stringify(
        {
          ...document,
          command_count: 1,
          remote_profiles: {
            [profileId]: {
              ...profile,
              commands: { [commandId]: command },
            },
          },
          appliances: {},
        },
        null,
        2,
      );
      const saved =
        this.registry.remote_profiles?.[profileId]?.commands?.[commandId];
      downloadText(
        value,
        `${safeFilename(`${profile.name || profileId}-${saved?.name || commandId}-backup`)}.json`,
        "application/json;charset=utf-8",
      );
    });
  }

  private async saveRevisionLabel(detail: {
    profileId: string;
    commandId: string;
    revision: number;
    label: string;
  }): Promise<void> {
    if (!this.services) return;
    await this.run(async () => {
      await this.services!.call("label_revision", {
        remote_profile_id: detail.profileId,
        command_id: detail.commandId,
        revision_id: detail.revision,
        label: detail.label.trim(),
      });
      if (this.inspector) {
        this.inspector = {
          ...this.inspector,
          data: { ...this.inspector.data, revision_label: detail.label.trim() },
        };
      }
      await this.loadCommandHistory(detail.profileId, detail.commandId);
    }, "Revision label saved.");
  }

  private renderHeader() {
    const inspectorModal = this.compactInspector && Boolean(this.inspector);
    return renderWorkspaceHeader({
      heading: this.config.title || "Imprint Refinery",
      view: this.view,
      inert: inspectorModal,
      onViewChange: (view) => this.changeView(view),
    });
  }

  private renderLabHeader() {
    return renderWorkspaceHeader({
      heading: this.config.title || "Imprint Refinery",
      navigation: false,
    });
  }

  private renderRemoteProfiles() {
    const inspector =
      this.inspector?.kind === "command"
      ? renderCommandInspector({
          registry: this.registry,
          profileId: String(this.inspector.data.remote_profile_id || ""),
          commandId: String(this.inspector.data.command_id || ""),
          applianceId: String(this.inspector.data.appliance_id || ""),
          history: (this.inspector.data.history as Dict) || null,
          tab: this.inspectorTab,
          compact: this.compactInspector,
          busy: this.busy,
          testEmitterRef: this.testEmitterRef,
          codeFormat: String(
            this.inspector.data.code_format ||
                this.registry.remote_profiles?.[
                  String(this.inspector.data.remote_profile_id || "")
                ]?.commands?.[String(this.inspector.data.command_id || "")]
                  ?.format ||
              "raw_signed",
          ),
          codeRepresentation: this.inspector.data.code_representation as
              LabCodeRepresentation | undefined,
            binaryMode:
              (this.inspector.data.binary_decoder_mode as BinaryDecoderMode) ||
              "auto",
            signalZoom: Number(this.inspector.data.signal_zoom || 1),
            signalPan: Number(this.inspector.data.signal_pan || 0),
            selectedRevision: Number(
              this.inspector.data.revision_selected || 0,
            ),
          revisionLabel: String(this.inspector.data.revision_label || ""),
          onAction: (action) => this.handleInspectorAction(action),
        })
      : nothing;
    return renderRemoteProfileWorkspace({
      profiles: this.profiles(),
      emitters: this.emitters(),
      selectedProfileId: this.selectedProfileId,
      selectedCommandProfileId: String(
        this.inspector?.data.remote_profile_id || "",
      ),
      selectedCommandId: String(this.inspector?.data.command_id || ""),
      commandSelection: this.commandSelection,
      search: this.search,
      testEmitterRef: this.testEmitterRef,
      busy: this.busy,
      inspectorOpen: Boolean(this.inspector),
      compactInspector: this.compactInspector,
      inspector,
      onAction: (action) => this.handleRemoteProfileAction(action),
    });
  }

  private renderAppliances() {
    return renderAppliancesWorkspace({
      appliances: Object.entries(this.registry.appliances || {}),
      profiles: this.registry.remote_profiles || {},
      emitters: this.emitters(),
      selectedApplianceId: this.selectedApplianceId,
      onAction: (action) => this.handleApplianceAction(action),
    });
  }

  private renderHardware() {
    return renderInfraredHardwareWorkspace({
      emitters: this.emitters(),
      receivers: this.receivers(),
      compatibilityAdapterAvailable: Boolean(
        this.registry.infrared_hardware?.compatibility_adapter_available,
      ),
    });
  }

  private setInspectorAppliance(applianceId: string) {
    if (!this.inspector) return;
    this.inspector = {
      ...this.inspector,
      data: { ...this.inspector.data, appliance_id: applianceId },
    };
  }

  private handleWorkflowAction = (action: WorkflowAction): void => {
    this.workflowController.handleAction(action);
  };

  private renderDialog() {
    return renderWorkflowDialog({
      dialog: this.dialog,
      registry: this.registry,
      error: this.error,
      busy: this.busy,
      capturing: this.capturePromptActive,
      captureRemaining: this.captureRemaining,
      captureTimeout: Number(this.config.timeout || 60),
      testEmitterRef: this.testEmitterRef,
      onAction: this.handleWorkflowAction,
    });
  }

  private renderShell(content: unknown, overlays: unknown = nothing) {
    return this.presentation === "panel"
      ? html`<div class="shell panel-shell">${content}${overlays}</div>`
      : html`<ha-card class="shell">${content}${overlays}</ha-card>`;
  }

  private compactCommands() {
    const profiles = this.registry.remote_profiles || {};
    const configuredAppliance = String(this.config.appliance_id || "");
    return Object.entries(this.registry.appliances || {})
      .filter(
        ([applianceId]) =>
          !configuredAppliance || applianceId === configuredAppliance,
      )
      .flatMap(([applianceId, appliance]) => {
        const profileId = String(appliance.remote_profile_id || "");
        const profile = profiles[profileId];
        if (!profile) return [];
        return Object.entries(profile.commands || {}).map(
          ([commandId, command]) => ({
          applianceId,
          appliance,
          commandId,
          command,
            use: buildHomeAssistantUse(
              applianceId,
              commandId,
              appliance,
              command,
            ),
          }),
        );
      })
      .slice(0, 12);
  }

  private compactCommandAvailable(
    entityId: string,
    routeStatus?: string,
  ): boolean {
    if (
      !entityId ||
      routeStatus === "unassigned" ||
      routeStatus === "missing" ||
      routeStatus === "unavailable"
    )
      return false;
    const state = this.hass?.states?.[entityId]?.state;
    return state !== "unavailable";
  }

  private async sendCompactCommand(
    item: ReturnType<ImprintRefineryCard["compactCommands"]>[number],
  ): Promise<void> {
    const [domain, service] = item.use.action.split(".", 2);
    if (!domain || !service || !this.hass) return;
    try {
      await this.hass.callService(domain, service, item.use.serviceData);
      this.notify(
        `${item.command.name || item.commandId} sent to ${item.appliance.name || item.applianceId}.`,
      );
    } catch (error) {
      this.notify(
        `Could not send ${item.command.name || item.commandId}: ${errorMessage(error)}`,
      );
    }
  }

  private renderCompactCard() {
    const commands = this.compactCommands();
    return html`<section class="compact-card">
      <header>
        <h2>${this.config.title || "Imprint Refinery"}</h2>
        <span>Saved remote controls</span>
      </header>
      ${
        commands.length
        ? html`<div class="compact-command-list">${commands.map((item) => {
            const name = item.command.name || item.commandId;
            const applianceName = item.appliance.name || item.applianceId;
              const available = this.compactCommandAvailable(
                item.use.entityId,
                item.appliance.route_status,
              );
            return html`<div class="compact-command-row">
              <ha-icon icon=${item.command.icon || "mdi:remote"}></ha-icon>
              <div class="compact-command-copy"><strong>${name}</strong><span>${applianceName}</span></div>
              <ha-icon-button
                .disabled=${!available}
                .label=${available ? `Send ${name} to ${applianceName}` : `${name} is unavailable`}
                title=${available ? "Send once" : "This appliance route is unavailable"}
                @click=${() => void this.sendCompactCommand(item)}
              ><ha-icon icon="mdi:send"></ha-icon></ha-icon-button>
            </div>`;
          })}</div>`
          : html`<div class="panel"><strong>No saved commands</strong><p class="muted">Assign a remote profile to an appliance to show its controls here.</p></div>`
      }
    </section>`;
  }

  render() {
    if (this.presentation === "card") {
      if (!this.hass)
        return this.renderShell(
          html`<div class="loading">Waiting for Home Assistant…</div>`,
        );
      if (this.loading)
        return this.renderShell(
          html`<div class="loading" role="status" aria-live="polite"><ha-spinner></ha-spinner><span>Loading saved controls…</span></div>`,
        );
      return this.renderShell(this.renderCompactCard());
    }
    if (this.lab) {
      const emitter = this.emitter(this.testEmitterRef);
      return this
        .renderShell(html`<main class="app">${this.renderLabHeader()}<imprint-signal-lab
        .lab=${this.lab}
        .registry=${this.registry}
        .busy=${this.busy}
        .emitterReady=${Boolean(emitter?.available)}
        .emitterName=${emitter?.name || "No test IR emitter selected"}
        .offlineReason=${emitter ? "The selected IR emitter is unavailable." : "Choose Test with IR emitter before opening Signal Lab."}
        .error=${this.error}
        @lab-action=${(event: CustomEvent) => this.labController.handle(event.detail)}
      ></imprint-signal-lab></main>`);
    }
    return this.renderShell(
      html`<main class="app" ?inert=${Boolean(this.dialog)}>
        ${this.renderHeader()}
        ${
          this.suspendedLab
            ? renderWorkspaceNotice({
                role: "status",
                icon: "mdi:flask-outline",
                content: html`<strong>Signal Lab draft saved</strong><br />${this.suspendedLab.sourceName || this.suspendedLab.commandId} can be resumed in this browser tab.`,
                actions: html`<span class="suspended-draft-actions">
                <ha-button appearance="outlined" variant="neutral" @click=${() => this.clearStoredLabDraft()}>Discard</ha-button>
                <ha-button appearance="accent" variant="brand" @click=${() => this.resumeStoredLabDraft()}>Resume draft</ha-button>
              </span>`,
              })
            : nothing
        }
        ${
          !this.dialog
          ? renderFeedback({
              message: this.error,
              dismissible: true,
              onDismiss: () => (this.error = ""),
            })
            : nothing
        }
        ${
          this.loading
          ? html`<div class="loading" role="status" aria-live="polite">
              <ha-spinner></ha-spinner><span>Loading Imprint Refinery…</span>
            </div>`
          : this.view === "remote_profiles"
            ? this.renderRemoteProfiles()
            : this.view === "appliances"
              ? this.renderAppliances()
                : this.renderHardware()
        }
      </main>`,
      this.renderDialog(),
    );
  }
}

@safeCustomElement("imprint-refinery-panel")
export class ImprintRefineryPanel extends ImprintRefineryCard {
  private panelValue?: { config?: CardConfig };
  narrow = false;
  route?: Dict;

  get panel() {
    return this.panelValue;
  }

  set panel(value: { config?: CardConfig } | undefined) {
    this.panelValue = value;
    this.setConfig({ ...(value?.config || {}), workspace: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-refinery-card": ImprintRefineryCard;
    "imprint-refinery-panel": ImprintRefineryPanel;
  }
  interface Window {
    customCards?: Array<Record<string, string>>;
    __imprintRequiredHaComponents?: readonly string[];
  }
}

window.__imprintRequiredHaComponents = REQUIRED_HA_COMPONENTS;
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "imprint-refinery-card")) {
  window.customCards.push({
    type: "imprint-refinery-card",
    name: "Imprint Refinery",
    description: "Learn, inspect, test, and organize infrared commands.",
  });
}
console.info(
  `%c IMPRINT REFINERY %c v${VERSION} `,
  "color:white;background:#0b6bcb;font-weight:700",
  "color:#0b6bcb;background:#eaf3ff",
);
