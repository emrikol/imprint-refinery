// Synthetic NEC-like data for browser tests. This is not a captured device signal.
const timings = [9000,4500,560,560,560,1690,560,560,560,1690,560,560,560,40000,9000,4500,560,560,560,1690,560,560,560,1690,560,560,560,40000];
const binaryPayload = { value: "00001000111101110000010011111011", bit_count: 32, display_order: "transmission", bit_order: "lsb_first", encoding: "pulse_distance", symbol: "space_length", zero_us: 560, one_us: 1690, evidence: "distance_width_model_and_recognized_protocol", confidence_score: 100, agreement_count: 4, method_count: 4, evidence_family_count: 2 };
const binaryDecoders = {
  strategy: "duration_bin_template_match", selected_mode: "pulse_distance",
  results: [
    { mode: "pulse_distance", status: "matched", fit: 1, payload: { ...binaryPayload, bit_order: "unknown", evidence: "distance_width_model", confidence_score: undefined, agreement_count: undefined, method_count: undefined } },
    { mode: "pulse_width", status: "rejected", reason: "requires_two_mark_classes_and_one_space_class" },
  ],
  protocol_results: [
    { protocol: "NEC", payload: binaryPayload },
    { protocol: "NEC", payload: binaryPayload },
    { protocol: "NEC1-f16", payload: binaryPayload },
  ],
  votes: [{ method: "pulse_distance", family: "waveform_model", value: binaryPayload.value, fit: 1 }, { method: "protocol:NEC", family: "named_protocol", value: binaryPayload.value }, { method: "protocol:NEC", family: "named_protocol", value: binaryPayload.value }, { method: "protocol:NEC1-f16", family: "named_protocol", value: binaryPayload.value }],
  auto: { status: "matched", confidence_score: 100, agreement_count: 4, method_count: 4, evidence_family_count: 2, selected_value: binaryPayload.value },
};
const analysis = {
  analyzer: "generic_structure", confidence: "likely", evidence_class: "likely", protocol: "NEC",
  pulse_count: timings.length, total_duration_us: timings.reduce((a, b) => a + b, 0), frame_count: 2,
  unique_frame_count: 1, repeated_frame_count: 1, repeat_count: 1, required_repeats: 0,
  minimum_frame_count: 1, repeat_requirement_met: true, repeat_style: "full_frame_repeat",
  warnings: ["repeated_pattern_unknown_protocol"],
  frames: [{ start: 0, end: 13, duration_us: 64000 }, { start: 14, end: 27, duration_us: 64000 }],
  frame_roles: [{ frame: 0, role: "intro" }, { frame: 1, role: "repeat" }],
  binary_payload: binaryPayload,
  binary_decoders: binaryDecoders,
  protocol_candidates: [
    { protocol: "NEC", evidence_class: "likely", score: .84, address: 16, command: 12, bits: 32, binary_payload: binaryPayload },
    { protocol: "NEC", evidence_class: "likely", score: .81, address: 65280, command: 12, bits: 32, binary_payload: binaryPayload },
    { protocol: "NEC1-f16", evidence_class: "likely", score: .79, address: 65280, command: 12, bits: 32, binary_payload: binaryPayload },
  ],
  protocol_rebuilds: [
    { id: "fixture-nec-rebuild", candidate_id: "fixture-nec", protocol: "NEC", evidence_class: "likely", carrier_frequency: 38000, carrier_changed: false, timing_count: timings.length, changed_timings: 2, duration_delta_us: -30, address: 16, command: 12, bits: 32 },
  ],
  fingerprints: { normalized_50us: "fixture-normalized-fingerprint", exact: "fixture-exact-fingerprint" },
  single_press_candidate: { timings: timings.slice(0, 14), kept_frames: 1, removed_frames: 1 },
};
const signal = { carrier_frequency: 38000, carrier_source: "assumed", timings };
const sircFrame = [2400, ...Array.from({ length: 12 }, () => [600, 600]).flat(), 28200];
const sircCanonical = [...sircFrame, ...sircFrame, ...sircFrame];
const sircAnalysis = {
  analyzer: "generic_structure", confidence: "likely", evidence_class: "likely", protocol: "SIRC",
  pulse_count: sircFrame.length, total_duration_us: 45000, frame_count: 1,
  repeated_frame_count: 0, repeat_count: 0, required_repeats: 2,
  minimum_frame_count: 3, repeat_requirement_met: false, repeat_style: "none",
  warnings: [], frames: [{ start: 0, end: sircFrame.length, duration_us: 45000 }],
  protocol_candidates: [{ protocol: "SIRC", evidence_class: "likely", address: 0, command: 0, bits: 12, reconstructable: true, rebuild_id: "fixture-sirc-rebuild" }],
  protocol_rebuilds: [{ id: "fixture-sirc-rebuild", candidate_id: "fixture-sirc", protocol: "SIRC", evidence_class: "likely", carrier_frequency: 40000, carrier_changed: true, timing_count: sircCanonical.length, changed_timings: sircCanonical.length - sircFrame.length, duration_delta_us: 90000, address: 0, command: 0, bits: 12 }],
};
const singleFrameTimings = [9000, 4500, ...binaryPayload.value.split("").flatMap(bit => [560, bit === "1" ? 1690 : 560]), 560];
const singleFrameAnalysis = {
  ...analysis,
  pulse_count: singleFrameTimings.length,
  total_duration_us: singleFrameTimings.reduce((sum, value) => sum + value, 0),
  frame_count: 1,
  unique_frame_count: 1,
  repeated_pattern: false,
  all_frames_equivalent: false,
  repeated_frame_count: 0,
  repeat_count: 0,
  required_repeats: 0,
  minimum_frame_count: 1,
  repeat_requirement_met: true,
  repeat_style: "none",
  frames: [{ index: 0, start_timing: 0, end_timing: singleFrameTimings.length, pulse_count: singleFrameTimings.length, duration_us: singleFrameTimings.reduce((sum, value) => sum + value, 0), group: 0 }],
  frame_roles: [{ frame: 0, role: "intro", kind: "full" }],
  single_press_candidate: undefined,
};
const command = {
  name: "Power", code: "CygjlBEwAjACMAKaBg==",
  format: "zosung_base64", icon: "mdi:power", role: "power_toggle",
  current_revision: 4, revision_count: 4, signal, analysis, source: { name: "Learned locally" },
};
const singleFrameCommand = {
  ...command,
  name: "Power on",
  signal: { ...signal, timings: singleFrameTimings },
  analysis: singleFrameAnalysis,
};
const convertedValues = {
  pronto: "0000 006D 0022 0000 0156 00AB 0015 0015 0015 0040 0015 0015 0015 0040",
  girr: "<girr:remote xmlns:girr=\"http://www.harctoolbox.org/Girr\"><girr:command name=\"Power experiment\"><girr:raw frequency=\"38000\"><girr:intro>9000 4500 560 560 560 1690</girr:intro></girr:raw></girr:command></girr:remote>",
  lirc: "begin remote\n  name imprint_refinery\n  flags RAW_CODES\n  eps 30\n  aeps 100\n  frequency 38000\n  begin raw_codes\n    name Power_experiment\n      9000 4500 560 560 560 1690\n  end raw_codes\nend remote",
  flipper: "Filetype: IR signals file\nVersion: 1\n#\nname: Power_experiment\ntype: raw\nfrequency: 38000\nduty_cycle: 0.330000\ndata: 9000 4500 560 560 560 1690",
  raw_signed: "+9000 -4500 +560 -560 +560 -1690",
  raw_unsigned: "9000 4500 560 560 560 1690",
};
const commandVariant = (name, icon, role) => ({ ...command, name, icon, role, current_revision: 1, revision_count: 1 });
const { protocol_rebuilds: _legacyMissingRebuilds, ...staleAnalysis } = analysis;
const unassignedCommand = {
  ...command,
  name: "Lamp on",
  home_assistant: { entity_id: "button.unsorted_remote_lamp_on", platform: "button" },
  source: { type: "single_press_optimization" },
  analysis: { ...analysis, evidence_class: "ambiguous", confidence: "ambiguous", warnings: ["ambiguous_protocol_candidates", "ambiguous_repeat_semantics"] },
};
const registry = {
  emitters: [{ key: "demo", name: "Living room emitter", entity_id: "infrared.demo", enabled: true, available: true, can_capture: true }],
  locations: {
    living_room: { name: "Living room", appliances: {
      television: { name: "Television", appliance_type: "media_player", emitter_id: "demo", home_assistant: { entity_id: "media_player.television", platform: "media_player", device_id: "fixture-tv", device_url: "/config/devices/device/fixture-tv" }, commands: {
        power: command,
        volume_up: { ...commandVariant("Volume up", "mdi:volume-plus", "volume_up"), analysis: staleAnalysis },
        volume_down: commandVariant("Volume down", "mdi:volume-minus", "volume_down"),
        mute: commandVariant("Mute", "mdi:volume-mute", "mute_toggle", false),
        input: commandVariant("Input", "mdi:video-input-hdmi", "source"),
      }},
      receiver: { name: "Receiver", appliance_type: "media_player", emitter_id: "demo", commands: {
        receiver_power: commandVariant("Power", "mdi:power", "power_toggle"),
        receiver_volume_up: commandVariant("Volume up", "mdi:volume-plus", "volume_up"),
        receiver_volume_down: commandVariant("Volume down", "mdi:volume-minus", "volume_down"),
      }},
    }},
    bedroom: { name: "Bedroom", appliances: {
      fan: { name: "Fan", appliance_type: "fan", emitter_id: "demo", commands: {
        fan_power: commandVariant("Power", "mdi:power", "power_toggle"),
        fan_speed: commandVariant("Speed", "mdi:fan", "speed"),
      }},
    }},
  },
};
const unassignedRegistry = {
  emitters: [{ key: "demo", name: "Demo emitter", entity_id: "infrared.demo", enabled: true, available: true, can_capture: true }],
  locations: { unsorted: { name: "Unsorted", appliances: { remote: { name: "Unsorted remote", appliance_type: "generic", emitter_id: "demo", home_assistant: { entity_id: "remote.unsorted_remote", platform: "remote", device_id: "fixture-remote", device_url: "/config/devices/device/fixture-remote" }, commands: { lamp_on: unassignedCommand } } } } },
};
const history = {
  current_revision: 4,
  revisions: [
    { revision: 1, action: "imported", created_at: "2000-01-01T00:00:00Z", snapshot: command, label: "Imported command" },
    { revision: 2, action: "captured", created_at: "2000-01-01T00:01:00Z", snapshot: command, label: "Original capture" },
    { revision: 3, action: "signal_lab", created_at: "2000-01-01T00:02:00Z", snapshot: command, label: "Trimmed trailing silence" },
    { revision: 4, action: "optimized", created_at: "2000-01-01T00:03:00Z", snapshot: command, label: "Optimized for a single press" },
  ],
};
const catalogProfile = {
  profile_id: "vizio_tv", name: "Vizio Common TV family", brand: "Vizio", model: "Common TV family",
  category: "tv", match: "remote_family", command_count: 4, verified: true,
  source_name: "Home Assistant infrared-protocols", source_license: "MIT",
  source: { name: "Home Assistant infrared-protocols", license: "MIT", version: "8.1.0" },
  commands: [
    { ...command, command_id: "power", name: "Power", selected: true },
    { ...commandVariant("Volume up", "mdi:volume-plus", "volume_up"), command_id: "volume_up", selected: true },
    { ...commandVariant("Volume down", "mdi:volume-minus", "volume_down"), command_id: "volume_down", selected: true },
    { ...commandVariant("Mute", "mdi:volume-mute", "mute_toggle"), command_id: "mute", selected: true },
  ],
  import_plan: { starter_command_ids: ["power", "volume_up", "volume_down", "mute"], all_command_ids: ["power", "volume_up", "volume_down", "mute"], conflict_count: 0, duplicate_count: 0, unsupported_count: 0 },
};
const catalogSummary = {
  profile_id: catalogProfile.profile_id, name: catalogProfile.name, brand: "Vizio", model: "Common TV family",
  category: "tv", match: "remote_family", command_count: 161, protocol: "NEC", verified: true,
  source_name: "Home Assistant infrared-protocols", source_license: "MIT",
};
const catalogMeta = { installed: true, version: "8.1.0", source: "Home Assistant infrared-protocols", license: "MIT" };
const candidate = { candidate_id: "demo-power", command: catalogProfile.commands[0], profile_id: catalogProfile.profile_id, profile_ids: [catalogProfile.profile_id], profile_names: [catalogProfile.name] };

