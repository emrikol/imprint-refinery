// Synthetic NEC-like data for browser tests. This is not a captured device signal.
const timings = [
  9000, 4500, 560, 560, 560, 1690, 560, 560, 560, 1690, 560, 560, 560, 40000,
  9000, 4500, 560, 560, 560, 1690, 560, 560, 560, 1690, 560, 560, 560, 40000,
];
const binaryPayload = {
  value: "00001000111101110000010011111011",
  bit_count: 32,
  display_order: "transmission",
  bit_order: "lsb_first",
  encoding: "pulse_distance",
  symbol: "space_length",
  zero_us: 560,
  one_us: 1690,
  evidence: "distance_width_model_and_recognized_protocol",
  confidence_score: 100,
  agreement_count: 4,
  method_count: 4,
  evidence_family_count: 2,
};
const binaryDecoders = {
  strategy: "duration_bin_template_match",
  selected_mode: "pulse_distance",
  results: [
    {
      mode: "pulse_distance",
      status: "matched",
      fit: 1,
      payload: {
        ...binaryPayload,
        bit_order: "unknown",
        evidence: "distance_width_model",
        confidence_score: undefined,
        agreement_count: undefined,
        method_count: undefined,
      },
    },
    {
      mode: "pulse_width",
      status: "rejected",
      reason: "requires_two_mark_classes_and_one_space_class",
    },
  ],
  protocol_results: [
    { protocol: "NEC", payload: binaryPayload },
    { protocol: "NEC", payload: binaryPayload },
    { protocol: "NEC1-f16", payload: binaryPayload },
  ],
  votes: [
    {
      method: "pulse_distance",
      family: "waveform_model",
      value: binaryPayload.value,
      fit: 1,
    },
    {
      method: "protocol:NEC",
      family: "named_protocol",
      value: binaryPayload.value,
    },
    {
      method: "protocol:NEC",
      family: "named_protocol",
      value: binaryPayload.value,
    },
    {
      method: "protocol:NEC1-f16",
      family: "named_protocol",
      value: binaryPayload.value,
    },
  ],
  auto: {
    status: "matched",
    confidence_score: 100,
    agreement_count: 4,
    method_count: 4,
    evidence_family_count: 2,
    selected_value: binaryPayload.value,
  },
};
const analysis = {
  analyzer: "generic_structure",
  confidence: "likely",
  evidence_class: "likely",
  protocol: "NEC",
  pulse_count: timings.length,
  total_duration_us: timings.reduce((a, b) => a + b, 0),
  frame_count: 2,
  unique_frame_count: 1,
  repeated_frame_count: 1,
  repeat_count: 1,
  required_repeats: 0,
  minimum_frame_count: 1,
  repeat_requirement_met: true,
  repeat_style: "full_frame_repeat",
  warnings: ["repeated_pattern_unknown_protocol"],
  frames: [
    { start: 0, end: 13, duration_us: 64000 },
    { start: 14, end: 27, duration_us: 64000 },
  ],
  frame_roles: [
    { frame: 0, role: "intro" },
    { frame: 1, role: "repeat" },
  ],
  binary_payload: binaryPayload,
  binary_decoders: binaryDecoders,
  protocol_candidates: [
    {
      protocol: "NEC",
      evidence_class: "likely",
      score: 0.84,
      address: 16,
      command: 12,
      bits: 32,
      binary_payload: binaryPayload,
    },
    {
      protocol: "NEC",
      evidence_class: "likely",
      score: 0.81,
      address: 65280,
      command: 12,
      bits: 32,
      binary_payload: binaryPayload,
    },
    {
      protocol: "NEC1-f16",
      evidence_class: "likely",
      score: 0.79,
      address: 65280,
      command: 12,
      bits: 32,
      binary_payload: binaryPayload,
    },
  ],
  protocol_rebuilds: [
    {
      id: "fixture-nec-rebuild",
      candidate_id: "fixture-nec",
      protocol: "NEC",
      evidence_class: "likely",
      carrier_frequency: 38000,
      carrier_changed: false,
      timing_count: timings.length,
      changed_timings: 2,
      duration_delta_us: -30,
      address: 16,
      command: 12,
      bits: 32,
    },
  ],
  fingerprints: {
    normalized_50us: "fixture-normalized-fingerprint",
    exact: "fixture-exact-fingerprint",
  },
  single_press_candidate: {
    timings: timings.slice(0, 14),
    kept_frames: 1,
    removed_frames: 1,
  },
};
const signal = { carrier_frequency: 38000, carrier_source: "assumed", timings };
const sircFrame = [
  2400,
  ...Array.from({ length: 12 }, () => [600, 600]).flat(),
  28200,
];
const sircCanonical = [...sircFrame, ...sircFrame, ...sircFrame];
const sircAnalysis = {
  analyzer: "generic_structure",
  confidence: "likely",
  evidence_class: "likely",
  protocol: "SIRC",
  pulse_count: sircFrame.length,
  total_duration_us: 45000,
  frame_count: 1,
  repeated_frame_count: 0,
  repeat_count: 0,
  required_repeats: 2,
  minimum_frame_count: 3,
  repeat_requirement_met: false,
  repeat_style: "none",
  warnings: [],
  frames: [{ start: 0, end: sircFrame.length, duration_us: 45000 }],
  protocol_candidates: [
    {
      protocol: "SIRC",
      evidence_class: "likely",
      address: 0,
      command: 0,
      bits: 12,
      reconstructable: true,
      rebuild_id: "fixture-sirc-rebuild",
    },
  ],
  protocol_rebuilds: [
    {
      id: "fixture-sirc-rebuild",
      candidate_id: "fixture-sirc",
      protocol: "SIRC",
      evidence_class: "likely",
      carrier_frequency: 40000,
      carrier_changed: true,
      timing_count: sircCanonical.length,
      changed_timings: sircCanonical.length - sircFrame.length,
      duration_delta_us: 90000,
      address: 0,
      command: 0,
      bits: 12,
    },
  ],
};
const command = {
  name: "Power",
  code: "CygjlBEwAjACMAKaBg==",
  format: "zosung_base64",
  icon: "mdi:power",
  role: "power_toggle",
  current_revision: 4,
  revision_count: 4,
  signal,
  analysis,
  source: { name: "Learned locally" },
};
const convertedValues = {
  pronto:
    "0000 006D 0022 0000 0156 00AB 0015 0015 0015 0040 0015 0015 0015 0040",
  girr: '<girr:remote xmlns:girr="http://www.harctoolbox.org/Girr"><girr:command name="Power experiment"><girr:raw frequency="38000"><girr:intro>9000 4500 560 560 560 1690</girr:intro></girr:raw></girr:command></girr:remote>',
  lirc: "begin remote\n  name imprint_refinery\n  flags RAW_CODES\n  eps 30\n  aeps 100\n  frequency 38000\n  begin raw_codes\n    name Power_experiment\n      9000 4500 560 560 560 1690\n  end raw_codes\nend remote",
  flipper:
    "Filetype: IR signals file\nVersion: 1\n#\nname: Power_experiment\ntype: raw\nfrequency: 38000\nduty_cycle: 0.330000\ndata: 9000 4500 560 560 560 1690",
  raw_signed: "+9000 -4500 +560 -560 +560 -1690",
  raw_unsigned: "9000 4500 560 560 560 1690",
};
const commandVariant = (name, icon, role) => ({
  ...command,
  name,
  icon,
  role,
  current_revision: 1,
  revision_count: 1,
});
const workspaceRegistry = {
  remote_profiles: {
    silkycasters_rgbw: {
      name: "Silkycasters RGBW",
      appliance_type: "light",
      dependent_appliance_ids: ["living_room_sconce_1", "living_room_sconce_2"],
      commands: {
        power: command,
        warm_white: commandVariant("Warm white", "mdi:palette", "custom"),
        blue: commandVariant("Blue", "mdi:palette", "custom"),
        timer_1h: commandVariant("Timer: 1h", "mdi:timer-outline", "custom"),
      },
    },
    television_remote: {
      name: "Example television remote",
      appliance_type: "media_player",
      dependent_appliance_ids: ["living_room_tv"],
      commands: {
        power: command,
        volume_up: commandVariant("Volume up", "mdi:volume-plus", "volume_up"),
        volume_down: commandVariant(
          "Volume down",
          "mdi:volume-minus",
          "volume_down",
        ),
      },
    },
    spare_remote: {
      name: "Spare remote",
      appliance_type: "generic",
      dependent_appliance_ids: [],
      commands: {},
    },
  },
  appliances: {
    living_room_sconce_1: {
      name: "Sconce 1",
      remote_profile_id: "silkycasters_rgbw",
      infrared_emitter_ref: "fixture-emitter-one",
      preferred_platform: "remote",
      route_status: "ready",
      area: { area_id: "living-room", name: "Living room" },
      home_assistant: {
        entity_id: "remote.sconce_1",
        available: true,
        platform: "remote",
        device_id: "fixture-sconce-1",
        device_url: "/config/devices/device/fixture-sconce-1",
      },
    },
    living_room_sconce_2: {
      name: "Sconce 2",
      remote_profile_id: "silkycasters_rgbw",
      infrared_emitter_ref: "fixture-emitter-two",
      preferred_platform: "remote",
      route_status: "unavailable",
      area: { area_id: "living-room", name: "Living room" },
      home_assistant: {
        entity_id: "remote.sconce_2",
        available: true,
        platform: "remote",
        device_id: "fixture-sconce-2",
        device_url: "/config/devices/device/fixture-sconce-2",
      },
    },
    living_room_tv: {
      name: "Television",
      remote_profile_id: "television_remote",
      infrared_emitter_ref: "fixture-emitter-one",
      preferred_platform: "media_player",
      route_status: "ready",
      area: { area_id: "living-room", name: "Living room" },
      home_assistant: {
        entity_id: "media_player.television",
        available: false,
        platform: "media_player",
        device_id: "fixture-tv",
        device_url: "/config/devices/device/fixture-tv",
      },
    },
  },
  infrared_hardware: {
    compatibility_adapter_available: false,
    emitters: [
      {
        ref: "fixture-emitter-one",
        entity_id: "infrared.living_room",
        name: "Living room IR",
        available: true,
        last_activity: "2000-01-01T00:00:00Z",
        platform: "imprint_refinery",
        compatibility_adapter: true,
        device_id: "fixture-ir-1",
        device_name: "Living room IR hardware",
        device_url: "/config/devices/device/fixture-ir-1",
        entity_url: "/config/entities/entity/fixture-emitter-one",
        area_name: "Living room",
      },
      {
        ref: "fixture-emitter-two",
        entity_id: "infrared.bedroom",
        name: "Bedroom IR",
        available: false,
        last_activity: null,
        platform: "esphome",
        compatibility_adapter: false,
        device_id: "fixture-ir-2",
        device_name: "Bedroom IR hardware",
        device_url: "/config/devices/device/fixture-ir-2",
        entity_url: "/config/entities/entity/fixture-emitter-two",
        area_name: "Bedroom",
      },
    ],
    receivers: [
      {
        ref: "fixture-receiver-one",
        entity_id: "infrared.living_room_receiver",
        name: "Living room receiver",
        available: true,
        last_activity: null,
        platform: "imprint_refinery",
        compatibility_adapter: true,
        device_id: "fixture-ir-1",
        device_name: "Living room IR hardware",
        device_url: "/config/devices/device/fixture-ir-1",
        entity_url: "/config/entities/entity/fixture-receiver-one",
        area_name: "Living room",
      },
      {
        ref: "fixture-receiver-two",
        entity_id: "infrared.bedroom_receiver",
        name: "Bedroom receiver",
        available: true,
        last_activity: null,
        platform: "esphome",
        compatibility_adapter: false,
        device_id: "fixture-ir-2",
        device_name: "Bedroom IR hardware",
        device_url: "/config/devices/device/fixture-ir-2",
        entity_url: "/config/entities/entity/fixture-receiver-two",
        area_name: "Bedroom",
      },
    ],
  },
  areas: [
    { area_id: "living-room", name: "Living room" },
    { area_id: "bedroom", name: "Bedroom" },
  ],
};
const history = {
  current_revision: 4,
  revisions: [
    {
      revision: 1,
      action: "imported",
      parent_revision: null,
      created_at: "2000-01-01T00:00:00Z",
      snapshot: command,
      label: "Imported command",
    },
    {
      revision: 2,
      action: "captured",
      parent_revision: 1,
      created_at: "2000-01-01T00:01:00Z",
      snapshot: command,
      label: "Original capture",
    },
    {
      revision: 3,
      action: "signal_lab",
      parent_revision: 2,
      created_at: "2000-01-01T00:02:00Z",
      snapshot: command,
      label: "Trimmed trailing silence",
    },
    {
      revision: 4,
      action: "optimized",
      parent_revision: 3,
      created_at: "2000-01-01T00:03:00Z",
      snapshot: command,
      label: "Optimized for a single press",
    },
  ],
};
const catalogProfile = {
  profile_id: "vizio_tv",
  name: "Vizio Common TV family",
  brand: "Vizio",
  model: "Common TV family",
  category: "tv",
  match: "remote_family",
  command_count: 5,
  verified: true,
  source_name: "Home Assistant infrared-protocols",
  source_license: "MIT",
  source: {
    name: "Home Assistant infrared-protocols",
    license: "MIT",
    version: "8.1.0",
  },
  commands: [
    {
      ...command,
      command_id: "power",
      name: "Power",
      source: {
        type: "catalog",
        source_path: "TVs/Vizio/Common.ir",
        original_name: "Power",
      },
      import: {
        starter: true,
        target_conflict: null,
        duplicates: [
          {
            remote_profile_id: "television_remote",
            command_id: "power",
            match_basis: "normalized_50us",
          },
        ],
        provenance: {
          type: "catalog",
          source_path: "TVs/Vizio/Common.ir",
          original_name: "Power",
        },
      },
    },
    {
      ...commandVariant("Volume up", "mdi:volume-plus", "volume_up"),
      command_id: "volume_up",
      import: {
        starter: true,
        target_conflict: null,
        duplicates: [],
        provenance: {
          type: "catalog",
          source_path: "TVs/Vizio/Common.ir",
          original_name: "Volume_up",
        },
      },
    },
    {
      ...commandVariant("Volume down", "mdi:volume-minus", "volume_down"),
      command_id: "volume_down",
      import: {
        starter: true,
        target_conflict: null,
        duplicates: [],
        provenance: {
          type: "catalog",
          source_path: "TVs/Vizio/Common.ir",
          original_name: "Volume_down",
        },
      },
    },
    {
      ...commandVariant("Mute", "mdi:volume-mute", "mute_toggle"),
      command_id: "mute",
      import: {
        starter: true,
        target_conflict: null,
        duplicates: [],
        provenance: {
          type: "catalog",
          source_path: "TVs/Vizio/Common.ir",
          original_name: "Mute",
        },
      },
    },
    {
      ...commandVariant("Input", "mdi:video-input-hdmi", ""),
      command_id: "input",
      import: {
        starter: false,
        target_conflict: null,
        duplicates: [],
        provenance: {
          type: "catalog",
          source_path: "TVs/Vizio/Common.ir",
          original_name: "Input",
        },
      },
    },
  ],
  unsupported_commands: [
    {
      name: "Service menu",
      error: "Unsupported parsed protocol",
      provenance: { source_path: "TVs/Vizio/Common.ir" },
    },
  ],
  import_plan: {
    starter_command_ids: ["power", "volume_up", "volume_down", "mute"],
    all_command_ids: ["power", "volume_up", "volume_down", "mute", "input"],
    conflict_count: 0,
    duplicate_count: 1,
    unsupported_count: 1,
    provenance: {
      name: "Home Assistant infrared-protocols",
      license: "MIT",
      version: "8.1.0",
      path: "TVs/Vizio/Common.ir",
    },
  },
};
const catalogSummary = {
  profile_id: catalogProfile.profile_id,
  name: catalogProfile.name,
  brand: "Vizio",
  model: "Common TV family",
  category: "tv",
  match: "remote_family",
  command_count: 161,
  protocol: "NEC",
  verified: true,
  source_name: "Home Assistant infrared-protocols",
  source_license: "MIT",
};
const catalogMeta = {
  installed: true,
  version: "8.1.0",
  source: "Home Assistant infrared-protocols",
  license: "MIT",
};
const candidate = {
  candidate_id: "demo-power",
  command: catalogProfile.commands[0],
  profile_id: catalogProfile.profile_id,
  profile_ids: [catalogProfile.profile_id],
  profile_names: [catalogProfile.name],
};

