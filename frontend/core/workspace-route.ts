import type {
  InspectorTab,
  WorkspaceView,
} from "../components/workspace/events";

const PANEL_SEGMENT = "imprint-refinery";
const VIEW_PATHS: Record<WorkspaceView, string> = {
  appliances: "appliances",
  remote_profiles: "remote-profiles",
  infrared_hardware: "infrared-hardware",
};
const PATH_VIEWS = new Map(
  Object.entries(VIEW_PATHS).map(([view, path]) => [path, view as WorkspaceView]),
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
const SIGNAL_LAB_TABS = new Set<SignalLabTab>([
  "decoded",
  "timings",
  "code",
]);
const LEGACY_QUERY_KEYS = [
  "view", "profile", "appliance", "command", "detail", "workspace",
  "lab_view", "lab_detail", "screen", "location", "tab", "format",
  "decoder", "zoom", "pan", "lab_tab", "save", "overlays",
  "catalog_mode", "category", "brand", "model", "target", "searched",
  "dialog", "revision", "custom",
] as const;

export interface WorkspaceRouteState {
  view: WorkspaceView;
  selectionId: string;
  commandId: string;
  inspectorTab: InspectorTab;
  signalLab: boolean;
  signalLabView: SignalLabView;
  signalLabTab: SignalLabTab;
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
  signalLabView: "edit",
  signalLabTab: "timings",
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
      signalLabView: signalLabView(url.searchParams.get("lab_view")),
      signalLabTab: signalLabTab(url.searchParams.get("lab_tab")),
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
  const pathView = rootIndex >= 0
    ? PATH_VIEWS.get(segments[rootIndex + 1] || "")
    : undefined;
  const staleQuery = LEGACY_QUERY_KEYS.some((key) => url.searchParams.has(key));
  if (pathView) {
    const selectionId = pathView === "infrared_hardware"
      ? ""
      : decodeSegment(segments[rootIndex + 2]);
    const tail = segments.slice(rootIndex + 3);
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
      return {
        ...fallback,
        view: pathView,
        selectionId,
        commandId,
        signalLab: true,
        signalLabView: nextView,
        signalLabTab: nextTab,
        canonicalize:
          tail.length !== 5 ||
          tail[3] !== nextView ||
          tail[4] !== nextTab || staleQuery,
      };
    }

    const nextInspectorTab = inspectorTab(tail[2]);
    return {
      ...fallback,
      view: pathView,
      selectionId,
      commandId,
      inspectorTab: nextInspectorTab,
      canonicalize:
        tail.length !== 3 || tail[2] !== nextInspectorTab || staleQuery,
    };
  }

  const oldestRoute = legacyWorkspaceRoute(url);
  if (oldestRoute) return oldestRoute;

  const legacyView = url.searchParams.get("view") as WorkspaceView | null;
  if (legacyView && WORKSPACE_VIEWS.has(legacyView)) {
    const selectionId = legacyView === "remote_profiles"
      ? url.searchParams.get("profile") || ""
      : legacyView === "appliances"
        ? url.searchParams.get("appliance") || ""
        : "";
    const commandId = legacyView === "remote_profiles"
      ? url.searchParams.get("command") || ""
      : "";
    const isSignalLab = commandId && url.searchParams.get("workspace") === "signal-lab";
    return {
      ...fallback,
      view: legacyView,
      selectionId,
      commandId,
      inspectorTab: inspectorTab(url.searchParams.get("detail")),
      signalLab: Boolean(isSignalLab),
      signalLabView: signalLabView(url.searchParams.get("lab_view")),
      signalLabTab: signalLabTab(url.searchParams.get("lab_detail")),
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
      route.commandId
    ) {
      nextSegments.push("commands", encodeURIComponent(route.commandId));
      if (route.signalLab) {
        nextSegments.push(
          "signal-lab",
          route.signalLabView,
          route.signalLabTab,
        );
      } else {
        nextSegments.push(route.inspectorTab);
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
      route.commandId
    ) {
      url.searchParams.set("command", route.commandId);
      if (route.signalLab) {
        url.searchParams.set("workspace", "signal-lab");
        url.searchParams.set("lab_view", route.signalLabView);
        url.searchParams.set("lab_detail", route.signalLabTab);
      } else {
        url.searchParams.set("detail", route.inspectorTab);
      }
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
};
