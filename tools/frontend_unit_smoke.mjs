import assert from "node:assert/strict";
import { build } from "esbuild";

const loadModule = async (entryPoint) => {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
};

const routes = await loadModule("frontend/core/workspace-route.ts");
const geometry = await loadModule(
  "frontend/components/signal-lab/waveform-geometry.ts",
);
const comparison = await loadModule("frontend/core/waveform-comparison.ts");
const homeAssistantUse = await loadModule("frontend/core/home-assistant-use.ts");
const workflowOptions = await loadModule(
  "frontend/components/workflows/options.ts",
);
const captureTiming = await loadModule("frontend/core/capture-timing.ts");

const captureStart = 1_000_000;
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart, 60),
  { promptActive: false, remaining: 60, expired: false },
);
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart + 4_999, 60),
  { promptActive: false, remaining: 60, expired: false },
);
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart + 5_000, 60),
  { promptActive: true, remaining: 60, expired: false },
);
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart + 15_001, 60),
  { promptActive: true, remaining: 50, expired: false },
);
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart + 64_999, 60),
  { promptActive: true, remaining: 1, expired: false },
);
assert.deepEqual(
  captureTiming.captureTimingState(captureStart, captureStart + 65_000, 60),
  { promptActive: true, remaining: 0, expired: true },
);

assert.deepEqual(
  workflowOptions
    .identifyCommandRoleOptions("light")
    .map((option) => option.value),
  ["", "power_on", "power_off", "power_toggle"],
);
assert.ok(
  workflowOptions
    .identifyCommandRoleOptions("tv")
    .some((option) => option.value === "volume_up"),
);
assert.ok(
  !workflowOptions
    .identifyCommandRoleOptions("fan")
    .some((option) => option.value === "play"),
);

const inspector = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living%20room/commands/power%2Fon/history",
  ),
);
assert.deepEqual(
  {
    view: inspector.view,
    profile: inspector.selectionId,
    command: inspector.commandId,
    tab: inspector.inspectorTab,
    lab: inspector.signalLab,
    canonicalize: inspector.canonicalize,
  },
  {
    view: "remote_profiles",
    profile: "living room",
    command: "power/on",
    tab: "history",
    lab: false,
    canonicalize: false,
  },
);

const signalLab = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/compare/code",
  ),
);
assert.equal(signalLab.signalLab, true);
assert.equal(signalLab.signalLabView, "compare");
assert.equal(signalLab.signalLabTab, "code");
assert.equal(signalLab.binaryDecoderMode, "auto");
assert.equal(signalLab.canonicalize, false);

const decodedLab = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/edit/decoded/decoder/pulse-distance",
  ),
);
assert.equal(decodedLab.binaryDecoderMode, "pulse_distance");
assert.equal(decodedLab.canonicalize, false);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/remote-profiles"),
    decodedLab,
  ),
  "/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/edit/decoded/decoder/pulse-distance",
);

const decodedInspector = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/code/decoder/pulse-width",
  ),
);
assert.equal(decodedInspector.binaryDecoderMode, "pulse_width");
assert.equal(decodedInspector.canonicalize, false);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/remote-profiles"),
    decodedInspector,
  ),
  "/imprint-refinery/remote-profiles/living-room/commands/power/code/decoder/pulse-width",
);

const incompleteLab = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab",
  ),
);
assert.equal(incompleteLab.signalLabView, "edit");
assert.equal(incompleteLab.signalLabTab, "timings");
assert.equal(incompleteLab.canonicalize, true);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/remote-profiles"),
    incompleteLab,
  ),
  "/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/edit/timings",
);

const remoteUse = homeAssistantUse.buildHomeAssistantUse(
  "television",
  "power",
  { home_assistant: { entity_id: "remote.television", platform: "remote" } },
  { name: "Power" },
);
assert.equal(remoteUse.action, "remote.send_command");
assert.deepEqual(remoteUse.serviceData, {
  entity_id: "remote.television",
  command: "power",
  num_repeats: 1,
  delay_secs: 0.4,
});

const legacy = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery?view=remote_profiles&profile=living-room&command=power&detail=signal",
  ),
);
assert.equal(
  routes.workspaceUrl(
    new URL(
      "https://example.invalid/imprint-refinery?view=remote_profiles&profile=living-room&command=power&detail=signal",
    ),
    legacy,
  ),
  "/imprint-refinery/remote-profiles/living-room/commands/power/signal",
);

const oldestInspector = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery?screen=command&location=living_room&appliance=television&command=power&tab=history&revision=2",
  ),
);
assert.deepEqual(
  {
    view: oldestInspector.view,
    profile: oldestInspector.selectionId,
    command: oldestInspector.commandId,
    tab: oldestInspector.inspectorTab,
    canonicalize: oldestInspector.canonicalize,
  },
  {
    view: "remote_profiles",
    profile: "living_room__television",
    command: "power",
    tab: "history",
    canonicalize: true,
  },
);
assert.equal(
  routes.workspaceUrl(
    new URL(
      "https://example.invalid/imprint-refinery?screen=command&location=living_room&appliance=television&command=power&tab=history&revision=2",
    ),
    oldestInspector,
  ),
  "/imprint-refinery/remote-profiles/living_room__television/commands/power/history/revision/2",
);