const fixtureParams = new URLSearchParams(location.search);
const fixtureView = fixtureParams.get("view") || "library";
const fixtureTheme = fixtureParams.get("theme") || "dark";
if (fixtureTheme === "light") {
  const root = document.documentElement.style;
  root.colorScheme = "light";
  root.setProperty("--primary-background-color", "#f5f7fa");
  root.setProperty("--secondary-background-color", "#eef1f5");
  root.setProperty("--card-background-color", "#ffffff");
  root.setProperty("--primary-text-color", "#18212b");
  root.setProperty("--secondary-text-color", "#5f6b78");
  root.setProperty("--text-primary-color", "#07161a");
  root.setProperty("--divider-color", "#d5dbe2");
  root.setProperty("--primary-color", "#087f9d");
}
const calls = [];
const fixtureRegistry = fixtureView === "empty" ? { ...registry, locations: {} }
  : fixtureView === "offline" ? { ...registry, emitters: registry.emitters.map(item => ({ ...item, available: false })) }
  : fixtureView === "no-blaster" ? { ...registry, emitters: [] }
  : fixtureView === "multiple-blasters" ? { ...registry, emitters: [...registry.emitters, { key: "bedroom", name: "Bedroom emitter", entity_id: "infrared.bedroom", enabled: true, available: true, can_capture: true }] }
  : fixtureView === "library-unassigned" ? unassignedRegistry
  : registry;
