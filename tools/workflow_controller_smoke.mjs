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
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
};

const { WorkflowController } = await loadModule(
  "frontend/controllers/workflow-controller.ts",
);

const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
};

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const beginLearn = (harness) => {
  harness.controller.openLearn("target");
  assert.equal(harness.controller.dialog.data.stage, "choose");
  assert.equal(
    harness.controller.dialog.data.infrared_receiver_ref,
    "receiver-one",
  );
  assert.equal(
    harness.calls.some((call) => call.action === "capture_signal"),
    false,
    "Opening Learn command must not start hardware capture",
  );
  harness.controller.handleAction({ type: "learn-start" });
};

const rawSignal = {
  carrier_frequency: 38_000,
  carrier_source: "assumed",
  timings: [9_000, 4_500, 560, 560, 560, 1_690],
};
const originalAnalysis = {
  protocol: "NEC",
  evidence_class: "likely",
  fingerprints: {
    normalized_50us: "same-normalized-fingerprint",
    exact: "same-exact-fingerprint",
  },
  single_press_candidate: {
    timings: [9_000, 4_500, 560, 560],
  },
};

const createHarness = ({
  analysisFailure = false,
  duplicate = false,
  inspectImport,
  failOptimizedSaveOnce = false,
  captureDeferred,
  catalogMatchDeferred,
  catalogIdentifyResponses = [],
} = {}) => {
  const registry = {
    remote_profiles: {
      target: { name: "Target remote", commands: {} },
      ...(duplicate
        ? {
            existing: {
              name: "Existing remote",
              commands: {
                power: {
                  name: "Power",
                  role: "power_toggle",
                  analysis: {
                    fingerprints: {
                      normalized_50us: "same-normalized-fingerprint",
                      exact: "same-exact-fingerprint",
                    },
                  },
                },
              },
            },
          }
        : {}),
    },
    infrared_hardware: {
      emitters: [
        {
          ref: "emitter-one",
          entity_id: "infrared.emitter_one",
          name: "Emitter one",
          available: true,
        },
      ],
      receivers: [
        {
          ref: "receiver-one",
          entity_id: "infrared.receiver_one",
          name: "Receiver one",
          available: true,
        },
      ],
    },
    appliances: {},
    areas: [{ area_id: "living-room", name: "Living room" }],
  };
  const calls = [];
  const errors = [];
  const opened = [];
  const customDrafts = [];
  const dialogs = [];
  const capturing = [];
  let optimizedSaveFailures = failOptimizedSaveOnce ? 1 : 0;
  const host = {
    call: async (action, data = {}) => {
      calls.push({ action, data });
      if (action === "capture_signal") {
        if (captureDeferred) return captureDeferred.promise;
        return { code: "raw-capture", format: "raw_signed", signal: rawSignal };
      }
      if (action === "analyze_signal") {
        if (analysisFailure) throw new Error("analysis unavailable");
        const optimized = data.code === "optimized-capture";
        return {
          code: data.code,
          format: "raw_signed",
          signal: optimized
            ? { ...rawSignal, timings: [9_000, 4_500, 560, 560] }
            : rawSignal,
          analysis: originalAnalysis,
        };
      }
      if (action === "catalog_match_signal") {
        if (catalogMatchDeferred) return catalogMatchDeferred.promise;
        return {
          matches: duplicate
            ? [
                {
                  profile: {
                    profile_id: "catalog-profile",
                    name: "Catalog remote",
                  },
                  command: { command_id: "power", name: "Power" },
                },
              ]
            : [],
        };
      }
      if (action === "catalog_identify_signals") {
        if (catalogMatchDeferred) return catalogMatchDeferred.promise;
        return (
          catalogIdentifyResponses.shift() || {
            captures: data.captures.map((capture, index) => ({
              index: index + 1,
              role: capture.role || "",
              profile_count: 0,
              duplicate_of: null,
            })),
            match_count: 0,
            truncated: false,
            matches: [],
          }
        );
      }
      if (action === "catalog_profile") {
        return {
          profile_id: data.catalog_profile_id,
          name: "Catalog remote",
          category: "tv",
          commands: [
            {
              command_id: "power",
              name: "Power",
              code: "catalog-power",
              format: "raw_signed",
              source: { type: "catalog" },
              import: { provenance: { source_path: "synthetic/catalog.ir" } },
            },
            {
              command_id: "volume_up",
              name: "Volume up",
              code: "catalog-volume-up",
              format: "raw_signed",
            },
          ],
          import_plan: {
            starter_command_ids: ["power"],
            all_command_ids: ["power", "volume_up"],
          },
        };
      }
      if (action === "export_backup") {
        return {
          schema: "imprint_refinery.backup",
          version: 2,
          remote_profiles: {},
          appliances: {},
        };
      }
      if (action === "inspect_import") {
        if (inspectImport) return inspectImport(data);
        return {
          format: "native_json",
          remote_profiles: { legacy__fan: { name: "Fan", commands: {} } },
          appliances: {
            legacy__fan: {
              name: "Fan",
              remote_profile_id: "legacy__fan",
              area_name: "Living room",
            },
          },
        };
      }
      if (action === "encode_signal") return { code: "optimized-capture" };
      if (action === "store_command") {
        if (
          data.source?.type === "single_press_optimization" &&
          optimizedSaveFailures > 0
        ) {
          optimizedSaveFailures -= 1;
          throw new Error("optimized save failed");
        }
        return { status: "saved" };
      }
      return {};
    },
    run: async (operation) => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    },
    registry: () => registry,
    testEmitterRef: () => "",
    captureTimeout: () => 60,
    setBusy: () => {},
    dialogChanged: (dialog) => dialogs.push(dialog),
    capturingChanged: (receiverRef) => capturing.push(receiverRef),
    clearInspector: () => {},
    clearCommandSelection: () => {},
    openCommand: async (profileId, commandId) => {
      opened.push({ profileId, commandId });
    },
    showInspectorHistory: () => {},
    changeView: () => {},
    setError: (message) => {
      if (message) errors.push(new Error(message));
    },
    copyText: async () => {},
    reload: async () => {},
    openCustomSignalDraft: (profileId, bootstrap) => {
      customDrafts.push({ profileId, bootstrap });
    },
  };
  return {
    controller: new WorkflowController(host),
    calls,
    errors,
    opened,
    customDrafts,
    dialogs,
    capturing,
  };
};