const fixtureParams = new URLSearchParams(location.search);
const fixtureView = fixtureParams.get("view") || "library";
const fixtureTheme = fixtureParams.get("theme") || "dark";
const fixtureHostWidth = Number(fixtureParams.get("hostWidth") || 0);
const fixtureTextScale = Number(fixtureParams.get("textScale") || 1);
const fixturePresentation = fixtureParams.get("presentation") || "panel";
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
  root.setProperty("--success-color", "#18794e");
  root.setProperty("--warning-color", "#8a5a00");
  root.setProperty("--error-color", "#c62828");
  root.setProperty("--disabled-color", "#687483");
}
if (Number.isFinite(fixtureTextScale) && fixtureTextScale > 0) {
  document.documentElement.style.fontSize = `${fixtureTextScale * 100}%`;
}
const calls = [];
const fixtureRegistry =
  fixtureView === "empty"
    ? { ...workspaceRegistry, remote_profiles: {}, appliances: {} }
    : fixtureView === "unconfigured-appliance"
      ? {
          ...workspaceRegistry,
          appliances: {
            unconfigured_appliance: {
              name: "Unconfigured appliance",
              remote_profile_id: "",
              infrared_emitter_ref: "",
              preferred_platform: "remote",
              route_status: "unassigned",
              area: { area_id: "living-room", name: "Living room" },
              home_assistant: {
                entity_id: "remote.unconfigured_appliance",
                available: false,
                platform: "remote",
                device_id: "fixture-unconfigured-appliance",
                device_url:
                  "/config/devices/device/fixture-unconfigured-appliance",
              },
            },
          },
        }
      : fixtureView === "offline"
        ? {
            ...workspaceRegistry,
            infrared_hardware: {
              ...workspaceRegistry.infrared_hardware,
              emitters: workspaceRegistry.infrared_hardware.emitters.map(
                (item) => ({ ...item, available: false }),
              ),
            },
          }
        : fixtureView === "no-blaster"
          ? {
              ...workspaceRegistry,
              infrared_hardware: {
                ...workspaceRegistry.infrared_hardware,
                emitters: [],
              },
            }
          : ["no-receiver", "no-receiver-dialog"].includes(fixtureView)
            ? {
                ...workspaceRegistry,
                infrared_hardware: {
                  ...workspaceRegistry.infrared_hardware,
                  receivers: [],
                },
              }
            : [
                  "compatibility-adapter",
                  "compatibility-adapter-hardware",
                ].includes(fixtureView)
              ? {
                  ...workspaceRegistry,
                  infrared_hardware: {
                    ...workspaceRegistry.infrared_hardware,
                    compatibility_adapter_available: true,
                  },
                }
              : workspaceRegistry;