const hass = {
  locale: { language: "en" },
  services: { imprint_refinery: { cancel_capture: {} } },
  states: {
    "sensor.imprint_refinery_status": { state: fixtureView === "offline" ? "unavailable" : fixtureView === "busy" ? "sending" : "idle" },
    "infrared.demo": { state: fixtureView === "offline" ? "unavailable" : "unknown" },
    "infrared.bedroom": { state: "unknown" },
  },
  callService: async (domain, service, data) => { calls.push({ transport: "service", domain, service, data }); return {}; },
  callWS: async message => {
    calls.push({ transport: "ws", ...message });
    const service = message.service || message.action;
    const data = message.service_data || message.data || {};
    if (service === "get_library") {
      if (fixtureView === "load-error") throw new Error("Fixture storage could not be read");
      if (fixtureView === "loading") return new Promise(() => {});
      return { response: fixtureRegistry };
    }
    if (service === "command_history") return { response: history };
    if (service === "capture_signal") {
      if (fixtureView === "learn-waiting") return new Promise(() => {});
      if (fixtureView === "learn-error") throw new Error("No IR code was received before the capture window ended");
      return { response: { code: command.code } };
    }
    if (service === "analyze_signal") {
      const learnedAnalysis = fixtureView === "learn-review" ? { ...analysis, fingerprints: { normalized_50us: "fixture-new-fingerprint", exact: "fixture-new-exact" } } : analysis;
      return { response: { format: command.format, code: command.code, signal, analysis: learnedAnalysis } };
    }
    if (service === "catalog_match_signal") return { response: { matches: [] } };
    if (service === "convert_signal") {
      if (data.name === "Power" && data.output_format === "pronto") await new Promise(resolve => setTimeout(resolve, 150));
      return { response: { value: convertedValues[data.output_format] || command.code, loss_report: { lossless: true } } };
    }
    if (service === "encode_signal") return { response: { code: command.code } };
    if (service === "rebuild_signal") return { response: { format: "raw_signed", code: command.code, signal, analysis, rebuild: analysis.protocol_rebuilds[0] } };
    if (service === "catalog_search") return { response: { catalog: catalogMeta, profiles: [catalogSummary] } };
    if (service === "catalog_profile") return { response: catalogProfile };
    if (service === "catalog_guided_candidates") return { response: { catalog: catalogMeta, candidates: [candidate] } };
    if (service === "catalog_guided_start") return { response: { session: { session_id: "fixture-guided", status: "active", pending_test: false, candidates: [candidate], progress: { position: 1, total: 1 }, current_candidate: candidate, prompt: "Power" } } };
    if (service === "catalog_guided_test") return { response: { session: { session_id: "fixture-guided", status: "active", pending_test: true, candidates: [candidate], progress: { position: 1, total: 1 }, current_candidate: candidate, prompt: "Power" } } };
    if (service === "catalog_guided_answer") return { response: { session: { session_id: "fixture-guided", status: "completed", pause_reason: "worked", pending_test: false, candidates: [{ ...candidate, confirmed: true }], progress: { position: 1, total: 1 }, current_candidate: candidate, confirmed_candidate: candidate } } };
    return { response: {} };
  },
};

