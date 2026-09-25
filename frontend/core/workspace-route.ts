import type {
  InspectorTab,
  WorkspaceView,
} from "../components/workspace/events";
import type { BinaryDecoderMode } from "./utils";

const PANEL_SEGMENT = "imprint-refinery";
const VIEW_PATHS: Record<WorkspaceView, string> = {
  appliances: "appliances",
  remote_profiles: "remote-profiles",
  infrared_hardware: "infrared-hardware",
};
const PATH_VIEWS = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [
    path,
    view as WorkspaceView,
  ]),
);
const WORKSPACE_VIEWS = new Set<WorkspaceView>([
  "appliances",
  "remote_profiles",
  "infrared_hardware",
]);
const INSPECTOR_TABS = new Set<InspectorTab>([
  "overview",
  "signal",
  "code",
  "history",
]);

export type SignalLabView = "edit" | "compare";
export type SignalLabTab = "decoded" | "timings" | "code";

const SIGNAL_LAB_VIEWS = new Set<SignalLabView>(["edit", "compare"]);
const SIGNAL_LAB_TABS = new Set<SignalLabTab>(["decoded", "timings", "code"]);
const BINARY_DECODER_MODES = new Set<BinaryDecoderMode>([
  "auto",
  "pulse_distance",
  "pulse_width",
  "protocol",
]);
const BINARY_DECODER_PATHS: Record<BinaryDecoderMode, string> = {
  auto: "auto",
  pulse_distance: "pulse-distance",
  pulse_width: "pulse-width",
  protocol: "protocol",
};
const LEGACY_QUERY_KEYS = [
  "view",
  "profile",
  "appliance",
  "command",
  "detail",
  "workspace",
  "lab_view",
  "lab_detail",
  "screen",
  "location",
  "tab",
  "format",
  "decoder",
  "zoom",
  "pan",
  "lab_tab",
  "save",
  "overlays",
  "catalog_mode",
  "category",
  "brand",
  "model",
  "target",
  "searched",
  "dialog",
  "revision",
  "custom",
] as const;

export interface WorkspaceRouteState {
  view: WorkspaceView;
  selectionId: string;
  commandId: string;
  inspectorTab: InspectorTab;
  signalLab: boolean;
  customSignal: boolean;
  signalLabView: SignalLabView;
  signalLabTab: SignalLabTab;
  binaryDecoderMode: BinaryDecoderMode;
  codeFormat: string;
  zoom: number;
  pan: number;
  selectedRevision: number;
  saveOpen: boolean;
  editingOverlays: boolean;
}

export interface WorkspaceRoute extends WorkspaceRouteState {
  canonicalize: boolean;
}

const defaultRoute = (): WorkspaceRouteState => ({
  view: "appliances",
  selectionId: "",
  commandId: "",
  inspectorTab: "overview",
  signalLab: false,
  customSignal: false,
  signalLabView: "edit",
  signalLabTab: "timings",
  binaryDecoderMode: "auto",
  codeFormat: "",
  zoom: 1,
  pan: 0,
  selectedRevision: 0,
  saveOpen: false,
  editingOverlays: false,
});

const decodeSegment = (value = ""): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
};

const panelIndex = (segments: string[]): number =>
  segments.lastIndexOf(PANEL_SEGMENT);

const inspectorTab = (value: string | null | undefined): InspectorTab =>
  INSPECTOR_TABS.has(value as InspectorTab)
    ? (value as InspectorTab)
    : "overview";

const signalLabView = (value: string | null | undefined): SignalLabView =>
  SIGNAL_LAB_VIEWS.has(value as SignalLabView)
    ? (value as SignalLabView)
    : "edit";

const signalLabTab = (value: string | null | undefined): SignalLabTab =>
  SIGNAL_LAB_TABS.has(value as SignalLabTab)
    ? (value as SignalLabTab)
    : "timings";

const binaryDecoderMode = (
  value: string | null | undefined,
): BinaryDecoderMode => {
  const normalized = String(value || "auto").replaceAll("-", "_");
  return BINARY_DECODER_MODES.has(normalized as BinaryDecoderMode)
    ? (normalized as BinaryDecoderMode)
    : "auto";
};

const routeNumber = (
  value: string | null | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
};

const routeFormat = (value: string | null | undefined): string => {
  const decoded = decodeSegment(value || "");
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(decoded) ? decoded : "";
};

const routeOptions = (segments: string[]): Map<string, string> => {
  const options = new Map<string, string>();
  for (let index = 0; index < segments.length; index += 1) {
    const key = segments[index];
    if (key === "save" || key === "overlays") {
      options.set(key, "1");
      continue;
    }
    const value = segments[index + 1];
    if (value !== undefined) {
      options.set(key, value);
      index += 1;
    } else {
      options.set(key, "");
    }
  }
  return options;
};

