import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type {
  CatalogState,
  Dict,
  HomeAssistant,
  InspectorState,
  LabState,
  LearnState,
  RegistryData,
  Emitter,
} from "./types";
import { ImprintServices } from "./core/services";
import {
  allCommands,
  applianceDisplayName,
  copyText,
  deepActiveElement,
  downloadText,
  friendlyError,
  slugify,
  uniqueKey,
  validId,
} from "./core/utils";
import {
  draftDirty,
  frameRanges,
  previewImpact,
  snapshot,
  validateDraft,
} from "./core/signal";
import { safeCustomElement } from "./core/registration";
import { tokens } from "./styles";
import "./components/primitives";
import "./components/learn-flow";
import "./components/library-inspector";
import "./components/signal-lab";
import "./components/catalog-guided";
import { homeAssistantUse } from "./components/library/model";

const VERSION = "0.1.1";
const GUIDED_SESSION_KEY = "imprint-refinery.guided-session-id";
const ROUTE_LAB_KEY = "imprint-refinery.route.lab";
const ROUTE_LEARN_KEY = "imprint-refinery.route.learn";
const ROUTE_CATALOG_KEY = "imprint-refinery.route.catalog";
const ROUTE_MODAL_KEY = "imprint-refinery.route.modal";
const ROUTE_KEYS = [
  "screen",
  "location",
  "appliance",
  "command",
  "tab",
  "format",
  "decoder",
  "zoom",
  "pan",
  "lab_view",
  "lab_tab",
  "save",
  "overlays",
  "catalog_mode",
  "profile",
  "category",
  "brand",
  "model",
  "target",
  "searched",
  "dialog",
  "revision",
  "custom",
];

interface CardConfig extends Dict {
  workspace?: boolean;
  emitter_id?: string;
  status_entity?: string;
  timeout?: number;
  poll_interval?: number;
  title?: string;
}
interface ModalState {
  type: "form" | "confirm" | "info" | "locations";
  heading: string;
  text?: string;
  confirmLabel?: string;
  action: string;
  data: Record<string, any>;
  error?: string;
}

@safeCustomElement("imprint-refinery-card")
export class ImprintRefineryCard extends LitElement {
  @property({ attribute: false }) hass?: HomeAssistant;
  @state() private config: CardConfig = {};
  @state() private registry: RegistryData = { locations: {}, emitters: [] };
  @state() private loading = true;
  @state() private registryLoadFailed = false;
  @state() private selectedLocation = "";
  @state() private selectedAppliance = "";
  @state() private selectedEmitter = "";
  @state() private busy = false;
  @state() private message = "";
  @state() private error = "";
  @state() private errorDetail = "";
  @state() private inspector: InspectorState | null = null;
  @state() private learn: LearnState | null = null;
  @state() private learnRemaining = 0;
  @state() private catalogMatchRemaining = 0;
  @state() private lab: LabState | null = null;
  @state() private suspendedLab: LabState | null = null;
  @state() private catalog: CatalogState | null = null;
  @state() private modal: ModalState | null = null;
  @state() private now = Date.now();
  @state() private guidedCooldownUntil = 0;
  @state() private sendFeedback: Record<
    string,
    { kind: "pending" | "success" | "error"; message: string; detail?: string }
  > = {};
  private sendFeedbackTimers = new Map<string, number>();
  private services?: ImprintServices;
  private loaded = false;
  private learnTimer?: number;
  private ticker?: number;
  private labAnalysisTimer?: number;
  private learnSequence = 0;
  private catalogMatchSequence = 0;
  private labAnalysisSequence = 0;
  private inspectorOpenSequence = 0;
  private representationCache = new Map<
    string,
    { value: string; lossReport?: any }
  >();
  private analysisCache = new Map<string, any>();
  private importText = "";
  private pendingFocus?: { locId: string; applianceId: string; cmdId: string };
  private learnReturnFocus: HTMLElement | null = null;
  private restoreLearnFocus = false;
  private routeRestored = false;
  private routeRestoring = false;
  private routeFrame?: number;
  private messageTimer?: number;
  private lastRouteIdentity = "";
  private readonly onRoutePopState = () => {
    if (this.routeEnabled() && this.routeRestored) void this.restoreRoute();
  };

  static styles = [
    tokens,
    css`
    :host { display: block; }
    ha-card { overflow: hidden; background: var(--primary-background-color, #f6f7f9); border: 0; box-shadow: none; }
    .app { box-sizing: border-box; display: grid; align-content: start; gap: 18px; width: min(1440px, 100%); margin: 0 auto; padding: 0 32px 32px; background: var(--primary-background-color, #f6f7f9); min-height: 100dvh; }
    .top { min-height: 64px; display: flex; gap: 12px; align-items: center; border-bottom: 1px solid var(--imprint-line); margin-inline: -32px; padding-inline: 32px; }
    .brand { display: flex; gap: 10px; align-items: center; margin-right: auto; }
    .brand .mark { display: none; }
    .brand h1 { margin: 0; font-size: 19px; }
    .brand span { display: none; }
    .compact { display: grid; gap: 13px; }
    .compact-list { display: grid; gap: 6px; }
    .compact-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 9px; border: 1px solid var(--imprint-line); border-radius: 10px; padding: 9px 10px; }
    .compact-copy { min-width: 0; }
    .compact-copy strong, .compact-copy small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .compact-copy small { color: var(--imprint-muted); }
    .compact-send { border-radius: 50%; transition: color 140ms ease-out, background-color 140ms ease-out, border-color 140ms ease-out; }
    .btn.compact-send.pending { color: var(--imprint-accent); }
    .btn.compact-send.success, .btn.compact-send.success:hover { color: var(--text-primary-color, #fff); background: var(--imprint-success); border-color: var(--imprint-success); }
    .btn.compact-send.error, .btn.compact-send.error:hover { color: var(--text-primary-color, #fff); background: var(--imprint-danger); border-color: var(--imprint-danger); }
    .feedback-stack { position: fixed; inset-block-start: 76px; inset-inline-end: 24px; z-index: 19; width: min(420px, calc(100vw - 32px)); display: grid; gap: 8px; pointer-events: none; }
    .feedback-stack > * { pointer-events: auto; box-shadow: 0 10px 32px rgba(0,0,0,.2); }
    .feedback-stack:empty { display: none; }
    .session-notice { margin-block-end: 2px; }
    .loading { min-height: 260px; display: grid; place-items: center; color: var(--imprint-muted); }
    .modal-body { display: grid; gap: 12px; }
    .modal-body textarea { min-height: 190px; }
    .location-list { display: grid; gap: 8px; }
    .location-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 10px; border: 1px solid var(--imprint-line); border-radius: 9px; }
    .location-row small { display: block; color: var(--imprint-muted); }
    @media (max-width: 900px) {
      .app { padding-inline: 20px; }
      .top { margin-inline: -20px; padding-inline: 20px; }
    }
    @media (max-width: 620px) {
      .app { padding: 0 12px 18px; gap: 12px; }
      .top { min-height: 54px; margin-inline: -12px; padding-inline: 14px; }
      .top > .btn span { display: none; }
      .feedback-stack { inset-block-start: 62px; inset-inline: 12px; width: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .compact-send { transition: none; } }
  `,
  ];