await customElements.whenDefined("imprint-refinery-card");
const preview = document.getElementById("preview");
const mountComponent = async (tag, properties) => {
  preview.className = "fixture-shell";
  preview.innerHTML = '<div class="fixture-title">Imprint Refinery</div>';
  const element = document.createElement(tag);
  Object.assign(element, properties);
  preview.append(element);
  await element.updateComplete;
  return element;
};
const lab = {
  locId: "living_room", applianceId: "television", cmdId: "power", sourceName: "Power", sourceRevision: 4,
  original: [...timings], timings: timings.map((value, index) => index === 5 ? value + 30 : value),
  carrierFrequency: 38000, originalCarrierFrequency: 38000, carrierSource: "assumed",
  sourceAnalysis: analysis, draftAnalysis: analysis, analysisPending: false, undo: [], redo: [],
  selected: 5, selectionStart: 4, selectionEnd: 5, selectedFrame: 0, frameRoles: ["intro", "repeat"], originalFrameRoles: ["intro", "repeat"],
  zoom: 1, pan: 0, cursors: [8000, 13000], activeCursor: 0, view: fixtureView === "lab-compare" ? "compare" : "edit",
  snap: 10, boundaryMode: "shift", dirty: true, saveName: "Power experiment", saveId: "power_experiment", idTouched: false,
};
const repeatedTimings = Array.from({ length: 23 }, () => [9000, 4500, 560, 560, 560, 1690, 560, 560, 560, 1690, 560, 560, 560, 40000]).flat();
const repeatedAnalysis = {
  ...analysis,
  pulse_count: repeatedTimings.length,
  total_duration_us: repeatedTimings.reduce((sum, value) => sum + value, 0),
  frame_count: 23,
  repeated_frame_count: 22,
  frames: Array.from({ length: 23 }, (_unused, index) => ({ start: index * 14, end: index * 14 + 13, duration_us: 64000, group: "fixture-repeat" })),
  frame_roles: Array.from({ length: 23 }, (_unused, index) => ({ frame: index, role: index ? "repeat" : "intro" })),
  single_press_candidate: { timings: repeatedTimings.slice(0, 14), kept_frames: 1, removed_frames: 22, warning: "The protocol is not conclusive; test the one-press preview before saving." },
};
const inferredBinaryAnalysis = {
  ...analysis,
  protocol: undefined,
  confidence: "unknown",
  evidence_class: "unknown",
  protocol_candidates: [],
  binary_payload: { value: "01011010", bit_count: 8, display_order: "transmission", bit_order: "unknown", encoding: "pulse_distance", symbol: "space_length", zero_us: 400, one_us: 1200, evidence: "distance_width_model", confidence_score: 70, agreement_count: 1, method_count: 1, evidence_family_count: 1 },
  binary_decoders: {
    strategy: "duration_bin_template_match", selected_mode: "pulse_distance",
    results: [
      { mode: "pulse_distance", status: "matched", fit: 1, payload: { value: "01011010", bit_count: 8, display_order: "transmission", bit_order: "unknown", encoding: "pulse_distance", symbol: "space_length", zero_us: 400, one_us: 1200, evidence: "distance_width_model" } },
      { mode: "pulse_width", status: "rejected", reason: "requires_two_mark_classes_and_one_space_class" },
    ],
    protocol_results: [], votes: [{ method: "pulse_distance", family: "waveform_model", value: "01011010", fit: 1 }],
    auto: { status: "matched", confidence_score: 70, agreement_count: 1, method_count: 1, evidence_family_count: 1, selected_value: "01011010" },
  },
};