const contextSegments = (
  route: WorkspaceRouteState,
  signalLab: boolean,
): string[] => {
  const segments: string[] = [];
  if (route.binaryDecoderMode !== "auto") {
    segments.push("decoder", BINARY_DECODER_PATHS[route.binaryDecoderMode]);
  }
  const defaultFormat = signalLab ? "pronto" : "";
  if (route.codeFormat && route.codeFormat !== defaultFormat) {
    segments.push("format", encodeURIComponent(route.codeFormat));
  }
  if (route.zoom !== 1) segments.push("zoom", String(route.zoom));
  if (route.pan !== 0) segments.push("pan", String(route.pan));
  if (!signalLab && route.selectedRevision > 0) {
    segments.push("revision", String(route.selectedRevision));
  }
  if (signalLab && route.saveOpen) segments.push("save");
  if (signalLab && route.editingOverlays) segments.push("overlays");
  return segments;
};

const legacySelectionId = (url: URL): string => {
  const locationId = url.searchParams.get("location") || "";
  const applianceId = url.searchParams.get("appliance") || "";
  if (locationId && applianceId) return `${locationId}__${applianceId}`;
  return applianceId;
};

const legacyWorkspaceRoute = (url: URL): WorkspaceRoute | null => {
  const screen = url.searchParams.get("screen");
  if (!screen) return null;
  const fallback = defaultRoute();
  const selectionId = legacySelectionId(url);
  const commandId = url.searchParams.get("command") || "";

  if (screen === "command" && selectionId && commandId) {
    return {
      ...fallback,
      view: "remote_profiles",
      selectionId,
      commandId,
      inspectorTab: inspectorTab(url.searchParams.get("tab")),
      binaryDecoderMode: binaryDecoderMode(url.searchParams.get("decoder")),
      codeFormat: routeFormat(url.searchParams.get("format")),
      zoom: routeNumber(url.searchParams.get("zoom"), 1, 1, 16),
      pan: routeNumber(url.searchParams.get("pan"), 0, 0, 1),
      selectedRevision: routeNumber(
        url.searchParams.get("revision"),
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      canonicalize: true,
    };
  }
  if (screen === "lab" && selectionId && commandId) {
    return {
      ...fallback,
      view: "remote_profiles",
      selectionId,
      commandId,
      signalLab: true,
      customSignal: url.searchParams.get("custom") === "1",
      signalLabView: signalLabView(url.searchParams.get("lab_view")),
      signalLabTab: signalLabTab(url.searchParams.get("lab_tab")),
      binaryDecoderMode: binaryDecoderMode(url.searchParams.get("decoder")),
      codeFormat: routeFormat(url.searchParams.get("format")) || "pronto",
      zoom: routeNumber(url.searchParams.get("zoom"), 1, 1, 16),
      pan: routeNumber(url.searchParams.get("pan"), 0, 0, 1),
      saveOpen: url.searchParams.get("save") === "1",
      editingOverlays: url.searchParams.get("overlays") === "1",
      canonicalize: true,
    };
  }
  if (screen === "library") {
    return { ...fallback, selectionId, canonicalize: true };
  }
  if (screen === "catalog" || screen === "learn") {
    return {
      ...fallback,
      view: "remote_profiles",
      selectionId,
      canonicalize: true,
    };
  }
  return { ...fallback, canonicalize: true };
};

export const workspaceRouteFromUrl = (url: URL): WorkspaceRoute => {
  const fallback = defaultRoute();
  const segments = url.pathname.split("/").filter(Boolean);
  const rootIndex = panelIndex(segments);
  const pathView =
    rootIndex >= 0 ? PATH_VIEWS.get(segments[rootIndex + 1] || "") : undefined;
  const staleQuery = LEGACY_QUERY_KEYS.some((key) => url.searchParams.has(key));
  if (pathView) {
    const selectionId =
      pathView === "infrared_hardware"
      ? ""
      : decodeSegment(segments[rootIndex + 2]);
    const tail = segments.slice(rootIndex + 3);
    const hasCustomSignalRoute =
      pathView === "remote_profiles" &&
      Boolean(selectionId) &&
      tail[0] === "signal-lab" &&
      tail[1] === "new";
    if (hasCustomSignalRoute) {
      const nextView = signalLabView(tail[2]);
      const nextTab = signalLabTab(tail[3]);
      const options = routeOptions(tail.slice(4));
      const route: WorkspaceRouteState = {
        ...fallback,
        view: pathView,
        selectionId,
        signalLab: true,
        customSignal: true,
        signalLabView: nextView,
        signalLabTab: nextTab,
        binaryDecoderMode: binaryDecoderMode(options.get("decoder")),
        codeFormat: routeFormat(options.get("format")) || "pronto",
        zoom: routeNumber(options.get("zoom"), 1, 1, 16),
        pan: routeNumber(options.get("pan"), 0, 0, 1),
        saveOpen: options.get("save") === "1",
        editingOverlays: options.get("overlays") === "1",
      };
      const expectedTail = [
        "signal-lab",
        "new",
        nextView,
        nextTab,
        ...contextSegments(route, true),
      ];
      return {
        ...route,
        canonicalize: tail.join("/") !== expectedTail.join("/") || staleQuery,
      };
    }
    const hasCommandRoute =
      pathView === "remote_profiles" &&
      Boolean(selectionId) &&
      tail[0] === "commands" &&
      Boolean(tail[1]);
    if (!hasCommandRoute) {
      return {
        ...fallback,
        view: pathView,
        selectionId,
        canonicalize: tail.length > 0 || staleQuery,
      };
    }

    const commandId = decodeSegment(tail[1]);
    const isSignalLab = tail[2] === "signal-lab";
    if (isSignalLab) {
      const nextView = signalLabView(tail[3]);
      const nextTab = signalLabTab(tail[4]);
      const options = routeOptions(tail.slice(5));
      const route: WorkspaceRouteState = {
        ...fallback,
        view: pathView,
        selectionId,
        commandId,
        signalLab: true,
        signalLabView: nextView,
        signalLabTab: nextTab,
        binaryDecoderMode: binaryDecoderMode(options.get("decoder")),
        codeFormat: routeFormat(options.get("format")) || "pronto",
        zoom: routeNumber(options.get("zoom"), 1, 1, 16),
        pan: routeNumber(options.get("pan"), 0, 0, 1),
        saveOpen: options.get("save") === "1",
        editingOverlays: options.get("overlays") === "1",
      };
      const expectedTail = [
        "commands",
        encodeURIComponent(commandId),
        "signal-lab",
        nextView,
        nextTab,
        ...contextSegments(route, true),
      ];
      return {
        ...route,
        canonicalize: tail.join("/") !== expectedTail.join("/") || staleQuery,
      };
    }

    const nextInspectorTab = inspectorTab(tail[2]);
    const options = routeOptions(tail.slice(3));
    const route: WorkspaceRouteState = {
      ...fallback,
      view: pathView,
      selectionId,
      commandId,
      inspectorTab: nextInspectorTab,
      binaryDecoderMode: binaryDecoderMode(options.get("decoder")),
      codeFormat: routeFormat(options.get("format")),
      zoom: routeNumber(options.get("zoom"), 1, 1, 16),
      pan: routeNumber(options.get("pan"), 0, 0, 1),
      selectedRevision: routeNumber(
        options.get("revision"),
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    };
    const expectedTail = [
      "commands",
      encodeURIComponent(commandId),
      nextInspectorTab,
      ...contextSegments(route, false),
    ];
    return {
      ...route,
      canonicalize: tail.join("/") !== expectedTail.join("/") || staleQuery,
    };
  }

  const oldestRoute = legacyWorkspaceRoute(url);
  if (oldestRoute) return oldestRoute;

  const legacyView = url.searchParams.get("view") as WorkspaceView | null;
  if (legacyView && WORKSPACE_VIEWS.has(legacyView)) {
    const selectionId =
      legacyView === "remote_profiles"
      ? url.searchParams.get("profile") || ""
      : legacyView === "appliances"
        ? url.searchParams.get("appliance") || ""
        : "";
    const commandId =
      legacyView === "remote_profiles"
      ? url.searchParams.get("command") || ""
      : "";
    const isSignalLab =
      commandId && url.searchParams.get("workspace") === "signal-lab";
    return {
      ...fallback,
      view: legacyView,
      selectionId,
      commandId,
      inspectorTab: inspectorTab(url.searchParams.get("detail")),
      signalLab: Boolean(isSignalLab),
      signalLabView: signalLabView(url.searchParams.get("lab_view")),
      signalLabTab: signalLabTab(url.searchParams.get("lab_detail")),
      binaryDecoderMode: binaryDecoderMode(url.searchParams.get("decoder")),
      codeFormat:
        routeFormat(url.searchParams.get("format")) ||
        (isSignalLab ? "pronto" : ""),
      zoom: routeNumber(url.searchParams.get("zoom"), 1, 1, 16),
      pan: routeNumber(url.searchParams.get("pan"), 0, 0, 1),
      selectedRevision: routeNumber(
        url.searchParams.get("revision"),
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      saveOpen: url.searchParams.get("save") === "1",
      editingOverlays: url.searchParams.get("overlays") === "1",
      canonicalize: rootIndex >= 0,
    };
  }

  return {
    ...fallback,
    canonicalize: rootIndex >= 0,
  };
};

const clearLegacyParams = (url: URL): void => {
  for (const name of LEGACY_QUERY_KEYS) {
    url.searchParams.delete(name);
  }
};

export const workspaceUrl = (
  current: URL,
  route: WorkspaceRouteState,
): string => {
  const url = new URL(current);
  clearLegacyParams(url);
  const segments = url.pathname.split("/").filter(Boolean);
  const rootIndex = panelIndex(segments);
  if (rootIndex >= 0) {
    const nextSegments = [
      ...segments.slice(0, rootIndex + 1),
      VIEW_PATHS[route.view],
    ];
    if (route.selectionId && route.view !== "infrared_hardware") {
      nextSegments.push(encodeURIComponent(route.selectionId));
    }
    if (
      route.view === "remote_profiles" &&
      route.selectionId &&
      route.signalLab &&
      route.customSignal
    ) {
      nextSegments.push(
        "signal-lab",
        "new",
        route.signalLabView,
        route.signalLabTab,
        ...contextSegments(route, true),
      );
    }
    if (
      route.view === "remote_profiles" &&
      route.selectionId &&
      route.commandId &&
      !route.customSignal
    ) {
      nextSegments.push("commands", encodeURIComponent(route.commandId));
      if (route.signalLab) {
        nextSegments.push(
          "signal-lab",
          route.signalLabView,
          route.signalLabTab,
        );
        nextSegments.push(...contextSegments(route, true));
      } else {
        nextSegments.push(route.inspectorTab);
        nextSegments.push(...contextSegments(route, false));
      }
    }
    url.pathname = `/${nextSegments.join("/")}`;
  } else {
    url.searchParams.set("view", route.view);
    if (route.selectionId && route.view === "remote_profiles") {
      url.searchParams.set("profile", route.selectionId);
    }
    if (route.selectionId && route.view === "appliances") {
      url.searchParams.set("appliance", route.selectionId);
    }
    if (
      route.view === "remote_profiles" &&
      route.selectionId &&
      route.signalLab &&
      route.customSignal
    ) {
      url.searchParams.set("workspace", "signal-lab");
      url.searchParams.set("custom", "1");
      url.searchParams.set("lab_view", route.signalLabView);
      url.searchParams.set("lab_detail", route.signalLabTab);
      if (route.binaryDecoderMode !== "auto") {
        url.searchParams.set("decoder", route.binaryDecoderMode);
      }
      if (route.codeFormat && route.codeFormat !== "pronto") {
        url.searchParams.set("format", route.codeFormat);
      }
      if (route.zoom !== 1) url.searchParams.set("zoom", String(route.zoom));
      if (route.pan !== 0) url.searchParams.set("pan", String(route.pan));
      if (route.saveOpen) url.searchParams.set("save", "1");
      if (route.editingOverlays) url.searchParams.set("overlays", "1");
    }
    if (
      route.view === "remote_profiles" &&
      route.selectionId &&
      route.commandId &&
      !route.customSignal
    ) {
      url.searchParams.set("command", route.commandId);
      if (route.signalLab) {
        url.searchParams.set("workspace", "signal-lab");
        url.searchParams.set("lab_view", route.signalLabView);
        url.searchParams.set("lab_detail", route.signalLabTab);
        if (route.binaryDecoderMode !== "auto") {
          url.searchParams.set("decoder", route.binaryDecoderMode);
        }
        if (route.codeFormat && route.codeFormat !== "pronto") {
          url.searchParams.set("format", route.codeFormat);
        }
        if (route.zoom !== 1) url.searchParams.set("zoom", String(route.zoom));
        if (route.pan !== 0) url.searchParams.set("pan", String(route.pan));
        if (route.saveOpen) url.searchParams.set("save", "1");
        if (route.editingOverlays) url.searchParams.set("overlays", "1");
      } else {
        url.searchParams.set("detail", route.inspectorTab);
        if (route.binaryDecoderMode !== "auto") {
          url.searchParams.set("decoder", route.binaryDecoderMode);
        }
        if (route.codeFormat) url.searchParams.set("format", route.codeFormat);
        if (route.zoom !== 1) url.searchParams.set("zoom", String(route.zoom));
        if (route.pan !== 0) url.searchParams.set("pan", String(route.pan));
        if (route.selectedRevision > 0) {
          url.searchParams.set("revision", String(route.selectedRevision));
        }
      }
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
};