{
  const capture = deferred();
  const matching = deferred();
  const harness = createHarness({
    captureDeferred: capture,
    catalogMatchDeferred: matching,
  });
  harness.controller.openCatalog();
  harness.controller.handleAction({ type: "catalog-mode", mode: "identify" });
  assert.equal(
    harness.controller.dialog.data.identify_appliance_type,
    "generic",
  );
  harness.controller.handleAction({ type: "catalog-identify" });
  await waitFor(
    () =>
      harness.calls.some((call) => call.action === "capture_signal") &&
      harness.controller.dialog?.data?.identify_stage === "listening",
    "Catalog identification should enter its listening stage",
  );
  assert.equal(harness.capturing.at(-1), "receiver-one");

  capture.resolve({
    code: "raw-capture",
    format: "raw_signed",
    signal: rawSignal,
  });
  await waitFor(
    () => harness.controller.dialog?.data?.identify_stage === "matching",
    "Catalog identification should expose its matching stage",
  );
  assert.equal(harness.capturing.at(-1), "");

  matching.resolve({
    captures: [{ index: 1, role: "", profile_count: 1, duplicate_of: null }],
    match_count: 1,
    truncated: false,
    matches: [
      {
        profile: { profile_id: "matched", name: "Matched remote" },
        evidence: [
          {
            capture_index: 1,
            command: { command_id: "off", name: "OFF", role: "power_off" },
            match_method: "Decoded NEC command match",
          },
        ],
      },
    ],
  });
  await waitFor(
    () => harness.controller.dialog?.data?.identified === true,
    "Catalog identification should publish its matches",
  );
  assert.equal(harness.controller.dialog.data.identify_stage, "idle");
  assert.equal(
    harness.controller.dialog.data.identify_results[0].profile.profile_id,
    "matched",
  );
  assert.equal(harness.controller.dialog.data.identify_captures.length, 1);
  assert.equal(
    harness.calls.find((call) => call.action === "catalog_identify_signals")
      .data.captures.length,
    1,
  );
}