const hass = {
  locale: { language: "en" },
  services: { imprint_refinery: { cancel_capture: {} } },
  states: {
    "sensor.imprint_refinery_status": {
      state:
        fixtureView === "offline"
          ? "unavailable"
          : fixtureView === "busy"
            ? "sending"
            : "idle",
    },
    "infrared.demo": {
      state: fixtureView === "offline" ? "unavailable" : "unknown",
    },
    "infrared.bedroom": { state: "unknown" },
  },
  callService: async (domain, service, data) => {
    calls.push({ transport: "service", domain, service, data });
    return {};
  },
  callWS: async (message) => {
    calls.push({ transport: "ws", ...message });
    const service = message.service || message.action;
    const data = message.service_data || message.data || {};
    if (service === "get_library") {
      if (fixtureView === "load-error")
        throw new Error("Fixture storage could not be read");
      if (fixtureView === "loading") return new Promise(() => {});
      return { response: fixtureRegistry };
    }
    if (service === "command_history") return { response: history };
    if (service === "inspect_import") {
      if (data.format === "native_json")
        return {
          response: {
            format: "native_json",
            schema: "imprint_refinery.backup",
            version: 2,
            remote_profiles: {
              legacy__fan: { name: "Fan", appliance_type: "fan", commands: {} },
            },
            appliances: {
              legacy__fan: {
                name: "Fan",
                remote_profile_id: "legacy__fan",
                area_name: "Living room",
              },
            },
          },
        };
      return {
        response: {
          format: data.format === "auto" ? "flipper" : data.format,
          command_count: 1,
          commands: [
            {
              command_id: "imported_power",
              name: "Imported power",
              code: command.code,
              format: "raw_signed",
              signal,
              analysis,
              source: {
                type: "import",
                format: "flipper",
                original_name: "Power",
              },
              loss_report: {
                lossless: false,
                losses: ["carrier_requires_external_metadata"],
                maximum_timing_error_us: 0,
                carrier_error_hz: 0,
              },
            },
          ],
          unsupported_count: 1,
          unsupported_commands: [
            {
              name: "Unsupported macro",
              error: "Macros cannot be represented as one IR signal",
              provenance: { source: "living-room.ir" },
            },
          ],
        },
      };
    }
    if (service === "export_backup")
      return {
        response: {
          schema: "imprint_refinery.backup",
          version: 2,
          scope: data.remote_profile_id ? "remote_profile" : "library",
          history: "full",
          command_count: 1,
          remote_profiles: {
            silkycasters_rgbw: {
              name: "Silkycasters RGBW",
              appliance_type: "light",
              commands: { power: { ...command, revisions: history.revisions } },
            },
          },
          appliances: data.remote_profile_id
            ? {}
            : {
                sconce_one: {
                  name: "Sconce 1",
                  remote_profile_id: "silkycasters_rgbw",
                  preferred_platform: "remote",
                  area_name: "Living room",
                },
              },
        },
      };
    if (service === "capture_signal") {
      if (fixtureView === "learn-waiting") return new Promise(() => {});
      if (fixtureView === "learn-error")
        throw new Error(
          "No IR code was received before the capture window ended",
        );
      if (fixtureView === "library")
        await new Promise((resolve) => setTimeout(resolve, 150));
      return { response: { code: command.code, format: "raw_signed", signal } };
    }
    if (service === "analyze_signal") {
      const learnedAnalysis =
        fixtureView === "learn-review"
          ? {
              ...analysis,
              fingerprints: {
                normalized_50us: "fixture-new-fingerprint",
                exact: "fixture-new-exact",
              },
            }
          : analysis;
      return {
        response: {
          format: command.format,
          code: command.code,
          signal,
          analysis: learnedAnalysis,
        },
      };
    }
    if (service === "catalog_match_signal") {
      if (fixtureView === "library")
        await new Promise((resolve) => setTimeout(resolve, 150));
      return { response: { matches: [] } };
    }
    if (service === "catalog_identify_signals") {
      if (fixtureView === "library")
        await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        response: {
          captures: data.captures.map((capture, index) => ({
            index: index + 1,
            role: capture.role || "",
            profile_count: 0,
            duplicate_of: null,
          })),
          match_count: 0,
          truncated: false,
          matches: [],
        },
      };
    }
    if (service === "convert_signal") {
      if (data.name === "Power" && data.output_format === "pronto")
        await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        response: {
          value: convertedValues[data.output_format] || command.code,
          loss_report: { lossless: true },
        },
      };
    }
    if (service === "encode_signal")
      return { response: { code: command.code } };
    if (service === "rebuild_signal")
      return {
        response: {
          format: "raw_signed",
          code: command.code,
          signal,
          analysis,
          rebuild: analysis.protocol_rebuilds[0],
        },
      };
    if (service === "catalog_search")
      return { response: { catalog: catalogMeta, profiles: [catalogSummary] } };
    if (service === "catalog_profile") return { response: catalogProfile };
    if (service === "create_remote_profile") {
      fixtureRegistry.remote_profiles[data.remote_profile_id] = {
        name: data.name,
        appliance_type: data.appliance_type,
        dependent_appliance_ids: [],
        commands: {},
      };
      return { response: { status: "saved" } };
    }
    if (service === "store_command") {
      const profile = fixtureRegistry.remote_profiles[data.remote_profile_id];
      if (profile) profile.commands[data.command_id] = { ...command, ...data };
      return { response: { status: "saved" } };
    }
    if (service === "duplicate_command") {
      const source =
        fixtureRegistry.remote_profiles[data.remote_profile_id]?.commands?.[
          data.command_id
        ];
      const target =
        fixtureRegistry.remote_profiles[data.target_remote_profile_id];
      if (source && target) {
        target.commands[data.target_command_id] = {
          ...structuredClone(source),
          name: data.name,
          current_revision: 1,
          revision_count: 1,
        };
      }
      return { response: { status: "duplicated" } };
    }
    if (service === "update_command") {
      const profile = fixtureRegistry.remote_profiles[data.remote_profile_id];
      const current = profile?.commands?.[data.command_id];
      if (current) {
        profile.commands[data.command_id] = {
          ...current,
          name: data.name,
          icon: data.icon,
          role: data.role,
        };
      }
      return { response: { status: "saved" } };
    }
    if (service === "move_command") {
      const source = fixtureRegistry.remote_profiles[data.remote_profile_id];
      const target =
        fixtureRegistry.remote_profiles[data.target_remote_profile_id];
      const current = source?.commands?.[data.command_id];
      if (current && target && !target.commands[data.command_id]) {
        target.commands[data.command_id] = current;
        delete source.commands[data.command_id];
      }
      return { response: { status: "moved" } };
    }
    if (service === "update_appliance") {
      const appliance = fixtureRegistry.appliances[data.appliance_id];
      if (appliance) Object.assign(appliance, data);
      return { response: { status: "saved" } };
    }
    if (service === "catalog_guided_candidates")
      return { response: { catalog: catalogMeta, candidates: [candidate] } };
    if (service === "catalog_guided_start")
      return {
        response: {
          session: {
            session_id: "fixture-guided",
            status: "active",
            pause_reason: null,
            pending_test: null,
            candidates: [candidate],
            progress: { position: 1, total: 1 },
            current_candidate: candidate,
            remaining_delay_seconds: 0,
          },
        },
      };
    if (service === "catalog_guided_test")
      return {
        response: {
          session: {
            session_id: "fixture-guided",
            status: "active",
            pause_reason: null,
            pending_test: { candidate_id: candidate.candidate_id },
            candidates: [candidate],
            progress: { position: 1, total: 1 },
            current_candidate: candidate,
            remaining_delay_seconds: 5,
          },
        },
      };
    if (service === "catalog_guided_answer") {
      if (data.result === "worked")
        return {
          response: {
            session: {
              session_id: "fixture-guided",
              status: "paused",
              pause_reason: "worked",
              pending_test: null,
              candidates: [candidate],
              progress: { position: 1, total: 1 },
              current_candidate: candidate,
              remaining_delay_seconds: 5,
            },
          },
        };
      return {
        response: {
          session: {
            session_id: "fixture-guided",
            status: "completed",
            pause_reason: null,
            pending_test: null,
            candidates: [candidate],
            progress: { position: 1, total: 1 },
            current_candidate: null,
            remaining_delay_seconds: 5,
          },
        },
      };
    }
    if (service === "catalog_guided_control") {
      if (data.session_action === "cancel")
        return {
          response: {
            session_id: "fixture-guided",
            status: "cancelled",
            pause_reason: null,
            pending_test: null,
            current_candidate: candidate,
            candidates: [candidate],
            progress: { position: 1, total: 1 },
            remaining_delay_seconds: 0,
          },
        };
      return {
        response: {
          session_id: "fixture-guided",
          status: "active",
          pause_reason: null,
          pending_test: null,
          current_candidate: candidate,
          candidates: [candidate],
          progress: { position: 1, total: 1 },
          remaining_delay_seconds: 0,
        },
      };
    }
    return { response: {} };
  },
};