const importPreview = {
  format: "flipper",
  scope: "appliance",
  commands: [
    { command_id: "power", name: "Power", code: command.code, compatible: true, loss_report: { lossless: true } },
    { command_id: "volume_up", name: "Volume up", code: command.code, compatible: true, loss_report: { lossless: false } },
    { command_id: "unsupported", name: "Bluetooth pairing", compatible: false },
  ],
  unsupported_count: 1,
  loss_report: { lossless: false, warnings: ["One imported representation omits carrier metadata."] },
};

if (["catalog", "catalog-empty", "guided", "guided-paused", "confirm", "profile", "catalog-choices", "catalog-import", "catalog-import-preview", "catalog-error"].includes(fixtureView)) {
  const catalogState = fixtureView === "catalog" ? { mode: "find", category: "tv", brand: "Vizio", searched: true, results: [catalogSummary], catalog: catalogMeta }
    : fixtureView === "catalog-empty" ? { mode: "find", category: "tv", brand: "Missing brand", searched: true, results: [], catalog: catalogMeta }
    : fixtureView === "profile" ? { mode: "find", selectedProfile: catalogProfile, catalog: catalogMeta }
    : fixtureView === "guided" ? { mode: "match", category: "tv", brand: "Vizio TV", catalog: catalogMeta, candidates: [candidate], guidedSession: { session_id: "fixture-session", status: "active", pending_test: true, candidates: [candidate], progress: { position: 1, total: 1 }, current_candidate: candidate, prompt: "Power", instruction: "We’ll send one Power command. If the appliance responds, stop here and tell us it worked." } }
    : fixtureView === "guided-paused" ? { mode: "match", category: "tv", brand: "Vizio TV", catalog: catalogMeta, candidates: [candidate], guidedSession: { session_id: "fixture-session", status: "paused", pending_test: false, candidates: [candidate], progress: { position: 1, total: 3 }, current_candidate: candidate, prompt: "Power", instruction: "Testing is paused. Resume when the appliance is ready." } }
    : fixtureView === "confirm" ? { mode: "match", category: "tv", brand: "Vizio TV", catalog: catalogMeta, candidates: [{ ...candidate, confirmed: true }], guidedSession: { session_id: "fixture-session", status: "completed", pause_reason: "worked", candidates: [{ ...candidate, confirmed: true }], progress: { position: 1, total: 1 }, current_candidate: candidate } }
    : fixtureView === "catalog-import-preview" ? { mode: "import", catalog: catalogMeta, preview: importPreview, unsupportedCommands: [{ name: "Bluetooth pairing", source: "Fixture remote", error: "Bluetooth commands cannot be represented as IR." }], lossReport: importPreview.loss_report }
    : fixtureView === "catalog-error" ? { mode: "find", catalog: catalogMeta, error: "The local catalog could not be opened. Reinstall the integration to restore it." }
    : fixtureView === "catalog-import" ? { mode: "import", catalog: catalogMeta }
    : { mode: "choices", catalog: catalogMeta };
  await mountComponent("imprint-catalog-guided", { catalog: catalogState, registry, emitterName: "Living room emitter", importTargetKey: "living_room||television" });
} else if (["learn-preparing", "learn-duplicate", "learn-optimized"].includes(fixtureView)) {
  const step = fixtureView.replace("learn-", "");
  const learn = { seq: 1, step: step === "preparing" ? "preparing" : "review", locationId: "living_room", applianceId: "television", commandId: "", name: "Power", role: "power_toggle", targetKey: "living_room||television", newApplianceName: "", code: command.code, preview: { format: command.format, code: command.code, signal, analysis }, catalogMatches: [], deadline: Date.now() + 18000,
    ...(fixtureView === "learn-duplicate" ? { duplicateMatch: { locId: "living_room", applianceId: "television", cmdId: "power", commandName: "Power", applianceName: "Television" } } : {}),
    ...(fixtureView === "learn-optimized" ? { optimized: true, originalCode: command.code, originalPreview: { format: command.format, code: command.code, signal, analysis } } : {}),
  };
  await mountComponent("imprint-learn-flow", { learn, registry, remaining: 18, emitterName: "Living room emitter", emitterReady: true });
} else if (["lab", "lab-decoded", "lab-inferred-binary", "lab-compare", "lab-code", "lab-custom", "lab-invalid", "lab-offline", "lab-preview", "lab-leave", "lab-repeats", "lab-rebuildable-sirc"].includes(fixtureView)) {
  const fixtureLab = {
    ...lab,
    ...(fixtureView === "lab-code" ? { original: timings.slice(0, -1), timings: timings.slice(0, -1), dirty: false } : {}),
    ...(fixtureView === "lab-repeats" ? { original: [...repeatedTimings], timings: [...repeatedTimings], sourceAnalysis: repeatedAnalysis, draftAnalysis: repeatedAnalysis, frameRoles: ["intro", ...Array(22).fill("repeat")], originalFrameRoles: ["intro", ...Array(22).fill("repeat")], dirty: false, selected: 0, selectionStart: 0, selectionEnd: 0, cursors: [0, repeatedTimings.reduce((sum, value) => sum + value, 0)] } : {}),
    ...(fixtureView === "lab-inferred-binary" ? { sourceAnalysis: inferredBinaryAnalysis, draftAnalysis: inferredBinaryAnalysis, dirty: false } : {}),
    ...(fixtureView === "lab-rebuildable-sirc" ? { original: [...sircFrame], timings: [...sircFrame], carrierFrequency: 38000, originalCarrierFrequency: 38000, sourceAnalysis: sircAnalysis, draftAnalysis: sircAnalysis, dirty: false, selected: 0, selectionStart: 0, selectionEnd: 0, frameRoles: ["intro"], originalFrameRoles: ["intro"], cursors: [0, 45000] } : {}),
    ...(fixtureView === "lab-custom" ? { custom: true, locId: "unsorted", applianceId: "remote", cmdId: "", sourceName: "New custom signal", sourceRevision: 0, saveName: "", saveId: "", dirty: false } : {}),
    ...(fixtureView === "lab-invalid" ? { timings: [9000, 0, 560], draftAnalysis: { evidence_class: "unknown", warnings: ["odd_timing_count"] } } : {}),
    ...(fixtureView === "lab-preview" ? { preview: { kind: "Round timings", timings: timings.map(value => Math.round(value / 100) * 100), changed: 12, durationDelta: 80, maxTimingError: 40, frameDelta: 0, roundTripChanges: 0, evidenceClass: "pattern_only", protocol: "NEC", compatible: true, warning: "Review timing drift before applying this transform." } } : {}),
    ...(fixtureView === "lab-leave" ? { leavePrompt: true } : {}),
  };
  const labElement = await mountComponent("imprint-signal-lab", { lab: fixtureLab, registry, emitterName: "Living room emitter", emitterReady: fixtureView !== "lab-offline", offlineReason: fixtureView === "lab-offline" ? "The selected emitter is unavailable; editing and export remain available." : "", now: Date.now() });
  labElement.addEventListener("lab-action", event => {
    const detail = event.detail || {};
    if (detail.action === "ui") labElement.lab = { ...labElement.lab, ...(detail.patch || {}) };
    if (detail.action === "zoom") labElement.lab = { ...labElement.lab, zoom: Number(detail.zoom), ...(detail.pan == null ? {} : { pan: Number(detail.pan) }) };
    if (detail.action === "view") labElement.lab = { ...labElement.lab, view: detail.view };
    if (detail.action === "rebuild-preview") {
      const isSirc = detail.rebuildId === "fixture-sirc-rebuild";
      const rebuilt = isSirc ? sircCanonical : timings;
      const protocol = isSirc ? "SIRC" : "NEC";
      labElement.lab = { ...labElement.lab, preview: { kind: `Rebuild as ${protocol}`, timings: [...rebuilt], changed: Math.abs(rebuilt.length - labElement.lab.timings.length) + rebuilt.slice(0, labElement.lab.timings.length).filter((value, index) => value !== labElement.lab.timings[index]).length, durationDelta: rebuilt.reduce((sum, value) => sum + value, 0) - labElement.lab.timings.reduce((sum, value) => sum + value, 0), maxTimingError: 0, frameDelta: isSirc ? 2 : 0, roundTripChanges: 0, evidenceClass: "likely", protocol, compatible: true, carrierFrequency: isSirc ? 40000 : 38000, frameRoles: isSirc ? ["intro", "repeat", "repeat"] : ["intro", "repeat"], description: `Decoded fields were re-encoded with the ${protocol} protocol definition.`, timingBasis: `${protocol} protocol definition`, applyLabel: `Apply ${protocol} rebuild` } };
    }
    if (detail.action === "preview-apply" && Array.isArray(detail.timings)) labElement.lab = { ...labElement.lab, timings: [...detail.timings], carrierFrequency: Number(detail.carrierFrequency || labElement.lab.carrierFrequency), frameRoles: [...(detail.frameRoles || labElement.lab.frameRoles)], preview: undefined, dirty: true };
    if (detail.action === "preview-cancel") labElement.lab = { ...labElement.lab, preview: undefined };
    if (detail.action === "code-representation") {
      const trailingSpace = detail.timings.length % 2 && ["pronto", "girr"].includes(detail.format) ? detail.timings.at(-1) : 0;
      labElement.lab = { ...labElement.lab, codeRepresentation: { key: detail.key, format: detail.format, value: convertedValues[detail.format] || command.code, loading: false, lossReport: trailingSpace ? { lossless: false, losses: ["trailing_space_added"], trailing_space_added_us: trailingSpace, trailing_space_source: "matched_final_mark" } : { lossless: true } } };
    }
  });
  if (fixtureView === "lab-code") {
    labElement.shadowRoot.querySelector('[role="tab"]:last-of-type')?.click();
    await labElement.updateComplete;
  }
  if (["lab-decoded", "lab-inferred-binary"].includes(fixtureView)) {
    labElement.shadowRoot.querySelector('[role="tab"]:first-of-type')?.click();
    await labElement.updateComplete;
  }
} else if (["inspector", "inspector-signal", "inspector-single-frame", "inspector-code", "inspector-history", "inspector-malformed", "inspector-offline", "inspector-ambiguous"].includes(fixtureView)) {
  const tab = ["inspector-signal", "inspector-single-frame"].includes(fixtureView) ? "signal" : fixtureView === "inspector-code" ? "code" : fixtureView === "inspector-history" ? "history" : "overview";
  const singleFrameRegistry = {
    ...registry,
    locations: {
      ...registry.locations,
      living_room: {
        ...registry.locations.living_room,
        appliances: {
          ...registry.locations.living_room.appliances,
          television: {
            ...registry.locations.living_room.appliances.television,
            commands: { ...registry.locations.living_room.appliances.television.commands, power: singleFrameCommand },
          },
        },
      },
    },
  };
  const inspectorRegistry = fixtureView === "inspector-malformed" ? { ...registry, locations: { ...registry.locations, living_room: { ...registry.locations.living_room, appliances: { ...registry.locations.living_room.appliances, television: { ...registry.locations.living_room.appliances.television, commands: { ...registry.locations.living_room.appliances.television.commands, power: { ...command, code: "", signal: undefined, analysis: { evidence_class: "unknown", warnings: ["malformed_payload"] } } } } } } } } : fixtureView === "inspector-offline" ? { ...registry, emitters: registry.emitters.map(item => ({ ...item, available: false })) } : fixtureView === "inspector-ambiguous" ? unassignedRegistry : fixtureView === "inspector-single-frame" ? singleFrameRegistry : registry;
  const ambiguous = fixtureView === "inspector-ambiguous";
  await mountComponent("imprint-library-inspector", { registry: inspectorRegistry, selectedEmitter: "demo", selectedLocation: ambiguous ? "unsorted" : "living_room", selectedAppliance: ambiguous ? "remote" : "television", status: fixtureView === "inspector-offline" ? "unavailable" : "idle", inspector: { locId: ambiguous ? "unsorted" : "living_room", applianceId: ambiguous ? "remote" : "television", cmdId: ambiguous ? "lamp_on" : "power", tab: fixtureView === "inspector-malformed" ? "code" : tab, history, representation: command.format, representations: fixtureView === "inspector-malformed" ? {} : { [command.format]: command.code }, zoom: 1 } });
} else {
  const card = document.createElement("imprint-refinery-card");
  card.setConfig({ title: "Imprint Refinery", workspace: true, timeout: 60 });
  card.hass = hass;
  preview.append(card);
  await card.updateComplete;
  if (["learn-waiting", "learn-review", "learn-error"].includes(fixtureView)) {
    await new Promise(resolve => setTimeout(resolve, 0));
    const workspace = card.shadowRoot?.querySelector("imprint-library-inspector");
    workspace?.dispatchEvent(new CustomEvent("learn-request", { bubbles: true, composed: true }));
    await new Promise(resolve => setTimeout(resolve, fixtureView === "learn-review" ? 80 : 20));
    await card.updateComplete;
  }
  if (fixtureView === "no-results") {
    await new Promise(resolve => setTimeout(resolve, 20));
    const workspace = card.shadowRoot?.querySelector("imprint-library-inspector");
    const browser = workspace?.shadowRoot?.querySelector("imprint-library-browser");
    const search = browser?.shadowRoot?.querySelector('input[type="search"]');
    if (search) {
      search.value = "definitely-not-a-saved-command";
      search.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await browser.updateComplete;
    }
  }
  if (fixtureView.startsWith("dialog-")) {
    await new Promise(resolve => setTimeout(resolve, 30));
    const workspace = card.shadowRoot?.querySelector("imprint-library-inspector");
    const browser = workspace?.shadowRoot?.querySelector("imprint-library-browser");
    const commandRef = { locId: "living_room", applianceId: "television", cmdId: "power" };
    if (fixtureView === "dialog-locations") workspace?.dispatchEvent(new CustomEvent("location-add", { bubbles: true, composed: true }));
    if (fixtureView === "dialog-add-appliance") workspace?.dispatchEvent(new CustomEvent("appliance-create", { detail: {}, bubbles: true, composed: true }));
    if (fixtureView === "dialog-rename-command") workspace?.dispatchEvent(new CustomEvent("command-rename", { detail: commandRef, bubbles: true, composed: true }));
    if (fixtureView === "dialog-delete-command") workspace?.dispatchEvent(new CustomEvent("command-delete", { detail: commandRef, bubbles: true, composed: true }));
    if (fixtureView === "dialog-delete-appliance") workspace?.dispatchEvent(new CustomEvent("appliance-delete", { detail: { locId: "living_room", applianceId: "television", commandCount: 5, name: "Television" }, bubbles: true, composed: true }));
    if (fixtureView === "dialog-revision-restore") workspace?.dispatchEvent(new CustomEvent("revision-restore", { detail: { revision: 1 }, bubbles: true, composed: true }));
    const browserAction = (menuLabel, actionLabel) => {
      const menu = [...(browser?.shadowRoot?.querySelectorAll("summary") || [])].find(item => item.getAttribute("aria-label") === menuLabel);
      menu?.click();
      const action = [...(browser?.shadowRoot?.querySelectorAll("button") || [])].find(item => item.textContent?.trim() === actionLabel);
      action?.click();
    };
    if (fixtureView === "dialog-command-move") browserAction("Actions for Power", "Move");
    if (fixtureView === "dialog-command-duplicate") browserAction("Actions for Power", "Duplicate");
    if (fixtureView === "dialog-command-role") browserAction("Actions for Power", "Edit role");
    if (fixtureView === "dialog-command-icon") browserAction("Actions for Power", "Choose icon");
    if (fixtureView === "dialog-device-move") browserAction("Actions for Television", "Move or change location");
    if (fixtureView === "dialog-device-settings") browserAction("Actions for Television", "Entity settings");
    await card.updateComplete;
  }
}

document.documentElement.dataset.fixtureReady = "true";
window.__IMPRINT_REFINERY_FIXTURES__ = { command, registry, unassignedRegistry, history, catalogProfile, catalogSummary, candidate, timings, analysis, signal, hass, calls, view: fixtureView, theme: fixtureTheme };