{
  const harness = createHarness({
    catalogIdentifyResponses: [
      {
        captures: [
          { index: 1, role: "power_off", profile_count: 3, duplicate_of: null },
        ],
        match_count: 3,
        truncated: false,
        matches: [
          { profile: { profile_id: "a" }, evidence: [] },
          { profile: { profile_id: "b" }, evidence: [] },
          { profile: { profile_id: "c" }, evidence: [] },
        ],
      },
      {
        captures: [
          { index: 1, role: "power_off", profile_count: 3, duplicate_of: null },
          { index: 2, role: "power_on", profile_count: 1, duplicate_of: null },
        ],
        match_count: 1,
        truncated: false,
        matches: [{ profile: { profile_id: "b" }, evidence: [] }],
      },
    ],
  });
  harness.controller.openCatalog();
  harness.controller.handleAction({ type: "catalog-mode", mode: "identify" });
  harness.controller.updateField("identify_appliance_type", "light");
  harness.controller.updateField("identify_role", "power_off");
  harness.controller.handleAction({ type: "catalog-identify" });
  await waitFor(
    () => harness.controller.dialog?.data?.identify_match_count === 3,
    "The first labeled button should publish its complete match summary",
  );
  harness.controller.updateField("identify_appliance_type", "tv");
  assert.equal(harness.controller.dialog.data.identify_appliance_type, "light");
  harness.controller.updateField("identify_role", "power_on");
  harness.controller.handleAction({ type: "catalog-identify" });
  await waitFor(
    () => harness.controller.dialog?.data?.identify_match_count === 1,
    "The second button should narrow the cumulative profile set",
  );
  const calls = harness.calls.filter(
    (call) => call.action === "catalog_identify_signals",
  );
  assert.equal(calls[1].data.captures.length, 2);
  assert.equal(calls[1].data.captures[0].role, "power_off");
  assert.equal(calls[1].data.captures[1].role, "power_on");
  assert.equal(calls[0].data.appliance_type, "light");
  assert.equal(calls[1].data.appliance_type, "light");
  assert.equal(
    harness.controller.dialog.data.identify_results[0].profile.profile_id,
    "b",
  );

  harness.controller.handleAction({ type: "catalog-identify-remove-last" });
  assert.equal(harness.controller.dialog.data.identify_match_count, 3);
  assert.equal(harness.controller.dialog.data.identify_captures.length, 1);
  harness.controller.handleAction({ type: "catalog-identify-reset" });
  assert.equal(harness.controller.dialog.data.identify_captures.length, 0);
  assert.equal(harness.controller.dialog.data.identified, false);
}

{
  const harness = createHarness({ analysisFailure: true });
  beginLearn(harness);
  await waitFor(
    () => harness.controller.dialog?.data?.stage === "review",
    "A raw capture should remain reviewable when analysis fails",
  );
  assert.equal(harness.controller.dialog.data.preview.code, "raw-capture");
  assert.deepEqual(
    harness.controller.dialog.data.preview.signal.timings,
    rawSignal.timings,
  );
  assert.match(
    harness.controller.dialog.data.analysis_error,
    /analysis unavailable/,
  );
  harness.controller.updateField("name", "Raw power");
  harness.controller.handleAction({ type: "learn-save", another: false });
  await waitFor(
    () => harness.controller.dialog === null,
    "The raw capture should save without analysis",
  );
  const stored = harness.calls.filter(
    (call) => call.action === "store_command",
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].data.code, "raw-capture");
  assert.equal(stored[0].data.source.type, "learn");
  assert.equal(harness.errors.length, 0);
}