await customElements.whenDefined("imprint-refinery-card");
const preview = document.getElementById("preview");
if (Number.isFinite(fixtureHostWidth) && fixtureHostWidth > 0) {
  preview.style.inlineSize = `${fixtureHostWidth}px`;
  preview.style.maxInlineSize = "100%";
  preview.style.marginInline = "auto";
}
const mountComponent = async (tag, properties) => {
  if (!customElements.get(tag)) {
    throw new Error(`Fixture requested undefined custom element: ${tag}`);
  }
  preview.className = "fixture-shell";
  preview.innerHTML = '<div class="fixture-title">Imprint Refinery</div>';
  const element = document.createElement(tag);
  Object.assign(element, properties);
  preview.append(element);
  await element.updateComplete;
  if (!element.shadowRoot) {
    throw new Error(
      `Fixture custom element did not render a shadow root: ${tag}`,
    );
  }
  return element;
};
const lab = {
  remoteProfileId: "silkycasters_rgbw",
  commandId: "power",
  sourceName: "Power",
  sourceRevision: 4,
  original: [...timings],
  timings: timings.map((value, index) => (index === 5 ? value + 30 : value)),
  carrierFrequency: 38000,
  originalCarrierFrequency: 38000,
  carrierSource: "assumed",
  sourceAnalysis: analysis,
  draftAnalysis: analysis,
  analysisPending: false,
  undo: [],
  redo: [],
  selected: 5,
  selectionStart: 4,
  selectionEnd: 5,
  selectedFrame: 0,
  frameRoles: ["intro", "repeat"],
  originalFrameRoles: ["intro", "repeat"],
  zoom: 1,
  pan: 0,
  cursors: [8000, 13000],
  activeCursor: 0,
  view: fixtureView === "lab-compare" ? "compare" : "edit",
  snap: 10,
  boundaryMode: "shift",
  dirty: true,
  saveName: "Power experiment",
  saveId: "power_experiment",
  idTouched: false,
};
const repeatedTimings = Array.from({ length: 23 }, () => [
  9000, 4500, 560, 560, 560, 1690, 560, 560, 560, 1690, 560, 560, 560, 40000,
]).flat();
const repeatedAnalysis = {
  ...analysis,
  pulse_count: repeatedTimings.length,
  total_duration_us: repeatedTimings.reduce((sum, value) => sum + value, 0),
  frame_count: 23,
  repeated_frame_count: 22,
  frames: Array.from({ length: 23 }, (_unused, index) => ({
    start: index * 14,
    end: index * 14 + 13,
    duration_us: 64000,
    group: "fixture-repeat",
  })),
  frame_roles: Array.from({ length: 23 }, (_unused, index) => ({
    frame: index,
    role: index ? "repeat" : "intro",
  })),
  single_press_candidate: {
    timings: repeatedTimings.slice(0, 14),
    kept_frames: 1,
    removed_frames: 22,
    warning:
      "The protocol is not conclusive; test the one-press preview before saving.",
  },
};
const inferredBinaryAnalysis = {
  ...analysis,
  protocol: undefined,
  confidence: "unknown",
  evidence_class: "unknown",
  protocol_candidates: [],
  binary_payload: {
    value: "01011010",
    bit_count: 8,
    display_order: "transmission",
    bit_order: "unknown",
    encoding: "pulse_distance",
    symbol: "space_length",
    zero_us: 400,
    one_us: 1200,
    evidence: "distance_width_model",
    confidence_score: 70,
    agreement_count: 1,
    method_count: 1,
    evidence_family_count: 1,
  },
  binary_decoders: {
    strategy: "duration_bin_template_match",
    selected_mode: "pulse_distance",
    results: [
      {
        mode: "pulse_distance",
        status: "matched",
        fit: 1,
        payload: {
          value: "01011010",
          bit_count: 8,
          display_order: "transmission",
          bit_order: "unknown",
          encoding: "pulse_distance",
          symbol: "space_length",
          zero_us: 400,
          one_us: 1200,
          evidence: "distance_width_model",
        },
      },
      {
        mode: "pulse_width",
        status: "rejected",
        reason: "requires_two_mark_classes_and_one_space_class",
      },
    ],
    protocol_results: [],
    votes: [
      {
        method: "pulse_distance",
        family: "waveform_model",
        value: "01011010",
        fit: 1,
      },
    ],
    auto: {
      status: "matched",
      confidence_score: 70,
      agreement_count: 1,
      method_count: 1,
      evidence_family_count: 1,
      selected_value: "01011010",
    },
  },
};