  setConfig(config: CardConfig) {
    this.config = { ...config };
  }
  getCardSize() {
    return 8;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("popstate", this.onRoutePopState);
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("hass") && this.hass) {
      if (!this.services) this.services = new ImprintServices(this.hass);
      else this.services.hass = this.hass;
      if (!this.loaded) {
        this.loaded = true;
        void this.initialize();
      }
    }
    if (this.pendingFocus && !this.learn && !this.lab && !this.catalog) {
      const focus = this.pendingFocus;
      this.pendingFocus = undefined;
      this.renderRoot
        .querySelector<any>("imprint-library-inspector")
        ?.focusCommand(focus.locId, focus.applianceId, focus.cmdId);
    }
    if (this.restoreLearnFocus && !this.learn) {
      this.restoreLearnFocus = false;
      requestAnimationFrame(() =>
        this.renderRoot
          .querySelector<any>("imprint-library-inspector")
          ?.focusLearnTrigger(),
      );
    }
    if (changed.has("message")) {
      window.clearTimeout(this.messageTimer);
      if (this.message)
        this.messageTimer = window.setTimeout(() => (this.message = ""), 2800);
    }
    if (this.routeRestored && !this.routeRestoring) this.scheduleRouteSync();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearInterval(this.learnTimer);
    window.clearInterval(this.ticker);
    window.clearTimeout(this.labAnalysisTimer);
    window.clearTimeout(this.messageTimer);
    this.sendFeedbackTimers.forEach((timer) => window.clearTimeout(timer));
    this.sendFeedbackTimers.clear();
    window.cancelAnimationFrame(this.routeFrame || 0);
    window.removeEventListener("popstate", this.onRoutePopState);
  }

  private statusState() {
    return (
      this.hass?.states?.[
        String(this.config.status_entity || "sensor.imprint_refinery_status")
      ]?.state || "idle"
    );
  }
  private statusBusy() {
    return (
      this.busy ||
      ["capturing", "sending", "queued", "dispatching"].includes(
        this.statusState(),
      )
    );
  }
  private enabledEmitters(): Emitter[] {
    return (this.registry.emitters || []).filter((tx) => tx.enabled !== false);
  }
  private viewRegistry(): RegistryData {
    return {
      ...this.registry,
      emitters: (this.registry.emitters || []).map((tx) => {
        const state = tx.entity_id
          ? this.hass?.states?.[tx.entity_id]?.state
          : "";
        const backendAvailable =
          typeof (tx as any).available === "boolean"
            ? Boolean((tx as any).available)
            : undefined;
        const available =
          tx.enabled !== false &&
          (backendAvailable ??
            (tx.entity_id
              ? Boolean(this.hass?.states?.[tx.entity_id]) &&
                String(state || "").toLowerCase() !== "unavailable"
              : true));
        return { ...tx, state, available } as Emitter;
      }),
    };
  }
  private emitterReady() {
    return Boolean(
      (this.viewRegistry().emitters || []).find(
        (tx) =>
          tx.key === this.selectedEmitter && (tx as any).available !== false,
      ),
    );
  }
  private emitterCanCapture() {
    return Boolean(
      (this.viewRegistry().emitters || []).find(
        (tx) =>
          tx.key === this.selectedEmitter &&
          tx.available !== false &&
          tx.can_capture,
      ),
    );
  }

  private syncSelection() {
    const locations = this.registry.locations || {};
    if (!locations[this.selectedLocation])
      this.selectedLocation = Object.keys(locations)[0] || "";
    const appliances = locations[this.selectedLocation]?.appliances || {};
    if (!appliances[this.selectedAppliance])
      this.selectedAppliance = Object.keys(appliances)[0] || "";
    const enabled = this.enabledEmitters();
    const configured = String(this.config.emitter_id || "");
    const bound = String(
      locations[this.selectedLocation]?.appliances?.[this.selectedAppliance]
        ?.emitter_id || "",
    );
    const valid = (key: string) => enabled.some((tx) => tx.key === key);
    const next = valid(this.selectedEmitter)
      ? this.selectedEmitter
      : valid(configured)
        ? configured
        : valid(bound)
          ? bound
          : enabled[0]?.key || "";
    this.selectedEmitter = next;
    if (this.services) this.services.emitterId = next;
  }

  private async loadRegistry() {
    if (!this.services) return;
    try {
      this.registry = (await this.services.call("get_library")) || {
        locations: {},
        emitters: [],
      };
      this.registryLoadFailed = false;
      this.syncSelection();
      if (
        this.config.workspace &&
        !this.inspector &&
        !this.learn &&
        !this.lab &&
        !this.catalog &&
        this.getBoundingClientRect().width >= 1160
      ) {
        const first = allCommands(this.registry)[0];
        if (first) this.openInspector(first);
      }
    } catch (error) {
      this.registryLoadFailed = true;
      this.setError(error);
    }
  }

  private async initialize() {
    await this.loadRegistry();
    await this.resumeStoredGuidedSession();
    await this.restoreRoute();
    this.loading = false;
  }

  private routeEnabled() {
    return Boolean(
      this.config.workspace &&
        window.location.pathname
          .replace(/\/+$/, "")
          .endsWith("/imprint-refinery"),
    );
  }

  private readRouteSession<T>(key: string): T | null {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null") as T | null;
    } catch {
      return null;
    }
  }

  private writeRouteSession(key: string, value: unknown) {
    try {
      if (value == null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* URL restoration still works without session storage. */
    }
  }

  private scheduleRouteSync() {
    if (!this.routeEnabled()) return;
    window.cancelAnimationFrame(this.routeFrame || 0);
    this.routeFrame = window.requestAnimationFrame(() => this.syncRoute());
  }

  private routeIdentity(params: URLSearchParams) {
    return [
      params.get("screen") || "library",
      params.get("location") || "",
      params.get("appliance") || "",
      params.get("command") || "",
      params.get("catalog_mode") || "",
      params.get("custom") || "",
    ].join("|");
  }

  private syncRoute() {
    if (!this.routeEnabled() || this.routeRestoring) return;
    const url = new URL(window.location.href);
    ROUTE_KEYS.forEach((key) => url.searchParams.delete(key));
    const set = (key: string, value: unknown) => {
      if (value !== undefined && value !== null && String(value) !== "")
        url.searchParams.set(key, String(value));
    };
    if (this.learn) {
      set("screen", "learn");
      set("location", this.learn.locationId);
      set("appliance", this.learn.applianceId);
      set("command", this.learn.commandId);
      this.writeRouteSession(
        ROUTE_LEARN_KEY,
        ["review", "error"].includes(this.learn.step) ? this.learn : null,
      );
    } else if (this.lab) {
      set("screen", "lab");
      set("location", this.lab.locId);
      set("appliance", this.lab.applianceId);
      set("command", this.lab.cmdId);
      if (this.lab.custom) set("custom", 1);
      set("lab_view", this.lab.view);
      set("lab_tab", this.lab.detailTab || "timings");
      set("format", this.lab.convertFormat || "pronto");
      set("decoder", this.lab.binaryDecoderMode || "auto");
      if (this.lab.zoom !== 1) set("zoom", this.lab.zoom);
      if (this.lab.pan) set("pan", this.lab.pan);
      if (this.lab.saveOpen) set("save", 1);
      if (this.lab.editingOverlays) set("overlays", 1);
      this.writeRouteSession(ROUTE_LAB_KEY, this.lab);
    } else if (this.catalog) {
      set("screen", "catalog");
      set("catalog_mode", this.catalog.mode);
      set(
        "profile",
        this.catalog.selectedProfile?.profile_id ||
          this.catalog.confirmedProfileId,
      );
      set("category", this.catalog.category);
      set("brand", this.catalog.brand);
      set("model", this.catalog.model);
      set("target", this.catalog.importTargetKey);
      if (this.catalog.searched) set("searched", 1);
      this.writeRouteSession(ROUTE_CATALOG_KEY, this.catalog);
    } else if (this.inspector) {
      set("screen", "command");
      set("location", this.inspector.locId);
      set("appliance", this.inspector.applianceId);
      set("command", this.inspector.cmdId);
      set("tab", this.inspector.tab);
      set("format", this.inspector.representation);
      set("decoder", this.inspector.binaryDecoderMode || "auto");
      if ((this.inspector.zoom || 1) !== 1) set("zoom", this.inspector.zoom);
      if (this.inspector.pan) set("pan", this.inspector.pan);
      if (this.inspector.revisionSelected != null)
        set("revision", this.inspector.revisionSelected);
    } else {
      set("screen", "library");
      set("location", this.selectedLocation);
      set("appliance", this.selectedAppliance);
    }
    if (!this.lab) this.writeRouteSession(ROUTE_LAB_KEY, null);
    if (!this.learn) this.writeRouteSession(ROUTE_LEARN_KEY, null);
    if (!this.catalog) this.writeRouteSession(ROUTE_CATALOG_KEY, null);
    if (this.modal) {
      set("dialog", this.modal.action);
      set("revision", this.modal.data.revision);
      this.writeRouteSession(ROUTE_MODAL_KEY, this.modal);
    } else this.writeRouteSession(ROUTE_MODAL_KEY, null);
    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const identity = this.routeIdentity(url.searchParams);
    if (next !== current)
      window.history[
        this.lastRouteIdentity && identity !== this.lastRouteIdentity
          ? "pushState"
          : "replaceState"
      ]({ ...(window.history.state || {}), imprintRefinery: true }, "", next);
    this.lastRouteIdentity = identity;
  }

  private routeNumber(
    params: URLSearchParams,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const value = Number(params.get(key));
    return Number.isFinite(value)
      ? Math.max(minimum, Math.min(maximum, value))
      : fallback;
  }

  private routeRef(params: URLSearchParams) {
    return {
      locId: params.get("location") || "",
      applianceId: params.get("appliance") || "",
      cmdId: params.get("command") || "",
    };
  }

  private routeBinaryDecoder(params: URLSearchParams) {
    const mode = params.get("decoder") || "auto";
    return (
      ["auto", "pulse_distance", "pulse_width", "protocol"].includes(mode)
        ? mode
        : "auto"
    ) as NonNullable<InspectorState["binaryDecoderMode"]>;
  }

  private validRouteLab(
    value: LabState | null,
    ref: { locId: string; applianceId: string; cmdId: string },
    custom: boolean,
  ) {
    if (
      !value ||
      Boolean(value.custom) !== custom ||
      value.locId !== ref.locId ||
      value.applianceId !== ref.applianceId ||
      value.cmdId !== ref.cmdId
    )
      return false;
    return [value.timings, value.original].every(
      (items) =>
        Array.isArray(items) &&
        items.length &&
        items.every(
          (item) => Number.isInteger(item) && item > 0 && item <= 65_535,
        ),
    );
  }

  private async restoreRoute() {
    if (!this.routeEnabled()) {
      this.routeRestored = true;
      return;
    }
    this.routeRestoring = true;
    this.routeRestored = false;
    try {
      const params = new URL(window.location.href).searchParams;
      if (!params.has("screen")) {
        this.lastRouteIdentity = this.inspector
          ? [
              "command",
              this.inspector.locId,
              this.inspector.applianceId,
              this.inspector.cmdId,
              "",
              "",
            ].join("|")
          : this.catalog
            ? ["catalog", "", "", "", this.catalog.mode, ""].join("|")
            : "library|||||";
        return;
      }
      const screen = params.get("screen") || "library";
      const ref = this.routeRef(params);
      const resumedCatalog = this.catalog;
      this.learn = null;
      this.lab = null;
      this.inspector = null;
      this.catalog = null;
      this.modal = null;
      if (screen === "learn") {
        const saved = this.readRouteSession<LearnState>(ROUTE_LEARN_KEY);
        if (saved && ["review", "error"].includes(saved.step))
          this.learn = saved;
        else
          this.message =
            "The previous capture screen was not resumed because opening a URL must not start hardware capture.";
      } else if (screen === "lab") {
        const custom = params.get("custom") === "1";
        const saved = this.readRouteSession<LabState>(ROUTE_LAB_KEY);
        if (this.validRouteLab(saved, ref, custom))
          this.lab = {
            ...saved!,
            codeRepresentation: saved!.codeRepresentation?.loading
              ? undefined
              : saved!.codeRepresentation,
          };
        else if (custom) {
          this.selectedLocation = ref.locId || this.selectedLocation;
          this.selectedAppliance = ref.applianceId || this.selectedAppliance;
          this.openCustomLab();
        } else this.openLab(ref);
        if (this.lab)
          this.lab = {
            ...this.lab,
            view: params.get("lab_view") === "compare" ? "compare" : "edit",
            detailTab: (["decoded", "timings", "code"].includes(
              params.get("lab_tab") || "",
            )
              ? params.get("lab_tab")
              : "timings") as LabState["detailTab"],
            convertFormat: params.get("format") || "pronto",
            binaryDecoderMode: this.routeBinaryDecoder(params),
            zoom: this.routeNumber(params, "zoom", 1, 1, 16),
            pan: this.routeNumber(params, "pan", 0, 0, 1),
            saveOpen: params.get("save") === "1",
            editingOverlays: params.get("overlays") === "1",
          };
        if (!custom) {
          const command =
            this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
              ?.commands?.[ref.cmdId];
          if (command) void this.refreshCommandAnalysis(ref, command);
        }
      } else if (screen === "catalog") {
        const modes = ["choices", "find", "match", "import"];
        const mode = (
          modes.includes(params.get("catalog_mode") || "")
            ? params.get("catalog_mode")
            : "choices"
        ) as CatalogState["mode"];
        const saved = this.readRouteSession<CatalogState>(ROUTE_CATALOG_KEY);
        const resumed = resumedCatalog?.mode === mode ? resumedCatalog : null;
        this.catalog =
          saved?.mode === mode
            ? saved
            : resumed || {
                mode,
                category: params.get("category") || "",
                brand: params.get("brand") || "",
                model: params.get("model") || "",
                importTargetKey: params.get("target") || "",
              };
        const profileId = params.get("profile") || "";
        if (profileId && this.catalog.selectedProfile?.profile_id !== profileId)
          await this.openCatalogProfile(profileId);
        else if (
          params.get("searched") === "1" &&
          mode === "find" &&
          !this.catalog.searched
        )
          await this.searchCatalog({
            category: params.get("category") || "",
            brand: params.get("brand") || "",
            model: params.get("model") || "",
          });
      } else if (screen === "command") {
        const command =
          this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
            ?.commands?.[ref.cmdId];
        if (command) {
          const tabs = ["overview", "signal", "code", "history"];
          const tab = (
            tabs.includes(params.get("tab") || "")
              ? params.get("tab")
              : "overview"
          ) as InspectorState["tab"];
          const nativeRepresentation = command.format || "raw_signed";
          const representation = params.get("format") || nativeRepresentation;
          const representations = {
            [nativeRepresentation]: command.code || "",
          };
          this.selectedLocation = ref.locId;
          this.selectedAppliance = ref.applianceId;
          this.inspector = {
            ...ref,
            tab,
            representation,
            representations,
            binaryDecoderMode: this.routeBinaryDecoder(params),
            zoom: this.routeNumber(params, "zoom", 1, 1, 16),
            pan: this.routeNumber(params, "pan", 0, 0, 1000),
            revisionSelected: params.has("revision")
              ? Number(params.get("revision"))
              : null,
          };
          void this.refreshCommandAnalysis(ref, command);
          if (tab === "history") await this.inspectorTab("history");
          else if (representation !== nativeRepresentation) {
            try {
              const converted = await this.requestRepresentation(
                ref,
                command,
                representation,
              );
              if (this.inspector)
                this.inspector = {
                  ...this.inspector,
                  representations: {
                    ...representations,
                    [representation]: converted.value,
                  },
                  conversionLossReport: converted.lossReport,
                };
            } catch (error) {
              this.setError(error);
            }
          }
        }
      } else if (screen === "library") {
        const location = this.registry.locations?.[ref.locId];
        const appliance = location?.appliances?.[ref.applianceId];
        if (location) this.selectedLocation = ref.locId;
        if (appliance) this.selectedAppliance = ref.applianceId;
      }
      await this.restoreRouteModal(params);
      this.lastRouteIdentity = this.routeIdentity(params);
    } finally {
      this.routeRestoring = false;
      this.routeRestored = true;
      this.scheduleRouteSync();
    }
  }

  private async restoreRouteModal(params: URLSearchParams) {
    const action = params.get("dialog") || "";
    if (!action) return;
    const saved = this.readRouteSession<ModalState>(ROUTE_MODAL_KEY);
    if (saved?.action === action) {
      this.modal = saved;
      return;
    }
    const ref = this.routeRef(params);
    if (action === "manage-locations") this.manageLocations();
    else if (action === "add-location") await this.addLocation();
    else if (action === "rename-command" && ref.cmdId)
      await this.renameCommand(ref);
    else if (action === "delete-command" && ref.cmdId)
      await this.deleteCommand(ref);
    else if (action === "rename-appliance" && ref.applianceId)
      await this.renameAppliance(ref);
    else if (action === "delete-appliance" && ref.applianceId)
      await this.deleteAppliance(ref);
    else if (action === "rename-location" && ref.locId)
      this.renameLocation(ref.locId);
    else if (action === "delete-location" && ref.locId)
      this.deleteLocation(ref.locId);
    else if (
      action === "restore-revision" &&
      this.inspector &&
      params.has("revision")
    )
      await this.restoreRevision({
        ...ref,
        revision: Number(params.get("revision")),
      });
  }

  private async retryRegistry() {
    this.loading = true;
    await this.loadRegistry();
    this.loading = false;
  }

  private async resumeStoredGuidedSession() {
    if (!this.services || !this.config.workspace) return;
    let sessionId = "";
    try {
      sessionId = localStorage.getItem(GUIDED_SESSION_KEY) || "";
    } catch {}
    if (!sessionId) return;
    try {
      const result = await this.services.call("catalog_guided_control", {
        session_id: sessionId,
        session_action: "status",
      });
      const session = result.session || result;
      if (["cancelled", "completed"].includes(session.status)) {
        try {
          localStorage.removeItem(GUIDED_SESSION_KEY);
        } catch {}
        return;
      }
      this.catalog = { mode: "match", candidates: session.candidates || [] };
      this.applyGuidedSession(session);
    } catch {
      try {
        localStorage.removeItem(GUIDED_SESSION_KEY);
      } catch {}
    }
  }

  private setError(value: unknown) {
    this.error = friendlyError(value);
    this.errorDetail =
      (value as any)?.message || (value as any)?.body?.message || String(value);
  }

  private async run<T>(operation: () => Promise<T>): Promise<T | undefined> {
    this.busy = true;
    this.error = "";
    this.errorDetail = "";
    this.message = "";
    try {
      return await operation();
    } catch (error) {
      this.setError(error);
      return undefined;
    } finally {
      this.busy = false;
    }
  }

  private startTicker() {
    window.clearInterval(this.ticker);
    this.ticker = window.setInterval(() => {
      this.now = Date.now();
      if (this.learn?.step === "waiting")
        this.learnRemaining = Math.max(
          0,
          Math.ceil((this.learn.deadline - this.now) / 1000),
        );
      if (this.catalog?.capturing)
        this.catalogMatchRemaining = Math.max(
          0,
          Math.ceil((Number(this.catalog.captureDeadline) - this.now) / 1000),
        );
      if (
        !this.learn &&
        !this.catalog?.capturing &&
        (!this.lab?.testCooldownUntil ||
          this.lab.testCooldownUntil <= this.now) &&
        this.guidedCooldownUntil <= this.now
      )
        window.clearInterval(this.ticker);
    }, 250);
  }

  private startLearn(seed: Partial<LearnState> = {}) {
    if (!this.emitterReady()) {
      this.error = "The selected IR emitter is unavailable.";
      return;
    }
    if (!this.emitterCanCapture()) {
      this.error =
        "The selected infrared device cannot receive signals for learning.";
      return;
    }
    if (!this.learn) {
      this.learnReturnFocus = deepActiveElement(this.renderRoot as ShadowRoot);
    }
    const timeout = Number(this.config.timeout || 60);
    const seq = ++this.learnSequence;
    const targetKey =
      seed.targetKey ??
      (seed.locationId && seed.applianceId
        ? `${seed.locationId}||${seed.applianceId}`
        : this.selectedLocation && this.selectedAppliance
          ? `${this.selectedLocation}||${this.selectedAppliance}`
          : "");
    this.learn = {
      seq,
      step: "waiting",
      locationId: seed.locationId ?? this.selectedLocation,
      applianceId: seed.applianceId ?? this.selectedAppliance,
      commandId: seed.commandId || "",
      name: seed.name || "",
      role: seed.role || "",
      targetKey,
      newApplianceName: seed.newApplianceName || "",
      code: "",
      deadline: Date.now() + timeout * 1000,
    };
    this.learnRemaining = timeout;
    this.inspector = null;
    this.catalog = null;
    this.error = "";
    this.message = "";
    this.startTicker();
    void this.captureLearn(seq);
  }

  private async captureLearn(seq: number) {
    if (!this.services) return;
    try {
      const result = await this.services.call("capture_signal", {
        timeout: Number(this.config.timeout || 60),
        poll_interval: Number(this.config.poll_interval || 2),
      });
      if (!this.learn || this.learn.seq !== seq) return;
      const code = result.code || "";
      if (!code) throw new Error("No IR code was received");
      this.learn = { ...this.learn, step: "preparing", code };
      const preparingStarted = performance.now();
      let preview: any = null,
        catalogMatches: any[] = [];
      try {
        preview = await this.services.call("analyze_signal", { code });
      } catch {
        /* Raw capture remains saveable. */
      }
      if (preview)
        try {
          catalogMatches =
            (
              await this.services.call("catalog_match_signal", {
                code,
                limit: 12,
              })
            ).matches || [];
        } catch {
          /* Matching is optional. */
        }
      if (!this.learn || this.learn.seq !== seq) return;
      const settleDelay = Math.max(
        0,
        320 - (performance.now() - preparingStarted),
      );
      if (settleDelay)
        await new Promise((resolve) => window.setTimeout(resolve, settleDelay));
      if (!this.learn || this.learn.seq !== seq) return;
      this.learn = {
        ...this.learn,
        step: "review",
        preview,
        catalogMatches,
        duplicateMatch: this.findDuplicate(preview, this.learn),
      };
    } catch (error) {
      if (!this.learn || this.learn.seq !== seq) return;
      this.learn = {
        ...this.learn,
        step: "error",
        error: friendlyError(error),
        errorDetail: (error as any)?.message || String(error),
      };
    }
  }

  private findDuplicate(preview: any, learn: LearnState) {
    const fingerprints = preview?.analysis?.fingerprints || {};
    const fingerprint = fingerprints.normalized_50us || fingerprints.exact;
    if (!fingerprint) return undefined;
    for (const item of allCommands(this.registry)) {
      if (
        item.locId === learn.locationId &&
        item.applianceId === learn.applianceId &&
        item.cmdId === learn.commandId
      )
        continue;
      const saved: any = item.command.analysis?.fingerprints || {};
      if (fingerprint === (saved.normalized_50us || saved.exact))
        return {
          locId: item.locId,
          applianceId: item.applianceId,
          cmdId: item.cmdId,
          commandName: item.command.name || item.cmdId,
          applianceName: item.appliance.name || item.applianceId,
        };
    }
    return undefined;
  }

  private async cancelLearn() {
    ++this.learnSequence;
    const current = this.learn;
    if (!current || !this.services) {
      this.learn = null;
      return;
    }
    this.busy = true;
    this.error = "";
    this.errorDetail = "";
    try {
      await this.services.call("cancel_capture");
      this.restoreLearnFocus = true;
      this.learn = null;
    } catch (error) {
      this.setError(error);
      this.learn = {
        ...current,
        seq: this.learnSequence,
        step: "error",
        error:
          "Cancellation did not complete. The receiver may still be leaving learn mode.",
        errorDetail: (error as any)?.message || String(error),
      };
    } finally {
      this.busy = false;
    }
  }

  private retryLearn() {
    const current = this.learn;
    if (!current) return;
    this.startLearn({
      locationId: current.locationId,
      applianceId: current.applianceId,
      commandId: current.commandId,
      name: current.name,
      role: current.role,
      targetKey: current.targetKey,
      newApplianceName: current.newApplianceName,
    });
  }

  private async testLearn() {
    if (!this.learn?.code || !this.services) return;
    await this.run(async () => {
      await this.services!.call("send_signal", { code: this.learn!.code });
      this.message = "Command sent once.";
    });
  }

  private async optimizeLearn() {
    const learn = this.learn;
    const timings = learn?.preview?.analysis?.single_press_candidate?.timings;
    if (
      !learn?.code ||
      !Array.isArray(timings) ||
      !timings.length ||
      !this.services
    )
      return;
    const carrierFrequency = Number(
      learn.preview?.signal?.carrier_frequency || 38_000,
    );
    const result = await this.run(async () => {
      const encoded = await this.services!.call("encode_signal", {
        timings,
        carrier_frequency: carrierFrequency,
      });
      const preview = await this.services!.call("analyze_signal", {
        code: encoded.code,
      });
      return { code: encoded.code, preview };
    });
    if (!result || !this.learn || this.learn.seq !== learn.seq) return;
    this.learn = {
      ...this.learn,
      originalCode: learn.originalCode || learn.code,
      originalPreview: learn.originalPreview || learn.preview,
      code: result.code,
      preview: result.preview,
      optimized: true,
    };
  }

  private async saveLearn(another: boolean) {
    const learn = this.learn;
    if (!learn || !this.services || !learn.name.trim()) return;
    await this.run(async () => {
      let locId = learn.locationId,
        applianceId = learn.applianceId;
      if (learn.targetKey && learn.targetKey !== "__new__")
        [locId, applianceId] = learn.targetKey.split("||");
      if (learn.targetKey === "__new__") {
        locId ||= "unsorted";
        if (!this.registry.locations?.[locId])
          await this.services!.call("create_location", {
            location_id: locId,
            name: locId === "unsorted" ? "Unsorted" : locId,
          });
        const base = slugify(learn.newApplianceName) || "remote";
        applianceId = this.uniqueApplianceId(locId, base);
        await this.services!.call("create_appliance", {
          location_id: locId,
          appliance_id: applianceId,
          name: learn.newApplianceName.trim() || "Unsorted remote",
          appliance_type: "generic",
        });
      }
      if (!locId || !applianceId) {
        locId = "unsorted";
        applianceId = "remote";
        if (!this.registry.locations?.[locId])
          await this.services!.call("create_location", {
            location_id: locId,
            name: "Unsorted",
          });
        if (!this.registry.locations?.[locId]?.appliances?.[applianceId])
          await this.services!.call("create_appliance", {
            location_id: locId,
            appliance_id: applianceId,
            name: "Unsorted remote",
            appliance_type: "generic",
          });
      }
      const commandId =
        learn.commandId ||
        this.uniqueCommandId(
          locId,
          applianceId,
          slugify(learn.name) || "button",
        );
      if (learn.optimized && learn.originalCode) {
        await this.services!.call("store_command", {
          location_id: locId,
          appliance_id: applianceId,
          command_id: commandId,
          name: learn.name.trim(),
          code: learn.originalCode,
          role: learn.role || "",
          source: {
            type: "captured_signal",
            retained_before_single_press_optimization: true,
          },
        });
      }
      await this.services!.call("store_command", {
        location_id: locId,
        appliance_id: applianceId,
        command_id: commandId,
        name: learn.name.trim(),
        code: learn.code,
        role: learn.role || "",
        ...(learn.optimized
          ? {
              source: {
                type: "single_press_optimization",
                original_capture_retained_as_prior_revision: true,
              },
            }
          : {}),
      });
      this.selectedLocation = locId;
      this.selectedAppliance = applianceId;
      await this.loadRegistry();
      this.learn = null;
      this.message = `Saved ${learn.name.trim()}.`;
      if (another)
        this.startLearn({
          locationId: locId,
          applianceId: applianceId,
          targetKey: `${locId}||${applianceId}`,
        });
      else {
        this.openInspector({ locId, applianceId, cmdId: commandId });
        this.pendingFocus = { locId, applianceId, cmdId: commandId };
      }
    });
  }

  private uniqueApplianceId(locId: string, base: string) {
    return uniqueKey(base, this.registry.locations?.[locId]?.appliances || {});
  }
  private uniqueLocationId(base: string) {
    return uniqueKey(base, this.registry.locations || {});
  }
  private uniqueCommandId(locId: string, applianceId: string, base: string) {
    return uniqueKey(
      base,
      this.registry.locations?.[locId]?.appliances?.[applianceId]?.commands ||
        {},
    );
  }

  private openInspector(ref: {
    locId: string;
    applianceId: string;
    cmdId: string;
  }) {
    const command =
      this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
        ?.commands?.[ref.cmdId];
    if (!command) return;
    const previous = this.inspector;
    const nativeRepresentation = command.format || "raw_signed";
    const representation = previous?.representation || nativeRepresentation;
    const cacheKey = this.representationCacheKey(ref, command, representation);
    const cached = this.representationCache.get(cacheKey);
    const next: InspectorState = {
      ...ref,
      tab: previous?.tab || "overview",
      representation,
      representations: {
        [nativeRepresentation]: command.code || "",
        ...(cached ? { [representation]: cached.value } : {}),
      },
      ...(cached?.lossReport
        ? { conversionLossReport: cached.lossReport }
        : {}),
      zoom: previous?.zoom || 1,
      pan: previous?.pan || 0,
      binaryDecoderMode: previous?.binaryDecoderMode || "auto",
    };
    this.selectedLocation = ref.locId;
    this.selectedAppliance = ref.applianceId;
    void this.refreshCommandAnalysis(ref, command);
    const sequence = ++this.inspectorOpenSequence;
    if (
      next.tab === "code" &&
      representation !== nativeRepresentation &&
      !cached &&
      this.services
    ) {
      void this.openInspectorAfterConversion(sequence, next, command, cacheKey);
      return;
    }
    this.inspector = next;
    if (this.inspector.tab === "history") void this.inspectorTab("history");
  }

  private representationCacheKey(
    ref: { locId: string; applianceId: string; cmdId: string },
    command: any,
    format: string,
  ) {
    return `${ref.locId}\u0000${ref.applianceId}\u0000${ref.cmdId}\u0000${command.current_revision || command.code || "current"}\u0000${format}`;
  }

  private analysisCacheKey(
    ref: { locId: string; applianceId: string; cmdId: string },
    command: any,
  ) {
    return `${ref.locId}\u0000${ref.applianceId}\u0000${ref.cmdId}\u0000${command.current_revision || command.code || "current"}`;
  }

  private async refreshCommandAnalysis(
    ref: { locId: string; applianceId: string; cmdId: string },
    command: any,
  ) {
    const analysisCurrent =
      command.analysis?.binary_payload &&
      command.analysis?.binary_decoders &&
      Array.isArray(command.analysis?.protocol_rebuilds) &&
      Number.isInteger(command.analysis?.repeated_frame_count);
    if (!this.services || !command?.code || analysisCurrent) return;
    const key = this.analysisCacheKey(ref, command);
    try {
      let analysis = this.analysisCache.get(key);
      if (!analysis) {
        const result = await this.services.call("analyze_signal", {
          code: command.code,
        });
        analysis = result?.analysis || {};
        this.analysisCache.set(key, analysis);
      }
      const location = this.registry.locations?.[ref.locId];
      const appliance = location?.appliances?.[ref.applianceId];
      const current = appliance?.commands?.[ref.cmdId];
      if (!location || !appliance || !current || current.code !== command.code)
        return;
      this.registry = {
        ...this.registry,
        locations: {
          ...this.registry.locations,
          [ref.locId]: {
            ...location,
            appliances: {
              ...location.appliances,
              [ref.applianceId]: {
                ...appliance,
                commands: {
                  ...appliance.commands,
                  [ref.cmdId]: { ...current, analysis },
                },
              },
            },
          },
        },
      };
      if (
        this.lab?.locId === ref.locId &&
        this.lab.applianceId === ref.applianceId &&
        this.lab.cmdId === ref.cmdId &&
        !this.lab.dirty
      ) {
        this.lab = { ...this.lab, sourceAnalysis: analysis };
      }
    } catch {
      // Stored analysis remains usable when an optional refresh fails.
    }
  }

  private async requestRepresentation(
    ref: { locId: string; applianceId: string; cmdId: string },
    command: any,
    format: string,
  ) {
    const cacheKey = this.representationCacheKey(ref, command, format);
    const cached = this.representationCache.get(cacheKey);
    if (cached) return cached;
    const result = await this.services!.call("convert_signal", {
      code: command.code,
      format: command.format || "raw_signed",
      output_format: format,
      carrier_frequency: command.signal?.carrier_frequency || 38_000,
      name: command.name || ref.cmdId,
    });
    const converted = {
      value: String(result?.value || ""),
      lossReport: result?.loss_report,
    };
    this.representationCache.set(cacheKey, converted);
    return converted;
  }

  private async openInspectorAfterConversion(
    sequence: number,
    next: InspectorState,
    command: any,
    cacheKey: string,
  ) {
    try {
      const converted = await this.requestRepresentation(
        next,
        command,
        String(next.representation),
      );
      if (sequence !== this.inspectorOpenSequence) return;
      this.inspector = {
        ...next,
        representations: {
          ...(next.representations || {}),
          [String(next.representation)]: converted.value,
        },
        conversionLossReport: converted.lossReport,
      };
      this.representationCache.set(cacheKey, converted);
    } catch (error) {
      if (sequence !== this.inspectorOpenSequence) return;
      this.inspector = next;
      this.setError(error);
    }
  }

  private inspectorViewChanged(detail: { zoom?: number; pan?: number }) {
    if (!this.inspector) return;
    this.inspector = {
      ...this.inspector,
      zoom: detail.zoom ?? this.inspector.zoom,
      pan: detail.pan ?? this.inspector.pan,
    };
  }

  private inspectorBinaryModeChanged(
    mode: InspectorState["binaryDecoderMode"],
  ) {
    if (!this.inspector || !mode) return;
    this.inspector = { ...this.inspector, binaryDecoderMode: mode };
  }

  private closeInspector() {
    const ref = this.inspector;
    this.inspector = null;
    if (ref)
      this.pendingFocus = {
        locId: ref.locId,
        applianceId: ref.applianceId,
        cmdId: ref.cmdId,
      };
  }

  private async inspectorTab(tab: InspectorState["tab"]) {
    if (!this.inspector) return;
    this.inspector = { ...this.inspector, tab };
    if (tab !== "history" || this.inspector.history || !this.services) return;
    const context = this.inspector;
    this.inspector = { ...context, loading: true };
    const result = await this.run(() =>
      this.services!.call("command_history", {
        location_id: context.locId,
        appliance_id: context.applianceId,
        command_id: context.cmdId,
      }),
    );
    if (result && this.inspector?.cmdId === context.cmdId)
      this.inspector = { ...this.inspector, history: result, loading: false };
  }

  private async sendCommand(ref: {
    locId: string;
    applianceId: string;
    cmdId: string;
  }) {
    const key = `${ref.locId}\u0000${ref.applianceId}\u0000${ref.cmdId}`;
    window.clearTimeout(this.sendFeedbackTimers.get(key));
    this.sendFeedbackTimers.delete(key);
    this.sendFeedback = {
      ...this.sendFeedback,
      [key]: { kind: "pending", message: "Sending…" },
    };
    try {
      await this.services!.call("send_command", {
        location_id: ref.locId,
        appliance_id: ref.applianceId,
        command_id: ref.cmdId,
      });
      this.sendFeedback = {
        ...this.sendFeedback,
        [key]: { kind: "success", message: "Sent once" },
      };
      this.sendFeedbackTimers.set(
        key,
        window.setTimeout(() => {
          if (this.sendFeedback[key]?.kind === "success") {
            const next = { ...this.sendFeedback };
            delete next[key];
            this.sendFeedback = next;
          }
          this.sendFeedbackTimers.delete(key);
        }, 1000),
      );
    } catch (error) {
      const message = friendlyError(error);
      const detail = (error as any)?.message || String(error);
      this.sendFeedback = {
        ...this.sendFeedback,
        [key]: { kind: "error", message, detail },
      };
    }
  }

  private async convertRepresentation(detail: any) {
    if (!this.inspector || !this.services) return;
    const command =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId]
        ?.commands?.[detail.cmdId];
    if (!command) return;
    const context = {
      ...this.inspector,
      representation: detail.format,
      representationLoading: true,
    };
    this.inspector = context;
    const result = await this.run(async () =>
      this.requestRepresentation(detail, command, detail.format),
    );
    if (this.inspector?.cmdId === detail.cmdId)
      this.inspector = {
        ...this.inspector,
        representation: detail.format,
        representationLoading: false,
        representations: {
          ...(this.inspector.representations || {}),
          [detail.format]: result?.value || "",
        },
        conversionLossReport: result?.lossReport,
      } as InspectorState;
  }

  private async deleteCommand(ref: any) {
    const command =
      this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
        ?.commands?.[ref.cmdId];
    this.modal = {
      type: "confirm",
      action: "delete-command",
      heading: "Delete command?",
      text: `“${command?.name || ref.cmdId}” and its revision history will be removed.`,
      confirmLabel: "Delete command",
      data: { ...ref },
    };
  }

  private async renameCommand(ref: any) {
    const command =
      this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
        ?.commands?.[ref.cmdId];
    if (ref.name) {
      await this.run(async () => {
        await this.services!.call("rename_command", {
          location_id: ref.locId,
          appliance_id: ref.applianceId,
          command_id: ref.cmdId,
          name: ref.name.trim(),
        });
        await this.loadRegistry();
        this.openInspector(ref);
        this.message = "Command renamed.";
      });
      return;
    }
    this.modal = {
      type: "form",
      action: "rename-command",
      heading: "Rename command",
      confirmLabel: "Save name",
      data: { ...ref, name: command?.name || ref.cmdId },
    };
  }

  private async addLocation() {
    this.modal = {
      type: "form",
      action: "add-location",
      heading: "Add location",
      confirmLabel: "Add location",
      data: { name: "", id: "", idTouched: false },
    };
  }

  private manageLocations() {
    this.modal = {
      type: "locations",
      action: "manage-locations",
      heading: "Locations",
      data: {},
    };
  }

  private renameLocation(locId: string) {
    const location = this.registry.locations?.[locId];
    this.modal = {
      type: "form",
      action: "rename-location",
      heading: "Rename location",
      confirmLabel: "Save name",
      data: { locId, name: location?.name || locId },
    };
  }

  private deleteLocation(locId: string) {
    const location = this.registry.locations?.[locId];
    const appliances = Object.values(location?.appliances || {});
    const commands = appliances.reduce(
      (total, appliance) =>
        total + Object.keys(appliance.commands || {}).length,
      0,
    );
    this.modal = {
      type: "confirm",
      action: "delete-location",
      heading: "Delete location?",
      text: `“${location?.name || locId}” contains ${appliances.length} appliance${appliances.length === 1 ? "" : "s"} and ${commands} command${commands === 1 ? "" : "s"}. Everything in it will be removed.`,
      confirmLabel: "Delete location",
      data: { locId },
    };
  }

  private async applianceActions(detail: any) {
    const appliance =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId];
    this.modal = {
      type: "form",
      action: "rename-appliance",
      heading: "Rename appliance",
      confirmLabel: "Save name",
      data: { ...detail, name: appliance?.name || detail.applianceId },
    };
  }

  private openLab(ref: any) {
    const command =
      this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
        ?.commands?.[ref.cmdId];
    const timings = command?.signal?.timings;
    if (!command || !timings?.length) return;
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
    this.lab = {
      locId: ref.locId,
      applianceId: ref.applianceId,
      cmdId: ref.cmdId,
      sourceName: command.name || ref.cmdId,
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
      binaryDecoderMode: ref.binaryDecoderMode || "auto",
      saveOpen: false,
      editingOverlays: false,
      snap: 10,
      boundaryMode: "shift",
      dirty: false,
      saveName: `${command.name || ref.cmdId} experiment`,
      saveId: this.uniqueCommandId(
        ref.locId,
        ref.applianceId,
        `${ref.cmdId}_experiment`,
      ),
      idTouched: false,
    };
    this.inspector = null;
    this.startTicker();
    void this.refreshCommandAnalysis(ref, command);
  }

  private commitLab(
    timings: number[],
    frameRoles = this.lab?.frameRoles || [],
    carrierFrequency = this.lab?.carrierFrequency || 38_000,
  ) {
    if (
      !this.lab ||
      !timings.length ||
      timings.some(
        (value) => !Number.isInteger(value) || value < 1 || value > 65_535,
      )
    )
      return;
    const previous = snapshot(this.lab);
    this.lab = {
      ...this.lab,
      timings: [...timings],
      frameRoles: [...frameRoles],
      carrierFrequency,
      undo: [...this.lab.undo, previous].slice(-100),
      redo: [],
    };
    this.lab = { ...this.lab, dirty: draftDirty(this.lab) };
    this.scheduleLabAnalysis();
  }

  private scheduleLabAnalysis() {
    window.clearTimeout(this.labAnalysisTimer);
    const sequence = ++this.labAnalysisSequence;
    const lab = this.lab;
    if (!lab || !this.services) return;
    if (!lab.dirty) {
      this.lab = { ...lab, draftAnalysis: undefined, analysisPending: false };
      return;
    }
    const timings = [...lab.timings];
    const carrierFrequency = lab.carrierFrequency;
    this.lab = { ...lab, draftAnalysis: {}, analysisPending: true };
    this.labAnalysisTimer = window.setTimeout(async () => {
      try {
        const encoded = await this.services!.call("encode_signal", {
          timings,
          carrier_frequency: carrierFrequency,
        });
        if (!encoded.code) throw new Error("The draft could not be encoded");
        const analyzed = await this.services!.call("analyze_signal", {
          code: encoded.code,
        });
        if (
          sequence === this.labAnalysisSequence &&
          this.lab &&
          this.lab.carrierFrequency === carrierFrequency &&
          JSON.stringify(this.lab.timings) === JSON.stringify(timings)
        )
          this.lab = {
            ...this.lab,
            draftAnalysis: analyzed.analysis || {},
            analysisPending: false,
          };
      } catch {
        if (sequence === this.labAnalysisSequence && this.lab)
          this.lab = { ...this.lab, draftAnalysis: {}, analysisPending: false };
      }
    }, 450);
  }

  private async previewLab(detail: any) {
    const lab = this.lab;
    if (!lab || !this.services || !Array.isArray(detail.timings)) return;
    await this.run(async () => {
      let encodedTimings: number[] | null = null;
      let analysis = lab.draftAnalysis || lab.sourceAnalysis;
      let compatible = true;
      try {
        const encoded = await this.services!.call("encode_signal", {
          timings: detail.timings,
          carrier_frequency: lab.carrierFrequency,
        });
        compatible = encoded?.loss_report?.lossless !== false;
        if (encoded.code) {
          const analyzed = await this.services!.call("analyze_signal", {
            code: encoded.code,
          });
          encodedTimings = analyzed?.signal?.timings || null;
          analysis = analyzed?.analysis || analysis;
        }
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
      if (this.lab === lab) this.lab = { ...lab, preview };
    });
  }

  private async previewProtocolRebuild(detail: any) {
    const lab = this.lab;
    if (!lab || !this.services || !detail.rebuildId) return;
    await this.run(async () => {
      const encoded = await this.services!.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      if (!encoded.code)
        throw new Error("The current draft could not be encoded");
      const result = await this.services!.call("rebuild_signal", {
        code: encoded.code,
        format: "raw_signed",
        carrier_frequency: lab.carrierFrequency,
        rebuild_id: detail.rebuildId,
      });
      const timings = result?.signal?.timings;
      const carrierFrequency = Number(result?.signal?.carrier_frequency || 0);
      if (!Array.isArray(timings) || !timings.length || carrierFrequency < 1)
        throw new Error("The selected protocol could not rebuild this draft");
      const protocol = String(
        result?.rebuild?.protocol || detail.protocol || "recognized protocol",
      );
      const preview = previewImpact(
        `Rebuild as ${protocol}`,
        lab.timings,
        timings,
        timings,
        result.analysis || {},
        "",
      );
      preview.protocol = protocol;
      preview.carrierFrequency = carrierFrequency;
      preview.description = `Decoded fields were re-encoded with the ${protocol} protocol definition.`;
      preview.timingBasis = `${protocol} protocol definition`;
      preview.applyLabel = `Apply ${protocol} rebuild`;
      const roles = result?.analysis?.frame_roles;
      preview.frameRoles = Array.isArray(roles)
        ? roles.map((role: any) =>
            typeof role === "string"
              ? role
              : String(role?.role || role?.kind || "auto"),
          )
        : [];
      preview.compatible = timings.every(
        (value: unknown) =>
          Number.isInteger(value) &&
          Number(value) >= 1 &&
          Number(value) <= 65_535,
      );
      if (this.lab === lab) this.lab = { ...lab, preview };
    });
  }

  private async testLab(detail: any = {}) {
    if (this.lab && Array.isArray(detail.timings))
      this.lab = {
        ...this.lab,
        timings: [...detail.timings],
        carrierFrequency: Number(
          detail.carrierFrequency || this.lab.carrierFrequency,
        ),
      };
    const lab = this.lab;
    if (!lab || !this.services || (lab.testCooldownUntil || 0) > Date.now())
      return;
    const validation = validateDraft(
      lab.timings,
      lab.carrierFrequency,
      lab.draftAnalysis || lab.sourceAnalysis,
      lab.dirty,
    );
    if (!validation.valid) return;
    await this.run(async () => {
      const encoded = await this.services!.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      if (!encoded.code)
        throw new Error("The edited timings could not be encoded");
      await this.services!.call("send_signal", { code: encoded.code });
      if (this.lab === lab)
        this.lab = { ...lab, testCooldownUntil: Date.now() + 2_000 };
      this.message = "Experiment sent once.";
      this.startTicker();
    });
  }

  private async saveLab(detail: any = {}) {
    if (this.lab && Array.isArray(detail.timings))
      this.lab = {
        ...this.lab,
        timings: [...detail.timings],
        carrierFrequency: Number(
          detail.carrierFrequency || this.lab.carrierFrequency,
        ),
        frameRoles: [...(detail.frameRoles || this.lab.frameRoles)],
      };
    const lab = this.lab;
    if (!lab || !this.services || !validId(lab.saveId)) return;
    const commands =
      this.registry.locations?.[lab.locId]?.appliances?.[lab.applianceId]
        ?.commands || {};
    if (commands[lab.saveId]) {
      this.error = `A command with ID “${lab.saveId}” already exists.`;
      return;
    }
    await this.run(async () => {
      let locId = lab.locId,
        applianceId = lab.applianceId;
      if (!locId || !applianceId) {
        locId = "unsorted";
        applianceId = "remote";
      }
      if (!this.registry.locations?.[locId])
        await this.services!.call("create_location", {
          location_id: locId,
          name: locId === "unsorted" ? "Unsorted" : locId,
        });
      if (!this.registry.locations?.[locId]?.appliances?.[applianceId])
        await this.services!.call("create_appliance", {
          location_id: locId,
          appliance_id: applianceId,
          name:
            locId === "unsorted" && applianceId === "remote"
              ? "Unsorted remote"
              : applianceId,
          appliance_type: "generic",
        });
      const encoded = await this.services!.call("encode_signal", {
        timings: lab.timings,
        carrier_frequency: lab.carrierFrequency,
      });
      if (!encoded.code) throw new Error("The experiment could not be encoded");
      await this.services!.call("store_command", {
        location_id: locId,
        appliance_id: applianceId,
        command_id: lab.saveId,
        name: lab.saveName.trim() || lab.saveId,
        code: encoded.code,
        source: {
          type: "signal_lab",
          based_on_command: lab.cmdId || null,
          carrier_frequency: lab.carrierFrequency,
          frame_roles: lab.frameRoles,
        },
      });
      const focus = { locId, applianceId, cmdId: lab.saveId };
      this.lab = null;
      await this.loadRegistry();
      this.openInspector(focus);
      this.pendingFocus = focus;
      this.message = `Saved ${lab.saveName.trim() || lab.saveId}.`;
    });
  }

  private leaveLab(discard = false, keepDraft = false) {
    if (!this.lab) return;
    if (this.lab.dirty && !discard && !keepDraft) {
      this.lab = { ...this.lab, leavePrompt: true };
      return;
    }
    if (keepDraft) this.suspendedLab = { ...this.lab, leavePrompt: false };
    if (discard) this.suspendedLab = null;
    const source = {
      locId: this.lab.locId,
      applianceId: this.lab.applianceId,
      cmdId: this.lab.cmdId,
    };
    this.lab = null;
    this.openInspector(source);
  }

  private openCustomLab() {
    const timings = [560, 560];
    this.lab = {
      locId: this.selectedLocation || "unsorted",
      applianceId: this.selectedAppliance || "remote",
      cmdId: "",
      sourceName: "New custom signal",
      sourceRevision: 0,
      original: [...timings],
      timings: [...timings],
      carrierFrequency: 38_000,
      originalCarrierFrequency: 38_000,
      carrierSource: "assumed",
      sourceAnalysis: {},
      undo: [],
      redo: [],
      selected: 0,
      selectionStart: 0,
      selectionEnd: 1,
      selectedFrame: 0,
      frameRoles: [],
      originalFrameRoles: [],
      zoom: 1,
      pan: 0,
      cursors: [0, 1120],
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
      custom: true,
      saveName: "",
      saveId: "",
      idTouched: false,
    };
    this.inspector = null;
  }

  private updateLabWithPrevious(
    timings: number[],
    previousTimings: number[],
    frameRoles = this.lab?.frameRoles || [],
    previousRoles = this.lab?.frameRoles || [],
  ) {
    const lab = this.lab;
    if (!lab) return;
    const previous = {
      timings: [...previousTimings],
      frameRoles: [...previousRoles],
      carrierFrequency: lab.carrierFrequency,
    };
    const next = {
      ...lab,
      timings: [...timings],
      frameRoles: [...frameRoles],
      undo: [...lab.undo, previous].slice(-100),
      redo: [],
    };
    next.dirty = draftDirty(next);
    this.lab = next;
    this.scheduleLabAnalysis();
  }

  private frameAction(detail: any) {
    const lab = this.lab;
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
      this.lab = {
        ...lab,
        selectedFrame: index,
        selected: frame.start,
        selectionStart: frame.start,
        selectionEnd: frame.end - 1,
      };
      return;
    }
    if (detail.operation === "role") {
      const roles = [...lab.frameRoles];
      while (roles.length < frames.length) roles.push("auto");
      roles[index] = detail.role;
      this.updateLabWithPrevious(
        lab.timings,
        lab.timings,
        roles,
        lab.frameRoles,
      );
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
      this.updateLabWithPrevious(
        chunks.flat(),
        lab.timings,
        roles,
        lab.frameRoles,
      );
      if (this.lab) this.lab = { ...this.lab, selectedFrame: target };
      return;
    }
    if (detail.operation === "split") {
      const timingIndex = Number(detail.timingIndex);
      if (
        timingIndex % 2 === 0 ||
        timingIndex >= lab.timings.length - 1 ||
        lab.timings[timingIndex] >= 10_000
      )
        return;
      const next = [...lab.timings];
      next[timingIndex] = 10_000;
      roles.splice(index + 1, 0, "auto");
      this.updateLabWithPrevious(next, lab.timings, roles, lab.frameRoles);
      return;
    }
    if (detail.operation === "join" && frame.gapIndex != null) {
      const next = [...lab.timings];
      next[frame.gapIndex] = 560;
      roles.splice(index + 1, 1);
      this.updateLabWithPrevious(next, lab.timings, roles, lab.frameRoles);
      return;
    }
    if (["duplicate", "expand-repeat"].includes(detail.operation)) {
      chunks.splice(index + 1, 0, [...chunks[index]]);
      roles.splice(index + 1, 0, roles[index]);
      this.updateLabWithPrevious(
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
      this.updateLabWithPrevious(
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
    )
      this.commitLab(lab.timings.slice(2));
    if (
      detail.operation === "trim-trailing" &&
      lab.timings.length > 1 &&
      lab.timings.length % 2 === 0 &&
      lab.timings.at(-1)! >= 10_000
    )
      this.commitLab(lab.timings.slice(0, -1));
  }

  private async copyLab(detail: any) {
    if (detail.handled) return;
    if (detail.format !== "pronto" || !this.services) {
      if (detail.text) await copyText(detail.text);
      if (detail.cut) this.deleteLabSelection(detail);
      return;
    }
    await this.run(async () => {
      const encoded = await this.services!.call("encode_signal", {
        timings: detail.timings,
        carrier_frequency: detail.carrierFrequency,
      });
      const converted = await this.services!.call("convert_signal", {
        code: encoded.code,
        format: "raw_signed",
        output_format: "pronto",
        carrier_frequency: detail.carrierFrequency,
        name: this.lab?.saveName || "signal",
      });
      if (!converted.value)
        throw new Error("Pronto conversion returned no value");
      await copyText(converted.value);
      if (detail.cut) this.deleteLabSelection(detail);
      this.message = "Pronto timing selection copied.";
    });
  }

  private deleteLabSelection(detail: any) {
    const lab = this.lab;
    if (!lab) return;
    const start = Math.max(0, Number(detail.start ?? lab.selectionStart));
    const end = Math.min(
      lab.timings.length - 1,
      Number(detail.end ?? lab.selectionEnd),
    );
    if (end - start + 1 >= lab.timings.length || (end - start + 1) % 2) return;
    const next = [...lab.timings];
    next.splice(start, end - start + 1);
    this.commitLab(next);
    if (this.lab)
      this.lab = {
        ...this.lab,
        selected: Math.min(start, next.length - 1),
        selectionStart: Math.min(start, next.length - 1),
        selectionEnd: Math.min(start, next.length - 1),
      };
  }

  private async pasteRequest(detail: any) {
    if (!this.services || !this.lab) return;
    await this.run(async () => {
      const converted = await this.services!.call("convert_signal", {
        code: detail.text,
        format: detail.format,
        output_format: "raw_signed",
        carrier_frequency:
          detail.carrierFrequency || this.lab!.carrierFrequency,
        name: "Pasted signal",
      });
      const analyzed = await this.services!.call("analyze_signal", {
        code: converted.value,
        format: "raw_signed",
      });
      const inserted = analyzed?.signal?.timings;
      if (!Array.isArray(inserted) || !inserted.length)
        throw new Error("The pasted signal did not contain usable timings");
      const next = [...this.lab!.timings];
      next.splice(detail.start, detail.end - detail.start + 1, ...inserted);
      const preview = previewImpact(
        "Paste timing data",
        this.lab!.timings,
        next,
        inserted,
        analyzed.analysis || {},
        "Review mark/space alignment before applying.",
      );
      preview.insertTimings = inserted;
      this.lab = {
        ...this.lab!,
        preview,
        pasteStart: detail.start,
        pasteEnd: detail.end,
      } as LabState;
    });
  }

  private async loadCodeRepresentation(detail: any) {
    const lab = this.lab;
    if (!lab || !this.services) return;
    const key = String(detail.key || "");
    this.lab = {
      ...lab,
      codeRepresentation: { key, format: detail.format, loading: true },
    };
    try {
      const encoded = await this.services.call("encode_signal", {
        timings: detail.timings || lab.timings,
        carrier_frequency: detail.carrierFrequency || lab.carrierFrequency,
      });
      if (!encoded.code)
        throw new Error("The current draft could not be encoded.");
      const converted = await this.services.call("convert_signal", {
        code: encoded.code,
        format: "raw_signed",
        output_format: detail.format,
        carrier_frequency: detail.carrierFrequency || lab.carrierFrequency,
        name: lab.saveName,
      });
      if (!converted.value)
        throw new Error(
          `The current draft cannot be represented as ${String(detail.format || "this format").replaceAll("_", " ")}.`,
        );
      if (this.lab?.codeRepresentation?.key === key)
        this.lab = {
          ...this.lab,
          codeRepresentation: {
            key,
            format: detail.format,
            value: String(converted.value),
            loading: false,
            lossReport: converted.loss_report,
          },
        };
    } catch (error) {
      if (this.lab?.codeRepresentation?.key === key)
        this.lab = {
          ...this.lab,
          codeRepresentation: {
            key,
            format: detail.format,
            loading: false,
            error: friendlyError(error),
          },
        };
    }
  }

  private onLabAction(event: CustomEvent<any>) {
    const detail = event.detail || {};
    const lab = this.lab;
    if (!lab) return;
    switch (detail.action) {
      case "preview":
        void this.previewLab(detail);
        break;
      case "rebuild-preview":
        void this.previewProtocolRebuild(detail);
        break;
      case "preview-apply": {
        const timings = detail.timings || lab.preview?.timings;
        if (timings) {
          this.lab = { ...lab, preview: undefined };
          this.commitLab(
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
        this.lab = { ...lab, preview: undefined };
        break;
      case "undo":
        if (lab.undo.length) {
          const previous = lab.undo.at(-1)!;
          this.lab = {
            ...lab,
            timings: [...previous.timings],
            frameRoles: [...previous.frameRoles],
            carrierFrequency: previous.carrierFrequency,
            undo: lab.undo.slice(0, -1),
            redo: [...lab.redo, snapshot(lab)],
          };
          this.lab.dirty = draftDirty(this.lab);
          this.scheduleLabAnalysis();
        }
        break;
      case "redo":
        if (lab.redo.length) {
          const next = lab.redo.at(-1)!;
          this.lab = {
            ...lab,
            timings: [...next.timings],
            frameRoles: [...next.frameRoles],
            carrierFrequency: next.carrierFrequency,
            redo: lab.redo.slice(0, -1),
            undo: [...lab.undo, snapshot(lab)],
          };
          this.lab.dirty = draftDirty(this.lab);
          this.scheduleLabAnalysis();
        }
        break;
      case "reset":
        this.commitLab(
          [...lab.original],
          [...lab.originalFrameRoles],
          lab.originalCarrierFrequency,
        );
        break;
      case "test":
        void this.testLab(detail);
        break;
      case "save":
        void this.saveLab(detail);
        break;
      case "leave":
        this.leaveLab();
        break;
      case "discard-leave":
        this.leaveLab(true);
        break;
      case "keep-draft-leave":
        this.leaveLab(false, true);
        break;
      case "continue":
        this.lab = { ...lab, leavePrompt: false };
        break;
      case "ui":
        this.lab = { ...lab, ...(detail.patch || {}) };
        break;
      case "view":
        this.lab = { ...lab, view: detail.view };
        break;
      case "zoom":
        this.lab = {
          ...lab,
          zoom: Number(detail.zoom),
          ...(detail.pan != null ? { pan: Number(detail.pan) } : {}),
          ...(detail.anchorTime != null
            ? { zoomAnchorTime: Number(detail.anchorTime) }
            : {}),
        } as LabState;
        break;
      case "select":
        this.lab = {
          ...lab,
          selected: Number(detail.index),
          selectionStart: Number(detail.selectionStart ?? detail.index),
          selectionEnd: Number(detail.selectionEnd ?? detail.index),
        };
        break;
      case "cursor": {
        const cursors: [number, number] = [...lab.cursors] as [number, number];
        const index = detail.index === 1 ? 1 : 0;
        cursors[index] = Number(detail.time);
        this.lab = { ...lab, cursors, activeCursor: index };
        break;
      }
      case "edge":
        if (detail.phase === "preview") {
          const next = { ...lab, timings: [...detail.timings] };
          next.dirty = draftDirty(next);
          this.lab = next;
        } else if (detail.phase === "cancel") {
          const next = { ...lab, timings: [...detail.baseline] };
          next.dirty = draftDirty(next);
          this.lab = next;
        } else if (detail.phase === "commit")
          this.updateLabWithPrevious(detail.timings, detail.baseline);
        break;
      case "timing": {
        const timings = [...lab.timings];
        const snap = lab.snap || 0;
        let value = Math.round(Number(detail.value));
        if (snap) value = Math.round(value / snap) * snap;
        timings[Number(detail.index)] = value;
        this.commitLab(timings);
        break;
      }
      case "nudge": {
        const timings = [...lab.timings];
        const index = Number(detail.index ?? lab.selected);
        timings[index] = Math.max(
          1,
          Math.min(65_535, timings[index] + Number(detail.amount || 0)),
        );
        this.commitLab(timings);
        break;
      }
      case "reset-selected": {
        const index = Number(detail.index ?? lab.selected);
        if (lab.original[index] != null) {
          const timings = [...lab.timings];
          timings[index] = lab.original[index];
          this.commitLab(timings);
        }
        break;
      }
      case "duplicate-selection": {
        const start = Number(detail.start),
          end = Number(detail.end),
          values = lab.timings.slice(start, end + 1);
        if (values.length && values.length % 2 === 0) {
          const timings = [...lab.timings];
          timings.splice(end + 1, 0, ...values);
          this.commitLab(timings);
        }
        break;
      }
      case "delete-selection":
        this.deleteLabSelection(detail);
        break;
      case "reset-selection": {
        const start = Number(detail.start),
          end = Number(detail.end);
        if (start >= 0 && end < lab.original.length) {
          const timings = [...lab.timings];
          for (let index = start; index <= end; index++)
            timings[index] = lab.original[index];
          this.commitLab(timings);
        }
        break;
      }
      case "add-pair": {
        const at = Math.min(lab.timings.length, Number(detail.after) + 1);
        const timings = [...lab.timings];
        timings.splice(at, 0, 560, 560);
        this.commitLab(timings);
        break;
      }
      case "merge": {
        const index = Number(detail.index);
        if (index >= 0 && index + 2 < lab.timings.length) {
          const timings = [...lab.timings];
          timings[index] += timings[index + 2];
          timings.splice(index + 1, 2);
          this.commitLab(timings);
        }
        break;
      }
      case "frame":
        this.frameAction(detail);
        break;
      case "copy":
        void this.copyLab(detail);
        break;
      case "paste-request":
        void this.pasteRequest(detail);
        break;
      case "paste-apply":
        if (Array.isArray(detail.timings)) this.commitLab(detail.timings);
        break;
      case "clipboard-error":
        this.error = "Clipboard access is unavailable on this page.";
        break;
      case "code-representation":
        void this.loadCodeRepresentation(detail);
        break;
      case "target": {
        const [locId, applianceId] = String(detail.targetKey || "").split("||");
        if (locId && applianceId) this.lab = { ...lab, locId, applianceId };
        break;
      }
      case "field":
        if (detail.field === "carrierFrequency") {
          this.lab = {
            ...lab,
            carrierFrequency: Number(detail.value),
            undo: [...lab.undo, snapshot(lab)].slice(-100),
            redo: [],
          };
          this.lab = { ...this.lab, dirty: draftDirty(this.lab) };
          this.scheduleLabAnalysis();
        } else
          this.lab = {
            ...lab,
            [detail.field]: detail.value,
            ...(detail.saveId ? { saveId: detail.saveId } : {}),
            ...(detail.field === "saveId" ? { idTouched: true } : {}),
          };
        break;
      default:
        this.onAdvancedLabAction(detail);
        break;
    }
  }

  private onAdvancedLabAction(detail: any) {
    const lab = this.lab;
    if (!lab) return;
    if (Array.isArray(detail.timings) && detail.commit)
      this.commitLab(detail.timings, detail.frameRoles || lab.frameRoles);
    else if (detail.patch) {
      const next = { ...lab, ...detail.patch } as LabState;
      if (detail.patch.timings) next.dirty = draftDirty(next);
      this.lab = next;
    }
  }

  private openCatalog(
    mode: CatalogState["mode"] = "choices",
    importTargetKey = "",
  ) {
    this.catalog = { mode, ...(importTargetKey ? { importTargetKey } : {}) };
    this.inspector = null;
  }

  private async searchCatalog(detail: any) {
    if (!this.services || !this.catalog || !String(detail.brand || "").trim())
      return;
    const result = await this.run(() =>
      this.services!.call("catalog_search", {
        category: detail.category || "tv",
        brand: String(detail.brand).trim(),
        model: String(detail.model || "").trim(),
      }),
    );
    if (result && this.catalog)
      this.catalog = {
        ...this.catalog,
        searched: true,
        results: result.profiles || [],
        catalog: result.catalog || {},
        category: detail.category,
        brand: detail.brand,
        model: detail.model,
      };
  }

  private async openCatalogProfile(profileId: string) {
    if (!this.services || !this.catalog) return;
    const data: Dict = { profile_id: profileId };
    if (this.selectedLocation && this.selectedAppliance)
      Object.assign(data, {
        location_id: this.selectedLocation,
        appliance_id: this.selectedAppliance,
      });
    const profile = await this.run(() =>
      this.services!.call("catalog_profile", data),
    );
    if (profile && this.catalog)
      this.catalog = {
        ...this.catalog,
        selectedProfile: profile,
        importPlan: profile.import_plan,
      };
  }

  private async testCatalogCommand(detail: any) {
    const profile: any = this.catalog?.selectedProfile;
    const command = (profile?.commands || []).find(
      (item: any) => item.command_id === detail.commandId,
    );
    if (!command?.code || !this.services || !this.emitterReady()) return;
    await this.run(async () => {
      await this.services!.call("send_signal", { code: command.code });
      this.message = `${command.name || detail.commandId} sent once.`;
    });
  }

  private applyGuidedSession(session: any) {
    if (!this.catalog) return;
    this.catalog = {
      ...this.catalog,
      guidedSession: session,
      candidates: session.candidates || this.catalog.candidates,
    };
    const remainingDelay = Math.max(
      0,
      Number(session.remaining_delay_seconds || 0),
    );
    this.guidedCooldownUntil =
      remainingDelay > 0 ? Date.now() + remainingDelay * 1000 : 0;
    try {
      if (
        session.session_id &&
        !["cancelled", "completed"].includes(session.status)
      )
        localStorage.setItem(GUIDED_SESSION_KEY, session.session_id);
      else localStorage.removeItem(GUIDED_SESSION_KEY);
    } catch {
      /* Optional continuity. */
    }
    if (this.guidedCooldownUntil > Date.now()) this.startTicker();
  }

  private async startGuided() {
    if (!this.services || !this.catalog) return;
    const profile: any = this.catalog.selectedProfile;
    const result = await this.run(() =>
      this.services!.call("catalog_guided_start", {
        category: profile?.category || this.catalog!.category || "tv",
        brand: profile?.brand || this.catalog!.brand || "",
      }),
    );
    if (result) this.applyGuidedSession(result.session || result);
  }

  private async guidedTest() {
    const session: any = this.catalog?.guidedSession;
    const candidate = session?.current_candidate;
    if (!session?.session_id || !candidate?.candidate_id || !this.services)
      return;
    const result = await this.run(() =>
      this.services!.call("catalog_guided_test", {
        session_id: session.session_id,
        candidate_id: candidate.candidate_id,
      }),
    );
    if (result) this.applyGuidedSession(result.session || result);
  }

  private async guidedAnswer(resultValue: string) {
    const session: any = this.catalog?.guidedSession;
    const candidate = session?.current_candidate;
    if (
      !session?.session_id ||
      !candidate?.candidate_id ||
      !this.services ||
      !["worked", "no_response", "not_sure"].includes(resultValue)
    )
      return;
    const result = await this.run(() =>
      this.services!.call("catalog_guided_answer", {
        session_id: session.session_id,
        candidate_id: candidate.candidate_id,
        result: resultValue,
      }),
    );
    if (result) this.applyGuidedSession(result.session || result);
  }

  private async guidedControl(command: string) {
    const session: any = this.catalog?.guidedSession;
    if (
      !session?.session_id ||
      !this.services ||
      !["status", "pause", "resume", "cancel"].includes(command)
    )
      return;
    const result = await this.run(() =>
      this.services!.call("catalog_guided_control", {
        session_id: session.session_id,
        session_action: command,
      }),
    );
    if (command === "cancel") {
      try {
        localStorage.removeItem(GUIDED_SESSION_KEY);
      } catch {}
      this.guidedCooldownUntil = 0;
      this.catalog = { mode: "choices" };
    } else if (result) this.applyGuidedSession(result.session || result);
  }

  private async restoreNativeImport() {
    if (!this.services || !this.importText.trim()) return;
    const result = await this.run(() =>
      this.services!.call("import_backup", { code: this.importText }),
    );
    if (!result) return;
    this.catalog = null;
    await this.loadRegistry();
    const count = Number(
      result.commands_imported || result.commands || result.command_count || 0,
    );
    this.message = `Restored ${count} command${count === 1 ? "" : "s"} with original organization.`;
  }

  private async importCatalogProfile(detail: any) {
    const profile = detail.profile;
    const ids = new Set<string>(detail.commandIds || []);
    const commands = (profile?.commands || []).filter(
      (command: any) => ids.has(command.command_id) && command.code,
    );
    if (!profile || !commands.length || !this.services) return;
    await this.run(async () => {
      const locId = this.selectedLocation || "unsorted";
      if (!this.registry.locations?.[locId])
        await this.services!.call("create_location", {
          location_id: locId,
          name: locId === "unsorted" ? "Unsorted" : locId,
        });
      const applianceId = this.uniqueApplianceId(
        locId,
        slugify(profile.name || profile.model) || "catalog_remote",
      );
      await this.services!.call("create_appliance", {
        location_id: locId,
        appliance_id: applianceId,
        name: profile.name || profile.model || "Catalog remote",
        appliance_type: profile.category || "generic",
      });
      for (const command of commands)
        await this.services!.call("store_command", {
          location_id: locId,
          appliance_id: applianceId,
          command_id: command.command_id,
          name: command.name || command.command_id,
          code: command.code,
          role: command.role || "",
          source: {
            ...(command.source || {}),
            ...(command.import?.provenance || {}),
            profile_id: profile.profile_id,
            import_mode: detail.mode,
          },
        });
      this.selectedLocation = locId;
      this.selectedAppliance = applianceId;
      this.catalog = null;
      await this.loadRegistry();
      this.message = `Imported ${commands.length} command${commands.length === 1 ? "" : "s"}.`;
    });
  }

  private async inspectImport() {
    if (!this.importText.trim() || !this.services || !this.catalog) return;
    const raw = this.importText.trim();
    const format = this.detectImportFormat(raw);
    if (!format) {
      this.error =
        "Choose a recognized Pronto, GIRR, Flipper, LIRC, raw, Zosung, or native backup representation.";
      return;
    }
    const result = await this.run(() =>
      this.services!.call("inspect_import", { code: raw, format }),
    );
    if (result && this.catalog)
      this.catalog = {
        ...this.catalog,
        preview: result,
        unsupportedCommands: result.unsupported_commands || [],
        lossReport: result.loss_report,
      };
  }

  private async runImport(detail: any) {
    if (!this.services) return;
    const entries = (detail.commands || []).filter(
      (command: any) =>
        command.compatible !== false &&
        (command.code || command.native_command),
    );
    if (!entries.length) return;
    await this.run(async () => {
      let [locId, applianceId] = String(detail.targetKey || "").split("||");
      if (!locId || !applianceId) {
        locId = "unsorted";
        if (!this.registry.locations?.[locId])
          await this.services!.call("create_location", {
            location_id: locId,
            name: "Unsorted",
          });
        applianceId = this.uniqueApplianceId(locId, "imported_remote");
        await this.services!.call("create_appliance", {
          location_id: locId,
          appliance_id: applianceId,
          name: "Imported remote",
          appliance_type: "generic",
        });
      }
      const imported: string[] = [];
      const used = new Set(
        Object.keys(
          this.registry.locations?.[locId]?.appliances?.[applianceId]
            ?.commands || {},
        ),
      );
      for (const command of entries) {
        const desired = validId(String(command.command_id || ""))
          ? String(command.command_id)
          : slugify(command.name || "button") || "button";
        const commandId = uniqueKey(desired, used);
        used.add(commandId);
        if (command.native_command)
          await this.services!.call("import_command_backup", {
            location_id: locId,
            appliance_id: applianceId,
            command_id: commandId,
            payload: command.native_command,
          });
        else
          await this.services!.call("store_command", {
            location_id: locId,
            appliance_id: applianceId,
            command_id: commandId,
            name: command.name || commandId,
            code: command.code,
            role: command.role || "",
            source: command.source || { type: "import", format: detail.format },
          });
        imported.push(commandId);
      }
      this.selectedLocation = locId;
      this.selectedAppliance = applianceId;
      this.catalog = null;
      await this.loadRegistry();
      if (imported[0]) {
        this.openInspector({ locId, applianceId, cmdId: imported[0] });
        this.pendingFocus = { locId, applianceId, cmdId: imported[0] };
      }
      this.message = `Imported ${imported.length} command${imported.length === 1 ? "" : "s"}.`;
    });
  }

  private detectImportFormat(raw: string) {
    if (/^[\[{]/.test(raw)) return "native_json";
    if (/^Filetype:\s*IR (?:signals|library) file/im.test(raw))
      return "flipper";
    if (/^<\?xml|^<[^>]+/i.test(raw)) return "girr";
    if (/\bbegin\s+(remote|raw_codes)\b/i.test(raw)) return "lirc";
    if (/^0000\s+[0-9a-f]{4}(?:\s+[0-9a-f]{4}){2,}/i.test(raw)) return "pronto";
    if (/(?:^|[\s,])[+-]\d+/.test(raw)) return "raw_signed";
    if (/^\d+(?:[\s,]+\d+)+$/.test(raw)) return "raw_unsigned";
    const compact = raw.replace(/\s+/g, "");
    if (
      compact.length >= 8 &&
      compact.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
    )
      return "zosung_base64";
    return "";
  }

  private async exportBackup() {
    if (!this.services) return;
    const result = await this.run(() =>
      this.services!.call("export_backup", { include_history: true }),
    );
    if (result) {
      downloadText(
        JSON.stringify(result, null, 2),
        result.filename || "imprint-refinery-backup.imprint.json",
        "application/json",
      );
      this.message = "Backup downloaded.";
    }
  }

  private ref(detail: any) {
    return {
      locId: detail.locId,
      applianceId: detail.applianceId,
      cmdId: detail.cmdId,
    };
  }
  private detailTarget(detail: any): [string, string] {
    const key =
      detail.targetKey ||
      (detail.targetLocId && detail.targetApplianceId
        ? `${detail.targetLocId}||${detail.targetApplianceId}`
        : "");
    return key
      ? (key.split("||") as [string, string])
      : [detail.locId, detail.applianceId];
  }

  private async moveCommand(detail: any) {
    const [targetLocId, targetApplianceId] = this.detailTarget(detail);
    if (
      !targetLocId ||
      !targetApplianceId ||
      (targetLocId === detail.locId && targetApplianceId === detail.applianceId)
    )
      return;
    await this.run(async () => {
      await this.services!.call("move_command", {
        location_id: detail.locId,
        appliance_id: detail.applianceId,
        command_id: detail.cmdId,
        target_location_id: targetLocId,
        target_appliance_id: targetApplianceId,
      });
      this.selectedLocation = targetLocId;
      this.selectedAppliance = targetApplianceId;
      await this.loadRegistry();
      this.openInspector({
        locId: targetLocId,
        applianceId: targetApplianceId,
        cmdId: detail.cmdId,
      });
      this.message = "Command moved.";
    });
  }

  private async moveCommands(detail: any) {
    if (!this.services) return;
    const [targetLocId, targetApplianceId] = this.detailTarget(detail);
    const commands = Array.isArray(detail.commands)
      ? detail.commands.filter(
          (ref: any) =>
            ref?.locId &&
            ref?.applianceId &&
            ref?.cmdId &&
            (ref.locId !== targetLocId ||
              ref.applianceId !== targetApplianceId),
        )
      : [];
    if (!targetLocId || !targetApplianceId || !commands.length) return;
    const target =
      this.registry.locations?.[targetLocId]?.appliances?.[targetApplianceId];
    if (!target) {
      this.error = "Choose an available destination appliance.";
      return;
    }
    const conflicts = commands.filter(
      (ref: any) => target.commands?.[ref.cmdId],
    );
    if (conflicts.length) {
      const names = conflicts.map(
        (ref: any) =>
          this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
            ?.commands?.[ref.cmdId]?.name || ref.cmdId,
      );
      this.error = `${applianceDisplayName(targetLocId, targetApplianceId, target.name)} already has ${names.join(", ")}. Rename or remove ${conflicts.length === 1 ? "that command" : "those commands"} before moving this selection.`;
      return;
    }
    const selectedInspector = commands.find(
      (ref: any) =>
        this.inspector?.locId === ref.locId &&
        this.inspector?.applianceId === ref.applianceId &&
        this.inspector?.cmdId === ref.cmdId,
    );
    const completed = await this.run(async () => {
      for (const ref of commands) {
        await this.services!.call("move_command", {
          location_id: ref.locId,
          appliance_id: ref.applianceId,
          command_id: ref.cmdId,
          target_location_id: targetLocId,
          target_appliance_id: targetApplianceId,
        });
      }
      this.selectedLocation = targetLocId;
      this.selectedAppliance = targetApplianceId;
      await this.loadRegistry();
      if (
        selectedInspector &&
        this.registry.locations?.[targetLocId]?.appliances?.[targetApplianceId]
          ?.commands?.[selectedInspector.cmdId]
      )
        this.openInspector({
          locId: targetLocId,
          applianceId: targetApplianceId,
          cmdId: selectedInspector.cmdId,
        });
      else if (selectedInspector) this.inspector = null;
      this.message = `Moved ${commands.length} command${commands.length === 1 ? "" : "s"} to ${applianceDisplayName(targetLocId, targetApplianceId, target.name)}.`;
      return true;
    });
    if (completed) detail.complete?.();
  }

  private async duplicateCommand(detail: any) {
    const source =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId]
        ?.commands?.[detail.cmdId];
    if (!source?.code) return;
    const [targetLocId, targetApplianceId] = this.detailTarget(detail);
    const id =
      detail.commandId ||
      detail.id ||
      this.uniqueCommandId(
        targetLocId,
        targetApplianceId,
        `${detail.cmdId}_copy`,
      );
    if (!validId(id)) {
      this.error =
        "Command IDs use lowercase letters, numbers, and underscores.";
      return;
    }
    await this.run(async () => {
      await this.services!.call("store_command", {
        location_id: targetLocId,
        appliance_id: targetApplianceId,
        command_id: id,
        name: detail.name || `${source.name || detail.cmdId} copy`,
        code: source.code,
        role: source.role || "",
        source: {
          type: "duplicate",
          source_command: {
            location_id: detail.locId,
            appliance_id: detail.applianceId,
            command_id: detail.cmdId,
            revision: source.current_revision || 0,
          },
          original_source: source.source || null,
        },
      });
      if (source.icon)
        await this.services!.call("update_command", {
          location_id: targetLocId,
          appliance_id: targetApplianceId,
          command_id: id,
          icon: source.icon,
        });
      await this.loadRegistry();
      this.openInspector({
        locId: targetLocId,
        applianceId: targetApplianceId,
        cmdId: id,
      });
      this.pendingFocus = {
        locId: targetLocId,
        applianceId: targetApplianceId,
        cmdId: id,
      };
      this.message = "Command duplicated.";
    });
  }

  private async exportCommand(detail: any) {
    const command =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId]
        ?.commands?.[detail.cmdId];
    if (!command) return;
    const format = detail.format || "native_json";
    if (format === "native_json") {
      const result = await this.run(() =>
        this.services!.call("export_backup", {
          location_id: detail.locId,
          appliance_id: detail.applianceId,
          include_history: detail.includeHistory !== false,
        }),
      );
      if (!result) return;
      const root = result.registry || result;
      const sourceLocation = root.locations?.[detail.locId];
      const sourceAppliance = sourceLocation?.appliances?.[detail.applianceId];
      const prunedRoot = {
        ...root,
        locations: {
          [detail.locId]: {
            ...sourceLocation,
            appliances: {
              [detail.applianceId]: {
                ...sourceAppliance,
                commands: {
                  [detail.cmdId]: sourceAppliance?.commands?.[detail.cmdId],
                },
              },
            },
          },
        },
      };
      const document = result.registry
        ? {
            ...result,
            registry: prunedRoot,
            scope: "command",
            command_count: 1,
          }
        : { ...prunedRoot, scope: "command", command_count: 1 };
      downloadText(
        JSON.stringify(document, null, 2),
        `${detail.cmdId}.imprint.json`,
        "application/json",
      );
      this.message = "Command exported.";
      return;
    }
    const result = await this.run(() =>
      this.services!.call("convert_signal", {
        code: command.code,
        format: command.format || "raw_signed",
        output_format: format,
        carrier_frequency: command.signal?.carrier_frequency || 38_000,
        name: command.name || detail.cmdId,
      }),
    );
    if (!result?.value) return;
    downloadText(
      result.value,
      result.filename || `${detail.cmdId}.${format}`,
      result.media_type || "text/plain",
    );
    this.message =
      result.loss_report?.lossless === false
        ? "Exported with documented representation loss."
        : "Command exported.";
  }

  private async editCommand(detail: any) {
    await this.run(async () => {
      await this.services!.call("update_command", {
        location_id: detail.locId,
        appliance_id: detail.applianceId,
        command_id: detail.cmdId,
        ...(detail.role !== undefined ? { role: detail.role } : {}),
        ...(detail.icon !== undefined ? { icon: detail.icon } : {}),
      });
      await this.loadRegistry();
      this.openInspector(this.ref(detail));
      this.message = "Command updated.";
    });
  }

  private async copyAutomationAction(detail: any) {
    const appliance =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId];
    const command = appliance?.commands?.[detail.cmdId];
    if (!appliance || !command) return;
    const use = homeAssistantUse(
      detail.locId,
      detail.applianceId,
      detail.cmdId,
      appliance,
      command,
    );
    if (!use.yaml) {
      this.error = "Home Assistant is still registering this command's entity.";
      return;
    }
    await copyText(use.yaml);
    this.message = "Automation action copied.";
  }

  private async createAppliance(detail: any) {
    const locId = detail.locId || this.selectedLocation || "unsorted";
    const name = detail.name?.trim();
    if (!name) {
      this.modal = {
        type: "form",
        action: "add-appliance",
        heading: "Add appliance",
        confirmLabel: "Add appliance",
        data: { ...detail, locId, name: "", id: "", idTouched: false },
      };
      return;
    }
    const id =
      detail.applianceId ||
      detail.id ||
      this.uniqueApplianceId(locId, slugify(name) || "remote");
    await this.run(async () => {
      if (!this.registry.locations?.[locId])
        await this.services!.call("create_location", {
          location_id: locId,
          name: locId === "unsorted" ? "Unsorted" : locId,
        });
      await this.services!.call("create_appliance", {
        location_id: locId,
        appliance_id: id,
        name,
        appliance_type: detail.type || "generic",
      });
      this.selectedLocation = locId;
      this.selectedAppliance = id;
      await this.loadRegistry();
      this.message = `Added ${name}.`;
    });
  }

  private async renameAppliance(detail: any) {
    const current =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId];
    const name = detail.name?.trim();
    if (!name) {
      this.modal = {
        type: "form",
        action: "rename-appliance",
        heading: "Rename appliance",
        confirmLabel: "Save name",
        data: { ...detail, name: current?.name || detail.applianceId },
      };
      return;
    }
    await this.run(async () => {
      await this.services!.call("rename_appliance", {
        location_id: detail.locId,
        appliance_id: detail.applianceId,
        name,
      });
      await this.loadRegistry();
      this.message = "Appliance renamed.";
    });
  }

  private async moveDevice(detail: any) {
    const target = detail.targetLocationId || detail.targetLocId;
    if (!target || target === detail.locId) return;
    await this.run(async () => {
      await this.services!.call("move_appliance", {
        location_id: detail.locId,
        appliance_id: detail.applianceId,
        target_location_id: target,
      });
      this.selectedLocation = target;
      this.selectedAppliance = detail.applianceId;
      await this.loadRegistry();
      this.message = "Appliance moved.";
    });
  }

  private async updateDevice(detail: any) {
    await this.run(async () => {
      await this.services!.call("update_appliance", {
        location_id: detail.locId,
        appliance_id: detail.applianceId,
        appliance_type: detail.type || "generic",
        preferred_platform:
          detail.preferredPlatform || detail.preferred_platform || "auto",
        emitter_id: detail.emitterId ?? detail.emitter_id ?? "",
      });
      await this.loadRegistry();
      this.syncSelection();
      this.message = "Appliance settings saved.";
    });
  }

  private async deleteAppliance(detail: any) {
    const appliance =
      this.registry.locations?.[detail.locId]?.appliances?.[detail.applianceId];
    const count =
      detail.commandCount ?? Object.keys(appliance?.commands || {}).length;
    this.modal = {
      type: "confirm",
      action: "delete-appliance",
      heading: "Delete appliance?",
      text: `“${appliance?.name || detail.applianceId}” and its ${count} command${count === 1 ? "" : "s"} will be removed.`,
      confirmLabel: "Delete appliance",
      data: { ...detail, commandCount: count },
    };
  }

  private async exportDevice(detail: any) {
    const result = await this.run(() =>
      this.services!.call(
        detail.format && detail.format !== "native_json"
          ? "export_profile"
          : "export_backup",
        {
          location_id: detail.locId,
          appliance_id: detail.applianceId,
          ...(detail.format && detail.format !== "native_json"
            ? { output_format: detail.format }
            : { include_history: detail.includeHistory !== false }),
        },
      ),
    );
    if (!result) return;
    const value = result.value || JSON.stringify(result, null, 2);
    downloadText(
      value,
      result.filename || `${detail.applianceId}.imprint.json`,
      result.media_type || "application/json",
    );
    this.message = "Appliance exported.";
  }

  private historyRevision(revision: number) {
    return this.inspector?.history?.revisions?.find(
      (entry: any) => Number(entry.revision) === Number(revision),
    );
  }
  private async testRevision(detail: any) {
    const revision = this.historyRevision(detail.revision);
    if (revision?.snapshot?.code)
      await this.run(async () => {
        await this.services!.call("send_signal", {
          code: revision.snapshot.code,
        });
        this.message = `Revision ${revision.revision} sent once.`;
      });
  }
  private async restoreRevision(detail: any) {
    if (!this.inspector) return;
    if (!detail.confirmed) {
      this.modal = {
        type: "confirm",
        action: "restore-revision",
        heading: `Restore revision ${detail.revision}?`,
        text: "The selected snapshot will become a new current revision. Existing history is preserved.",
        confirmLabel: "Restore as new revision",
        data: { ...detail },
      };
      return;
    }
    const ref = this.inspector;
    await this.run(async () => {
      await this.services!.call("restore_revision", {
        location_id: ref.locId,
        appliance_id: ref.applianceId,
        command_id: ref.cmdId,
        revision_id: detail.revision,
      });
      await this.loadRegistry();
      this.openInspector(ref);
      await this.inspectorTab("history");
      this.message = `Restored revision ${detail.revision}.`;
    });
  }
  private inspectRevision(detail: any) {
    if (this.inspector)
      this.inspector = {
        ...this.inspector,
        revisionSelected: Number(detail.revision),
      };
  }
  private compareRevision(detail: any) {
    const revision = this.historyRevision(detail.revision);
    const ref = this.inspector;
    const command = ref
      ? this.registry.locations?.[ref.locId]?.appliances?.[ref.applianceId]
          ?.commands?.[ref.cmdId]
      : null;
    const source = revision?.snapshot || {};
    const original = source.signal?.timings,
      timings = command?.signal?.timings;
    if (!ref || !original?.length || !timings?.length) return;
    const storedRoles = Array.isArray(source.source?.frame_roles)
      ? source.source.frame_roles
      : source.analysis?.frame_roles;
    const originalFrameRoles = Array.isArray(storedRoles)
      ? storedRoles.map((role: any) =>
          typeof role === "string"
            ? role
            : String(role?.role || role?.kind || "auto"),
        )
      : [];
    this.openLab(ref);
    if (this.lab) {
      const carrier =
        source.signal?.carrier_frequency || this.lab.carrierFrequency;
      this.lab = {
        ...this.lab,
        sourceName: `${source.name || command?.name || ref.cmdId} · revision ${revision.revision}`,
        sourceRevision: revision.revision,
        original: [...original],
        originalFrameRoles,
        sourceAnalysis: source.analysis || {},
        carrierFrequency: carrier,
        originalCarrierFrequency: carrier,
        carrierSource: source.signal?.carrier_source || "assumed",
        view: "compare",
        dirty:
          JSON.stringify(original) !== JSON.stringify(timings) ||
          JSON.stringify(originalFrameRoles) !==
            JSON.stringify(this.lab.frameRoles),
      };
    }
  }
  private async copyRevision(detail: any) {
    const revision = this.historyRevision(detail.revision);
    if (revision) {
      await copyText(JSON.stringify(revision, null, 2));
      this.message = `Revision ${detail.revision} copied.`;
    }
  }
  private exportRevision(detail: any) {
    const revision = this.historyRevision(detail.revision);
    if (revision) {
      downloadText(
        JSON.stringify(
          {
            schema: "imprint_refinery.command_revision",
            version: 1,
            command_id: detail.cmdId,
            revision,
          },
          null,
          2,
        ),
        `${detail.cmdId}-revision-${detail.revision}.imprint.json`,
        "application/json",
      );
      this.message = `Revision ${detail.revision} exported.`;
    }
  }
  private async labelRevision(detail: any) {
    if (!this.inspector) return;
    await this.run(async () => {
      await this.services!.call("label_revision", {
        location_id: this.inspector!.locId,
        appliance_id: this.inspector!.applianceId,
        command_id: this.inspector!.cmdId,
        revision_id: detail.revision,
        label: detail.label || "",
      });
      this.inspector!.history = await this.services!.call("command_history", {
        location_id: this.inspector!.locId,
        appliance_id: this.inspector!.applianceId,
        command_id: this.inspector!.cmdId,
      });
      this.inspector = { ...this.inspector! };
      this.message = "Revision label saved.";
    });
  }

  private viewDuplicate() {
    const match = this.learn?.duplicateMatch;
    if (!match) return;
    ++this.learnSequence;
    this.learn = null;
    this.openInspector(match);
  }
  private replaceDuplicate() {
    const learn = this.learn,
      match = learn?.duplicateMatch;
    if (!learn || !match) return;
    const command =
      this.registry.locations?.[match.locId]?.appliances?.[match.applianceId]
        ?.commands?.[match.cmdId];
    this.learn = {
      ...learn,
      locationId: match.locId,
      applianceId: match.applianceId,
      targetKey: `${match.locId}||${match.applianceId}`,
      commandId: match.cmdId,
      name: command?.name || match.commandName,
      role: command?.role || "",
      duplicateMatch: undefined,
      replacingEquivalent: true,
    };
  }

  private async catalogMatchCapture() {
    if (!this.services || !this.catalog || !this.emitterReady()) {
      this.error = "The selected IR emitter is unavailable.";
      return;
    }
    const sequence = ++this.catalogMatchSequence;
    const timeout = Number(this.config.timeout || 60);
    this.catalog = {
      ...this.catalog,
      capturing: true,
      captureDeadline: Date.now() + timeout * 1000,
    };
    this.catalogMatchRemaining = timeout;
    this.error = "";
    this.errorDetail = "";
    this.message = "";
    this.startTicker();
    try {
      const captured = await this.services!.call("capture_signal", {
        timeout: Number(this.config.timeout || 60),
        poll_interval: Number(this.config.poll_interval || 2),
      });
      if (sequence !== this.catalogMatchSequence || !this.catalog?.capturing)
        return;
      if (!captured.code) throw new Error("No IR code was received");
      this.catalog = { ...this.catalog, capturing: false };
      this.busy = true;
      const matched = await this.services!.call("catalog_match_signal", {
        code: captured.code,
        limit: 12,
      });
      if (sequence === this.catalogMatchSequence && this.catalog)
        this.catalog = {
          ...this.catalog,
          capturing: false,
          candidates: matched.matches || [],
          searched: true,
          capturedCode: captured.code,
        };
    } catch (error) {
      if (sequence !== this.catalogMatchSequence) return;
      this.setError(error);
      if (this.catalog) this.catalog = { ...this.catalog, capturing: false };
    } finally {
      if (sequence === this.catalogMatchSequence) this.busy = false;
    }
  }

  private async cancelCatalogMatch() {
    const active = Boolean(this.catalog?.capturing);
    if (!active || !this.services) return;
    ++this.catalogMatchSequence;
    this.busy = true;
    this.error = "";
    this.errorDetail = "";
    try {
      await this.services.call("cancel_capture");
      if (this.catalog) this.catalog = { ...this.catalog, capturing: false };
      this.catalogMatchRemaining = 0;
    } catch (error) {
      this.setError(error);
    } finally {
      this.busy = false;
    }
  }

  private updateModalField(key: string, value: string) {
    if (!this.modal) return;
    const data = { ...this.modal.data, [key]: value };
    if (
      key === "name" &&
      !data.idTouched &&
      ["add-location", "add-appliance"].includes(this.modal.action)
    )
      data.id = slugify(value);
    if (key === "id") data.idTouched = true;
    this.modal = { ...this.modal, data, error: "" };
  }

  private async submitModal() {
    const modal = this.modal;
    if (!modal || !this.services) return;
    const data = modal.data;
    if (modal.type === "info") {
      this.modal = null;
      return;
    }
    if (modal.type === "form") {
      if (
        [
          "rename-command",
          "rename-appliance",
          "rename-location",
          "add-location",
          "add-appliance",
        ].includes(modal.action) &&
        !String(data.name || "").trim()
      ) {
        this.modal = { ...modal, error: "Enter a name." };
        return;
      }
      if (
        ["add-location", "add-appliance"].includes(modal.action) &&
        !validId(String(data.id || slugify(data.name) || ""))
      ) {
        this.modal = {
          ...modal,
          error: "Enter a name that contains at least one letter or number.",
        };
        return;
      }
    }
    this.modal = null;
    switch (modal.action) {
      case "delete-command":
        await this.run(async () => {
          await this.services!.call("remove_command", {
            location_id: data.locId,
            appliance_id: data.applianceId,
            command_id: data.cmdId,
          });
          this.inspector = null;
          await this.loadRegistry();
          this.message = "Command deleted.";
        });
        break;
      case "delete-appliance":
        await this.run(async () => {
          await this.services!.call("remove_appliance", {
            location_id: data.locId,
            appliance_id: data.applianceId,
            confirm: true,
          });
          this.inspector = null;
          await this.loadRegistry();
          this.message = "Appliance deleted.";
        });
        break;
      case "delete-location":
        await this.run(async () => {
          await this.services!.call("remove_location", {
            location_id: data.locId,
            confirm: true,
          });
          if (this.selectedLocation === data.locId) {
            this.selectedLocation = "";
            this.selectedAppliance = "";
            this.inspector = null;
          }
          await this.loadRegistry();
          this.message = "Location deleted.";
        });
        break;
      case "restore-revision":
        await this.restoreRevision({ ...data, confirmed: true });
        break;
      case "rename-command":
        await this.renameCommand({ ...data, name: String(data.name).trim() });
        break;
      case "rename-appliance":
        await this.renameAppliance({ ...data, name: String(data.name).trim() });
        break;
      case "rename-location":
        await this.run(async () => {
          await this.services!.call("rename_location", {
            location_id: data.locId,
            name: String(data.name).trim(),
          });
          await this.loadRegistry();
          this.message = "Location renamed.";
        });
        break;
      case "add-location":
        await this.run(async () => {
          const id = this.uniqueLocationId(
            slugify(String(data.name)) || "location",
          );
          await this.services!.call("create_location", {
            location_id: id,
            name: String(data.name).trim(),
          });
          this.selectedLocation = id;
          await this.loadRegistry();
          this.message = `Added ${String(data.name).trim()}.`;
        });
        break;
      case "add-appliance":
        await this.createAppliance({
          ...data,
          name: String(data.name).trim(),
          id: this.uniqueApplianceId(
            String(data.locId || this.selectedLocation || "unsorted"),
            slugify(String(data.name)) || "remote",
          ),
        });
        break;
    }
  }

  private onCatalogAction(event: CustomEvent<any>) {
    const detail = event.detail || {};
    switch (detail.action) {
      case "close":
        this.catalog = null;
        break;
      case "mode":
        this.catalog = { mode: detail.mode };
        break;
      case "search":
        void this.searchCatalog(detail);
        break;
      case "profile":
        void this.openCatalogProfile(detail.profileId);
        break;
      case "profile-close":
        if (this.catalog)
          this.catalog = { ...this.catalog, selectedProfile: undefined };
        break;
      case "profile-import":
        void this.importCatalogProfile(detail);
        break;
      case "profile-test":
        void this.testCatalogCommand(detail);
        break;
      case "guided-start":
        void this.startGuided();
        break;
      case "guided-test":
        void this.guidedTest();
        break;
      case "guided-answer":
        void this.guidedAnswer(detail.result);
        break;
      case "guided-control":
        void this.guidedControl(detail.command);
        break;
      case "match-start":
        void this.catalogMatchCapture();
        break;
      case "match-cancel":
        void this.cancelCatalogMatch();
        break;
      case "import-text":
        this.importText = detail.text || "";
        if (this.catalog)
          this.catalog = {
            ...this.catalog,
            preview: undefined,
            unsupportedCommands: [],
          };
        break;
      case "import-file-error":
        this.error = detail.message || "The selected file could not be read.";
        break;
      case "import-inspect":
        void this.inspectImport();
        break;
      case "import-run":
        void this.runImport(detail);
        break;
      case "import-restore":
        void this.restoreNativeImport();
        break;
    }
  }

  private renderModal() {
    const modal = this.modal;
    if (!modal) return nothing;
    if (modal.type === "locations") {
      const locations = Object.entries(this.registry.locations || {});
      return html`<imprint-dialog .heading=${modal.heading} description="Locations are optional. Appliances can be moved between them without changing command IDs." @dialog-close=${() => (this.modal = null)}><div class="modal-body"><div class="location-list">${
        locations.length
          ? locations.map(([locId, location]) => {
              const appliances = Object.keys(location.appliances || {}).length;
              return html`<div class="location-row"><div><strong>${location.name || locId}</strong><small>${appliances} appliance${appliances === 1 ? "" : "s"}</small></div><button class="btn" @click=${() => this.renameLocation(locId)}>Rename</button><button class="btn danger" @click=${() => this.deleteLocation(locId)}>Delete</button></div>`;
            })
          : html`<div class="empty">No locations yet.</div>`
      }</div><div class="actions" style="justify-content:flex-end"><button class="btn" @click=${() => (this.modal = null)}>Close</button><button class="btn primary" @click=${() => void this.addLocation()}>Add location</button></div></div></imprint-dialog>`;
    }
    return html`<imprint-dialog .heading=${modal.heading} .description=${modal.text || ""} @dialog-close=${() => (this.modal = null)}><form class="modal-body" @submit=${(
      event: SubmitEvent,
    ) => {
      event.preventDefault();
      void this.submitModal();
    }}>
      ${modal.type === "form" ? html`${["rename-command", "rename-appliance", "rename-location", "add-location", "add-appliance"].includes(modal.action) ? html`<label class="field">Name<input autofocus placeholder=${modal.action === "add-location" ? "e.g. Living room" : modal.action === "add-appliance" ? "e.g. Floor lamp" : "Enter a name"} .value=${modal.data.name || ""} @input=${(event: Event) => this.updateModalField("name", (event.target as HTMLInputElement).value)}></label>` : nothing}` : nothing}
      ${modal.type === "info" ? html`<pre class="code"><code>${String(modal.data.value || "")}</code></pre>${modal.data.lossReport ? html`<details><summary>Conversion report</summary><pre><code>${JSON.stringify(modal.data.lossReport, null, 2)}</code></pre></details>` : nothing}` : nothing}
      ${modal.error ? html`<imprint-feedback kind="error" .message=${modal.error}></imprint-feedback>` : nothing}
      <div class="actions" style="justify-content:flex-end"><button type="button" class="btn" @click=${() => (this.modal = null)}>Cancel</button><button class="btn ${modal.type === "confirm" && modal.action.startsWith("delete") ? "danger" : "primary"}" ?disabled=${this.busy}>${modal.confirmLabel || "Continue"}</button></div>
    </form></imprint-dialog>`;
  }

  private renderCompact() {
    const commands = allCommands(this.registry).slice(0, 12);
    return html`<section class="compact"><imprint-emitter-picker .emitters=${this.viewRegistry().emitters || []} .selected=${this.selectedEmitter} .state=${this.statusState()} .busy=${this.statusBusy()} .showLearn=${this.emitterCanCapture()} @emitter-change=${(
      event: CustomEvent,
    ) => {
      this.selectedEmitter = event.detail.emitterId;
      if (this.services) this.services.emitterId = this.selectedEmitter;
    }} @learn-request=${() => this.startLearn()}></imprint-emitter-picker>${
      commands.length
        ? html`<div class="compact-list">${commands.map((item) => {
            const key = `${item.locId}\u0000${item.applianceId}\u0000${item.cmdId}`;
            const feedback = this.sendFeedback[key];
            const kind = feedback?.kind || "";
            const icon =
              kind === "success"
                ? "mdi:check"
                : kind === "error"
                  ? "mdi:alert-circle-outline"
                  : kind === "pending"
                    ? "mdi:loading"
                    : "mdi:send";
            return html`<div class="compact-row"><ha-icon icon=${item.command.icon || "mdi:remote"}></ha-icon><div class="compact-copy"><strong>${item.command.name || item.cmdId}</strong><small>${item.appliance.name || item.applianceId}</small></div><button class="btn icon compact-send ${kind}" title=${feedback?.message || "Send once"} aria-label=${`Send ${item.command.name || item.cmdId}`} aria-busy=${kind === "pending" ? "true" : "false"} ?disabled=${kind === "pending" || !this.emitterReady()} @click=${() => this.sendCommand(item)}><ha-icon icon=${icon}></ha-icon></button>${feedback ? html`<span class="sr-only" role=${kind === "error" ? "alert" : "status"} aria-live=${kind === "error" ? "assertive" : "polite"}>${feedback.message}${feedback.detail ? ` ${feedback.detail}` : ""}</span>` : nothing}</div>`;
          })}</div>`
        : html`<div class="empty panel">No saved commands yet.</div>`
    }</section>`;
  }

  private renderWorkspace() {
    if (this.learn)
      return html`${this.renderLibrary()}<imprint-learn-flow .learn=${this.learn} .registry=${this.registry} .busy=${this.busy} .emitterReady=${this.emitterReady()} .remaining=${this.learnRemaining} .emitterName=${this.enabledEmitters().find((tx) => tx.key === this.selectedEmitter)?.name || "the selected emitter"} .returnFocusElement=${this.learnReturnFocus} @learn-change=${(
        event: CustomEvent,
      ) => {
        if (this.learn)
          this.learn = {
            ...this.learn,
            [event.detail.field]: event.detail.value,
          };
      }} @learn-cancel=${() => void this.cancelLearn()} @learn-retry=${() => this.retryLearn()} @learn-test=${() => void this.testLearn()} @learn-optimize=${() => void this.optimizeLearn()} @learn-save=${(event: CustomEvent) => void this.saveLearn(Boolean(event.detail?.another))} @learn-copy-code=${(event: CustomEvent) => void copyText(event.detail.code).then(() => (this.message = "Code copied."))} @learn-duplicate-view=${() => this.viewDuplicate()} @learn-duplicate-replace=${() => this.replaceDuplicate()} @learn-duplicate-ignore=${() => {
        if (this.learn)
          this.learn = { ...this.learn, duplicateMatch: undefined };
      }}></imprint-learn-flow>`;
    if (this.lab)
      return html`<imprint-signal-lab .lab=${this.lab} .registry=${this.registry} .busy=${this.busy} .emitterReady=${this.emitterReady()} .emitterName=${this.enabledEmitters().find((tx) => tx.key === this.selectedEmitter)?.name || "No active emitter"} .offlineReason=${this.emitterReady() ? "" : "The selected IR emitter is unavailable."} .now=${this.now} @lab-action=${(event: CustomEvent) => this.onLabAction(event)}></imprint-signal-lab>`;
    if (this.catalog)
      return html`<imprint-catalog-guided .catalog=${this.catalog} .registry=${this.registry} .busy=${this.busy} .cooldown=${Math.max(0, Math.ceil((this.guidedCooldownUntil - this.now) / 1000))} .matchRemaining=${this.catalogMatchRemaining} .emitterName=${this.enabledEmitters().find((tx) => tx.key === this.selectedEmitter)?.name || "the selected emitter"} .importTargetKey=${String(this.catalog.importTargetKey || "")} @catalog-action=${(event: CustomEvent) => this.onCatalogAction(event)}></imprint-catalog-guided>`;
    return this.renderLibrary();
  }

  private renderLibrary() {
    return html`<imprint-library-inspector .registry=${this.viewRegistry()} .inspector=${this.inspector} .busy=${this.busy} .selectedLocation=${this.selectedLocation} .selectedAppliance=${this.selectedAppliance} .selectedEmitter=${this.selectedEmitter} .sendFeedback=${this.sendFeedback} .status=${this.statusState()} .statusBusy=${this.statusBusy()}
      @command-open=${(event: CustomEvent) => this.openInspector(event.detail)} @command-send=${(event: CustomEvent) => void this.sendCommand(event.detail)} @command-relearn=${(
        event: CustomEvent,
      ) => {
        const command =
          this.registry.locations?.[event.detail.locId]?.appliances?.[
            event.detail.applianceId
          ]?.commands?.[event.detail.cmdId];
        this.startLearn({
          locationId: event.detail.locId,
          applianceId: event.detail.applianceId,
          commandId: event.detail.cmdId,
          name: command?.name || event.detail.cmdId,
          role: command?.role || "",
          targetKey: `${event.detail.locId}||${event.detail.applianceId}`,
        });
      }} @command-rename=${(event: CustomEvent) => void this.renameCommand(event.detail)} @command-delete=${(event: CustomEvent) => void this.deleteCommand(event.detail)} @command-move=${(event: CustomEvent) => void this.moveCommand(event.detail)} @commands-move=${(event: CustomEvent) => void this.moveCommands(event.detail)} @command-duplicate=${(event: CustomEvent) => void this.duplicateCommand(event.detail)} @command-export=${(
        event: CustomEvent,
      ) => {
        if (!event.detail.format) void this.exportCommand(event.detail);
      }} @command-edit-role=${(event: CustomEvent) => void this.editCommand(event.detail)} @command-edit-icon=${(event: CustomEvent) => void this.editCommand(event.detail)} @command-copy-action=${(event: CustomEvent) => void this.copyAutomationAction(event.detail)}
      @learn-request-for=${(event: CustomEvent) => (event.detail?.locId && event.detail?.applianceId ? this.startLearn({ locationId: event.detail.locId, applianceId: event.detail.applianceId, targetKey: `${event.detail.locId}||${event.detail.applianceId}` }) : this.startLearn())} @signal-lab-open=${(event: CustomEvent) => this.openLab(event.detail)} @inspector-tab=${(event: CustomEvent) => void this.inspectorTab(event.detail.tab)} @inspector-view-change=${(event: CustomEvent) => this.inspectorViewChanged(event.detail)} @inspector-binary-mode=${(event: CustomEvent) => this.inspectorBinaryModeChanged(event.detail.mode)} @representation-request=${(event: CustomEvent) => void this.convertRepresentation(event.detail)} @emitter-change=${(
        event: CustomEvent,
      ) => {
        this.selectedEmitter = event.detail.emitterId;
        if (this.services) this.services.emitterId = this.selectedEmitter;
      }}
      @learn-request=${() => this.startLearn()} @custom-signal-open=${() => this.openCustomLab()} @location-add=${() => this.manageLocations()} @appliance-actions=${(event: CustomEvent) => void this.applianceActions(event.detail)} @appliance-create=${(event: CustomEvent) => void this.createAppliance(event.detail)} @appliance-rename=${(event: CustomEvent) => void this.renameAppliance(event.detail)} @appliance-move=${(event: CustomEvent) => void this.moveDevice(event.detail)} @appliance-import=${(
        event: CustomEvent,
      ) => {
        this.selectedLocation = event.detail.locId;
        this.selectedAppliance = event.detail.applianceId;
        this.openCatalog(
          "import",
          `${event.detail.locId}||${event.detail.applianceId}`,
        );
      }} @appliance-export=${(event: CustomEvent) => void this.exportDevice(event.detail)} @appliance-entity-settings=${(event: CustomEvent) => void this.updateDevice(event.detail)} @appliance-delete=${(event: CustomEvent) => void this.deleteAppliance(event.detail)}
      @revision-test=${(event: CustomEvent) => void this.testRevision(event.detail)} @revision-restore=${(event: CustomEvent) => void this.restoreRevision(event.detail)} @revision-inspect=${(event: CustomEvent) => this.inspectRevision(event.detail)} @revision-compare=${(event: CustomEvent) => this.compareRevision(event.detail)} @revision-copy=${(event: CustomEvent) => void this.copyRevision(event.detail)} @revision-export=${(event: CustomEvent) => this.exportRevision(event.detail)} @revision-label=${(event: CustomEvent) => void this.labelRevision(event.detail)}
      @inspector-close=${() => this.closeInspector()} @import-open=${() => this.openCatalog("import", this.selectedLocation && this.selectedAppliance ? `${this.selectedLocation}||${this.selectedAppliance}` : "")} @export-backup=${() => void this.exportBackup()} @catalog-open=${() => this.openCatalog()}></imprint-library-inspector>`;
  }

  render() {
    if (!this.hass)
      return html`<ha-card><div class="loading">Waiting for Home Assistant…</div></ha-card>`;
    if (this.loading)
      return html`<ha-card><main class="app"><div class="loading" role="status" aria-live="polite">Loading command library…</div></main></ha-card>`;
    const content = this.config.workspace
      ? this.renderWorkspace()
      : this.learn
        ? this.renderWorkspace()
        : this.renderCompact();
    return html`<ha-card><main class="app"><header class="top"><div class="brand"><span class="mark"><ha-icon icon="mdi:remote-tv"></ha-icon></span><div><h1>${this.config.title || "Imprint Refinery"}</h1><span>${this.config.workspace ? "Command workspace" : "Saved remote controls"}</span></div></div></header><div class="feedback-stack">${
      this.error
        ? html`<imprint-feedback kind="error" dismissible .message=${this.error} .detail=${this.errorDetail} @feedback-dismiss=${() => {
            this.error = "";
            this.errorDetail = "";
          }}></imprint-feedback>`
        : nothing
    }${this.registryLoadFailed ? html`<div class="notice warning"><ha-icon icon="mdi:refresh"></ha-icon><span>The command library could not be loaded.</span><button class="btn" ?disabled=${this.busy} @click=${() => void this.retryRegistry()}>Try again</button></div>` : nothing}${this.message ? html`<imprint-feedback kind="success" .message=${this.message}></imprint-feedback>` : nothing}</div>${
      this.suspendedLab && !this.lab
        ? html`<div class="notice session-notice"><ha-icon icon="mdi:flask-outline"></ha-icon><span>A Signal Lab experiment is suspended for this panel session.</span><button class="btn" @click=${() => {
            this.lab = this.suspendedLab;
            this.suspendedLab = null;
          }}>Resume experiment</button><button class="btn" @click=${() => (this.suspendedLab = null)}>Discard</button></div>`
        : nothing
    }${content}</main>${this.renderModal()}</ha-card>`;
  }
}

@safeCustomElement("imprint-refinery-panel")
export class ImprintRefineryPanel extends ImprintRefineryCard {
  constructor() {
    super();
    this.setConfig({ workspace: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-refinery-card": ImprintRefineryCard;
    "imprint-refinery-panel": ImprintRefineryPanel;
  }
  interface Window {
    customCards?: Array<Record<string, string>>;
  }
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "imprint-refinery-card"))
  window.customCards.push({
    type: "imprint-refinery-card",
    name: "Imprint Refinery",
    description: "Learn, inspect, test, and organize infrared commands.",
  });
console.info(
  `%c IMPRINT REFINERY %c v${VERSION} `,
  "color:white;background:#0b6bcb;font-weight:700",
  "color:#0b6bcb;background:#eaf3ff",
);