{
  const harness = createHarness({ duplicate: true });
  beginLearn(harness);
  await waitFor(
    () => harness.controller.dialog?.data?.stage === "review",
    "A duplicate capture should reach review",
  );
  const duplicate = harness.controller.dialog.data.duplicate_match;
  assert.deepEqual(
    {
      profile: duplicate.remote_profile_id,
      command: duplicate.command_id,
      basis: duplicate.match_basis,
    },
    { profile: "existing", command: "power", basis: "normalized_50us" },
  );
  const catalogMatch = harness.controller.dialog.data.catalog_matches[0];
  harness.controller.handleAction({
    type: "learn-catalog-review",
    match: catalogMatch,
  });
  await waitFor(
    () =>
      harness.controller.dialog?.data?.catalog_match_review?.name ===
      "Catalog remote",
    "A catalog match should be reviewable without leaving the learn draft",
  );
  harness.controller.handleAction({
    type: "learn-duplicate-replace",
    match: duplicate,
  });
  assert.equal(harness.controller.dialog.data.remote_profile_id, "existing");
  assert.equal(harness.controller.dialog.data.command_id, "power");
  assert.equal(harness.controller.dialog.data.relearn, true);
  assert.equal(harness.controller.dialog.data.role, "power_toggle");
}

{
  const harness = createHarness();
  beginLearn(harness);
  await waitFor(
    () => harness.controller.dialog?.data?.stage === "review",
    "An analyzed capture should reach review",
  );
  harness.controller.updateField("name", "Power");
  harness.controller.handleAction({ type: "learn-optimize" });
  await waitFor(
    () => harness.controller.dialog?.data?.optimized === true,
    "Single-press optimization should preserve the source draft",
  );
  assert.equal(
    harness.controller.dialog.data.original_preview.code,
    "raw-capture",
  );
  harness.controller.handleAction({ type: "learn-save", another: false });
  await waitFor(
    () => harness.controller.dialog === null,
    "The optimized capture should save",
  );
  const stored = harness.calls.filter(
    (call) => call.action === "store_command",
  );
  assert.deepEqual(
    stored.map((call) => call.data.code),
    ["raw-capture", "optimized-capture"],
  );
  assert.equal(stored[0].data.source.type, "captured_signal");
  assert.equal(
    stored[0].data.source.retained_before_single_press_optimization,
    true,
  );
  assert.equal(stored[1].data.source.type, "single_press_optimization");
  assert.equal(
    stored[1].data.source.original_capture_retained_as_prior_revision,
    true,
  );
  assert.equal(harness.errors.length, 0);
}

{
  const harness = createHarness({ failOptimizedSaveOnce: true });
  beginLearn(harness);
  await waitFor(
    () => harness.controller.dialog?.data?.stage === "review",
    "An analyzed capture should reach review before retry testing",
  );
  harness.controller.updateField("name", "Power");
  harness.controller.handleAction({ type: "learn-optimize" });
  await waitFor(
    () => harness.controller.dialog?.data?.optimized === true,
    "The optimized capture should be ready before retry testing",
  );
  harness.controller.handleAction({ type: "learn-save", another: false });
  await waitFor(
    () => harness.controller.dialog?.data?.original_capture_saved === true,
    "The original capture should remain marked saved after the optimized save fails",
  );
  harness.controller.handleAction({ type: "learn-save", another: false });
  await waitFor(
    () => harness.controller.dialog === null,
    "Retrying the optimized save should finish without duplicating the original",
  );
  const stored = harness.calls.filter(
    (call) => call.action === "store_command",
  );
  assert.equal(
    stored.filter((call) => call.data.source.type === "captured_signal").length,
    1,
  );
  assert.equal(
    stored.filter(
      (call) => call.data.source.type === "single_press_optimization",
    ).length,
    2,
  );
}

{
  const harness = createHarness();
  harness.controller.openCustomSignal("target");
  assert.deepEqual(harness.customDrafts, [
    { profileId: "target", bootstrap: undefined },
  ]);
  assert.equal(harness.controller.dialog, null);
}