const retiredFixtureViews = new Set([
  "catalog",
  "catalog-empty",
  "guided",
  "guided-paused",
  "confirm",
  "profile",
  "catalog-choices",
  "catalog-import",
  "catalog-import-preview",
  "catalog-error",
  "learn-preparing",
  "learn-duplicate",
  "learn-optimized",
  "inspector",
  "inspector-signal",
  "inspector-single-frame",
  "inspector-code",
  "inspector-history",
  "inspector-malformed",
  "inspector-offline",
  "inspector-ambiguous",
  "no-results",
  "dialog-locations",
  "dialog-add-appliance",
  "dialog-rename-command",
  "dialog-delete-command",
  "dialog-delete-appliance",
  "dialog-revision-restore",
  "dialog-command-move",
  "dialog-command-duplicate",
  "dialog-command-role",
  "dialog-command-icon",
  "dialog-device-move",
  "dialog-device-settings",
]);

const queryAllDeep = (root, selector) => {
  const matches = [...(root.querySelectorAll?.(selector) || [])];
  const shadowHosts = [
    ...(root instanceof Element && root.shadowRoot ? [root] : []),
    ...(root.querySelectorAll?.("*") || []),
  ];
  for (const host of shadowHosts) {
    if (host.shadowRoot)
      matches.push(...queryAllDeep(host.shadowRoot, selector));
  }
  return matches;
};