const oldestLab = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery?screen=lab&location=living_room&appliance=television&command=power&lab_view=compare&lab_tab=code&decoder=protocol&zoom=4",
  ),
);
assert.equal(oldestLab.signalLab, true);
assert.equal(oldestLab.signalLabView, "compare");
assert.equal(oldestLab.signalLabTab, "code");
assert.equal(oldestLab.binaryDecoderMode, "protocol");
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery?screen=lab&location=living_room&appliance=television&command=power&lab_view=compare&lab_tab=code&decoder=protocol&zoom=4"),
    oldestLab,
  ),
  "/imprint-refinery/remote-profiles/living_room__television/commands/power/signal-lab/compare/code/decoder/protocol/zoom/4",
);

const fullLabContext = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/edit/code/decoder/pulse-width/format/flipper/zoom/8/pan/0.35/save/overlays",
  ),
);
assert.equal(fullLabContext.codeFormat, "flipper");
assert.equal(fullLabContext.zoom, 8);
assert.equal(fullLabContext.pan, 0.35);
assert.equal(fullLabContext.saveOpen, true);
assert.equal(fullLabContext.editingOverlays, true);
assert.equal(fullLabContext.canonicalize, false);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/remote-profiles"),
    fullLabContext,
  ),
  "/imprint-refinery/remote-profiles/living-room/commands/power/signal-lab/edit/code/decoder/pulse-width/format/flipper/zoom/8/pan/0.35/save/overlays",
);

const fullInspectorContext = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/commands/power/history/format/pronto/revision/3",
  ),
);
assert.equal(fullInspectorContext.codeFormat, "pronto");
assert.equal(fullInspectorContext.selectedRevision, 3);
assert.equal(fullInspectorContext.canonicalize, false);

const customSignalLab = routes.workspaceRouteFromUrl(
  new URL(
    "https://example.invalid/imprint-refinery/remote-profiles/living-room/signal-lab/new/edit/timings/zoom/2",
  ),
);
assert.equal(customSignalLab.signalLab, true);
assert.equal(customSignalLab.customSignal, true);
assert.equal(customSignalLab.commandId, "");
assert.equal(customSignalLab.zoom, 2);
assert.equal(customSignalLab.canonicalize, false);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/remote-profiles"),
    customSignalLab,
  ),
  "/imprint-refinery/remote-profiles/living-room/signal-lab/new/edit/timings/zoom/2",
);

const oldestLibrary = routes.workspaceRouteFromUrl(
  new URL("https://example.invalid/imprint-refinery?screen=library&location=living_room&appliance=television&keep=yes#saved"),
);
assert.equal(oldestLibrary.view, "appliances");
assert.equal(oldestLibrary.selectionId, "living_room__television");
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery?screen=library&location=living_room&appliance=television&keep=yes#saved"),
    oldestLibrary,
  ),
  "/imprint-refinery/appliances/living_room__television?keep=yes#saved",
);

const staleCanonical = routes.workspaceRouteFromUrl(
  new URL("https://example.invalid/imprint-refinery/appliances/lamp?screen=library&tab=code&keep=yes"),
);
assert.equal(staleCanonical.canonicalize, true);
assert.equal(
  routes.workspaceUrl(
    new URL("https://example.invalid/imprint-refinery/appliances/lamp?screen=library&tab=code&keep=yes"),
    staleCanonical,
  ),
  "/imprint-refinery/appliances/lamp?keep=yes",
);

const evenShortTrace = geometry.trackGeometry([10, 10], 100, 1, 0, true, false);
assert.match(evenShortTrace.path, /H 1000$/);
const oddShortTrace = geometry.trackGeometry([10], 100, 1, 0, true, false);
assert.match(oddShortTrace.path, /V 92 H 1000$/);
const clippedShortTrace = geometry.trackGeometry([10, 10], 100, 2, 0, true, false);
assert.doesNotMatch(clippedShortTrace.path, /H 1000$/);
const fullTrace = geometry.trackGeometry([50, 50], 100, 1, 0, true, false);
assert.match(fullTrace.path, /H 1000$/);
const oddFullTrace = geometry.trackGeometry([100], 100, 1, 0, true, false);
assert.match(oddFullTrace.path, /V 92 H 1000$/);

const before = { label: "Before", timings: [100, 100, 100, 100] };
const after = { label: "After", timings: [150, 50, 50, 250] };
const earlyProbe = comparison.comparisonProbeAt(before, after, 125);
assert.equal(earlyProbe.percent, 25);
assert.deepEqual(
  { index: earlyProbe.before.index, role: earlyProbe.before.role },
  { index: 1, role: "space" },
);
assert.deepEqual(
  { index: earlyProbe.after.index, role: earlyProbe.after.role },
  { index: 0, role: "mark" },
);
const tailProbe = comparison.comparisonProbeAt(before, after, 450);
assert.equal(tailProbe.before, null);
assert.deepEqual(
  { index: tailProbe.after.index, role: tailProbe.after.role },
  { index: 3, role: "space" },
);

const insertedPair = comparison.compareWaveforms(
  { label: "Before", timings: [100, 100, 300, 300] },
  { label: "After", timings: [100, 100, 50, 50, 300, 300] },
);
assert.equal(insertedPair.structureChanged, true);
assert.equal(insertedPair.countDelta, 2);
assert.deepEqual(
  insertedPair.changes.map((change) => change.kind),
  ["inserted", "inserted"],
  "An inserted mark/space pair must not make every later timing appear changed",
);

console.log("Frontend route, waveform geometry, and comparison model smoke checks passed.");