{
  const harness = createHarness();
  harness.controller.openCatalog();
  harness.controller.handleAction({
    type: "catalog-preview",
    profile: { profile_id: "catalog-profile", name: "Catalog remote" },
  });
  await waitFor(
    () => harness.controller.dialog?.data?.mode === "profile",
    "A catalog result should open its profile review",
  );
  assert.deepEqual(harness.controller.dialog.data.selected_command_ids, [
    "power",
  ]);
  const profile = harness.controller.dialog.data.selected_profile;
  harness.controller.handleAction({
    type: "catalog-test-command",
    command: profile.commands[0],
  });
  await waitFor(
    () => harness.calls.some((call) => call.action === "send_signal"),
    "A catalog command should support a one-shot test",
  );
  harness.controller.handleAction({
    type: "catalog-selection-change",
    commandId: "volume_up",
    selected: true,
  });
  harness.controller.handleAction({
    type: "catalog-import",
    profile,
    commandIds: ["power", "volume_up"],
    mode: "selected",
  });
  await waitFor(
    () => harness.controller.dialog?.kind === "catalog-complete",
    "Selected catalog commands should import",
  );
  const stored = harness.calls.filter(
    (call) => call.action === "store_command",
  );
  assert.deepEqual(
    stored.map((call) => call.data.command_id),
    ["power", "volume_up"],
  );
  assert.equal(stored[0].data.source.import_mode, "selected");
  assert.equal(stored[0].data.source.source_path, "synthetic/catalog.ir");
}

{
  const harness = createHarness();
  await harness.controller.openBackup();
  const legacy = {
    schema: "imprint_refinery.backup",
    version: 1,
    locations: {
      legacy: {
        appliances: { fan: { name: "Fan", commands: {} } },
      },
    },
  };
  harness.controller.updateField("restore_value", JSON.stringify(legacy));
  harness.controller.handleAction({ type: "backup-review" });
  await waitFor(
    () => Boolean(harness.controller.dialog?.data?.restore_preview),
    "A legacy backup should be canonicalized for review",
  );
  assert.equal(
    harness.controller.dialog.data.restore_mappings.legacy__fan.area_id,
    "living-room",
  );
  assert.equal(
    harness.controller.dialog.data.restore_mappings.legacy__fan
      .infrared_emitter_ref,
    "emitter-one",
  );
  const inspection = harness.calls.find(
    (call) => call.action === "inspect_import",
  );
  assert.equal(inspection.data.format, "native_json");
  harness.controller.handleAction({ type: "backup-restore" });
  await waitFor(
    () => harness.controller.dialog === null,
    "A reviewed backup should restore",
  );
  const imported = harness.calls.find(
    (call) => call.action === "import_backup",
  );
  assert.deepEqual(JSON.parse(imported.data.code), legacy);
  const rebound = harness.calls.find(
    (call) => call.action === "update_appliance",
  );
  assert.equal(rebound.data.appliance_id, "legacy__fan");
}

{
  let resolveInspection;
  const inspection = new Promise((resolve) => {
    resolveInspection = resolve;
  });
  const harness = createHarness({ inspectImport: () => inspection });
  await harness.controller.openBackup();
  const first = JSON.stringify({
    schema: "imprint_refinery.backup",
    version: 1,
    locations: { first: { appliances: {} } },
  });
  const second = JSON.stringify({
    schema: "imprint_refinery.backup",
    version: 1,
    locations: { second: { appliances: {} } },
  });
  harness.controller.updateField("restore_value", first);
  harness.controller.handleAction({ type: "backup-review" });
  await waitFor(
    () => Boolean(resolveInspection),
    "Backup inspection should begin",
  );
  harness.controller.updateField("restore_value", second);
  resolveInspection({
    format: "native_json",
    remote_profiles: { first: { name: "First", commands: {} } },
    appliances: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(harness.controller.dialog.data.restore_document, null);
  assert.equal(harness.controller.dialog.data.restore_preview, null);
  assert.equal(harness.controller.dialog.data.restore_value, second);
}

console.log("Workflow controller regression smoke checks passed.");