const clickButton = async (root, label) => {
  let button;
  for (let attempt = 0; attempt < 120 && !button; attempt += 1) {
    button = queryAllDeep(
      root,
      "button, [role=button], ha-button, ha-icon-button, ha-tab-group-tab, ha-dropdown-item",
    ).find(
      (item) =>
        item.textContent?.trim() === label ||
        item.label === label ||
        item.getAttribute?.("aria-label") === label,
    );
    if (!button) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!button) throw new Error(`Fixture action "${label}" was not found.`);
  button.click();
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
};

if (retiredFixtureViews.has(fixtureView)) {
  throw new Error(
    `Fixture view "${fixtureView}" targets a retired component. Use a current workspace fixture instead.`,
  );
} else if (
  [
    "lab",
    "lab-decoded",
    "lab-inferred-binary",
    "lab-compare",
    "lab-code",
    "lab-custom",
    "lab-invalid",
    "lab-offline",
    "lab-preview",
    "lab-leave",
    "lab-repeats",
    "lab-rebuildable-sirc",
  ].includes(fixtureView)
) {
  const fixtureLab = {
    ...lab,
    ...(fixtureView === "lab-code"
      ? {
          original: timings.slice(0, -1),
          timings: timings.slice(0, -1),
          dirty: false,
        }
      : {}),
    ...(fixtureView === "lab-repeats"
      ? {
          original: [...repeatedTimings],
          timings: [...repeatedTimings],
          sourceAnalysis: repeatedAnalysis,
          draftAnalysis: repeatedAnalysis,
          frameRoles: ["intro", ...Array(22).fill("repeat")],
          originalFrameRoles: ["intro", ...Array(22).fill("repeat")],
          dirty: false,
          selected: 0,
          selectionStart: 0,
          selectionEnd: 0,
          cursors: [0, repeatedTimings.reduce((sum, value) => sum + value, 0)],
        }
      : {}),
    ...(fixtureView === "lab-inferred-binary"
      ? {
          sourceAnalysis: inferredBinaryAnalysis,
          draftAnalysis: inferredBinaryAnalysis,
          dirty: false,
        }
      : {}),
    ...(fixtureView === "lab-rebuildable-sirc"
      ? {
          original: [...sircFrame],
          timings: [...sircFrame],
          carrierFrequency: 38000,
          originalCarrierFrequency: 38000,
          sourceAnalysis: sircAnalysis,
          draftAnalysis: sircAnalysis,
          dirty: false,
          selected: 0,
          selectionStart: 0,
          selectionEnd: 0,
          frameRoles: ["intro"],
          originalFrameRoles: ["intro"],
          cursors: [0, 45000],
        }
      : {}),
    ...(fixtureView === "lab-custom"
      ? {
          custom: true,
          remoteProfileId: "silkycasters_rgbw",
          commandId: "",
          sourceName: "New custom signal",
          sourceRevision: 0,
          saveName: "",
          saveId: "",
          dirty: false,
        }
      : {}),
    ...(fixtureView === "lab-invalid"
      ? {
          timings: [9000, 0, 560],
          draftAnalysis: {
            evidence_class: "unknown",
            warnings: ["odd_timing_count"],
          },
        }
      : {}),
    ...(fixtureView === "lab-preview"
      ? {
          preview: {
            kind: "Round timings",
            timings: timings.map((value) => Math.round(value / 100) * 100),
            changed: 12,
            durationDelta: 80,
            maxTimingError: 40,
            frameDelta: 0,
            roundTripChanges: 0,
            evidenceClass: "pattern_only",
            protocol: "NEC",
            compatible: true,
            warning: "Review timing drift before applying this transform.",
          },
        }
      : {}),
    ...(fixtureView === "lab-leave" ? { leavePrompt: true } : {}),
  };
  const labElement = await mountComponent("imprint-signal-lab", {
    lab: fixtureLab,
    registry: workspaceRegistry,
    emitterName: "Living room emitter",
    emitterReady: fixtureView !== "lab-offline",
    offlineReason:
      fixtureView === "lab-offline"
        ? "The selected emitter is unavailable; editing and export remain available."
        : "",
  });
  labElement.addEventListener("lab-action", (event) => {
    const detail = event.detail || {};
    if (detail.action === "ui")
      labElement.lab = { ...labElement.lab, ...(detail.patch || {}) };
    if (detail.action === "zoom")
      labElement.lab = {
        ...labElement.lab,
        zoom: Number(detail.zoom),
        ...(detail.pan == null ? {} : { pan: Number(detail.pan) }),
      };
    if (detail.action === "view")
      labElement.lab = { ...labElement.lab, view: detail.view };
    if (detail.action === "rebuild-preview") {
      const isSirc = detail.rebuildId === "fixture-sirc-rebuild";
      const rebuilt = isSirc ? sircCanonical : timings;
      const protocol = isSirc ? "SIRC" : "NEC";
      labElement.lab = {
        ...labElement.lab,
        preview: {
          kind: `Align to ${protocol} timing`,
          timings: [...rebuilt],
          changed:
            Math.abs(rebuilt.length - labElement.lab.timings.length) +
            rebuilt
              .slice(0, labElement.lab.timings.length)
              .filter((value, index) => value !== labElement.lab.timings[index])
              .length,
          durationDelta:
            rebuilt.reduce((sum, value) => sum + value, 0) -
            labElement.lab.timings.reduce((sum, value) => sum + value, 0),
          maxTimingError: 0,
          frameDelta: isSirc ? 2 : 0,
          roundTripChanges: 0,
          evidenceClass: "likely",
          protocol,
          compatible: true,
          carrierFrequency: isSirc ? 40000 : 38000,
          frameRoles: isSirc
            ? ["intro", "repeat", "repeat"]
            : ["intro", "repeat"],
          description: `The decoded command was re-encoded using ${protocol} standard timing. The protected capture is unchanged.`,
          timingBasis: `${protocol} standard timing`,
          applyLabel: `Apply ${protocol} alignment`,
          protocolAlignment: true,
          recognitionLabel: `${protocol} · 3 interpretations agree`,
        },
      };
    }
    if (detail.action === "preview-apply" && Array.isArray(detail.timings))
      labElement.lab = {
        ...labElement.lab,
        timings: [...detail.timings],
        carrierFrequency: Number(
          detail.carrierFrequency || labElement.lab.carrierFrequency,
        ),
        frameRoles: [...(detail.frameRoles || labElement.lab.frameRoles)],
        preview: undefined,
        dirty: true,
      };
    if (detail.action === "preview-cancel")
      labElement.lab = { ...labElement.lab, preview: undefined };
    if (detail.action === "code-representation") {
      const trailingSpace =
        detail.timings.length % 2 && ["pronto", "girr"].includes(detail.format)
          ? detail.timings.at(-1)
          : 0;
      labElement.lab = {
        ...labElement.lab,
        codeRepresentation: {
          key: detail.key,
          format: detail.format,
          value: convertedValues[detail.format] || command.code,
          loading: false,
          lossReport: trailingSpace
            ? {
                lossless: false,
                losses: ["trailing_space_added"],
                trailing_space_added_us: trailingSpace,
                trailing_space_source: "matched_final_mark",
              }
            : { lossless: true },
        },
      };
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
} else {
  const card = document.createElement("imprint-refinery-card");
  card.setConfig({
    title: "Imprint Refinery",
    workspace: fixturePresentation !== "card",
    timeout: 60,
  });
  card.hass = hass;
  preview.append(card);
  await card.updateComplete;
  if (
    fixturePresentation !== "card" &&
    [
      "library",
      "learn-dialog",
      "learn-waiting",
      "learn-review",
      "learn-error",
      "no-receiver-dialog",
      "profile-dialog",
      "custom-signal-dialog",
      "custom-signal-fallback",
      "catalog-dialog",
      "confirmation-dialog",
      "icon-dialog",
      "bulk-selection",
      "backup-dialog",
      "import-dialog",
      "command-inspector",
      "command-edit",
      "command-duplicate",
      "signal-lab",
      "offline",
      "no-blaster",
      "no-receiver",
      "compatibility-adapter",
    ].includes(fixtureView)
  ) {
    await clickButton(card, "Remote profiles");
  }
  if (
    ["appliances", "appliance-dialog", "unconfigured-appliance"].includes(
      fixtureView,
    )
  ) {
    await clickButton(card, "Appliances");
    if (fixtureView === "appliance-dialog") {
      await clickButton(card, "Edit Sconce 1");
    }
  }
  if (fixtureView === "infrared-hardware") {
    await clickButton(card, "Infrared hardware");
  }
  if (fixtureView === "compatibility-adapter-hardware") {
    await clickButton(card, "Infrared hardware");
  }
  if (["learn-waiting", "learn-review", "learn-error"].includes(fixtureView)) {
    card.testEmitterRef = "fixture-emitter-one";
    await card.updateComplete;
  }
  if (
    [
      "learn-dialog",
      "learn-waiting",
      "learn-review",
      "learn-error",
      "no-receiver-dialog",
    ].includes(fixtureView)
  ) {
    await clickButton(card, "Learn command");
  }
  if (["learn-waiting", "learn-review", "learn-error"].includes(fixtureView)) {
    await clickButton(card, "Begin listening");
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const stage = card.dialog?.data?.stage;
      if (
        (fixtureView === "learn-waiting" && stage === "waiting") ||
        (fixtureView === "learn-review" && stage === "review") ||
        (fixtureView === "learn-error" && stage === "error")
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (fixtureView === "profile-dialog") {
    await clickButton(card, "Add remote profile");
  }
  if (
    ["custom-signal-dialog", "custom-signal-fallback"].includes(fixtureView)
  ) {
    await clickButton(card, "Create custom signal");
  }
  if (fixtureView === "catalog-dialog") {
    await clickButton(card, "Find codes");
  }
  if (fixtureView === "confirmation-dialog") {
    await clickButton(card, "Actions for Silkycasters RGBW");
    await clickButton(card, "Delete profile");
  }
  if (fixtureView === "icon-dialog") {
    await clickButton(card, "Actions for Power");
    await clickButton(card, "Choose icon");
  }
  if (fixtureView === "bulk-selection") {
    await clickButton(card, "Select");
  }
  if (
    [
      "backup-dialog",
      "import-dialog",
      "command-inspector",
      "command-edit",
      "command-duplicate",
      "signal-lab",
    ].includes(fixtureView)
  ) {
    await clickButton(
      card,
      fixtureView === "backup-dialog"
        ? "Backup & restore"
        : fixtureView === "import-dialog"
          ? "Import signals"
          : "Power",
    );
    if (fixtureView === "signal-lab") {
      await clickButton(card, "Open in Signal Lab");
    }
    if (fixtureView === "command-edit") {
      await clickButton(card, "Edit");
    }
    if (fixtureView === "command-duplicate") {
      await clickButton(card, "Duplicate");
    }
  }
}

document.documentElement.dataset.fixtureReady = "true";
window.__IMPRINT_REFINERY_FIXTURES__ = {
  command,
  workspaceRegistry,
  history,
  catalogProfile,
  catalogSummary,
  candidate,
  timings,
  analysis,
  signal,
  hass,
  calls,
  view: fixtureView,
  theme: fixtureTheme,
};
