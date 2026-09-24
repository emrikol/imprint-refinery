export type Dict<T = unknown> = Record<string, T>;

export interface HomeAssistant {
  locale?: { language?: string };
  states?: Dict<{ state: string; attributes?: Dict }>;
  services?: Dict<Dict>;
  callService(domain: string, service: string, data?: Dict): Promise<unknown>;
  callWS(message: Dict): Promise<any>;
}

export interface SignalData {
  carrier_frequency?: number;
  carrier_source?: string;
  timings?: number[];
}

export interface AnalysisData extends Dict {
  analyzer?: string;
  evidence_class?:
    | "verified"
    | "likely"
    | "ambiguous"
    | "pattern_only"
    | "unknown";
  confidence?: string;
  confidence_level?: string;
  protocol?: string;
  protocol_name?: string;
  total_duration_us?: number;
  pulse_count?: number;
  frame_count?: number;
  repeated_frame_count?: number;
  repeat_count?: number;
  required_repeats?: number;
  minimum_frame_count?: number;
  repeat_requirement_met?: boolean;
  repeat_style?: string;
  warnings?: string[];
  frames?: Array<Dict<number | string>>;
  frame_roles?: Array<Dict<number | string>>;
  protocol_candidates?: Dict[];
  protocol_rebuilds?: ProtocolRebuild[];
  fingerprints?: Dict<string>;
  single_press_candidate?: {
    timings: number[];
    kept_frames?: number;
    removed_frames?: number;
    warning?: string;
  };
  recognition?: Dict;
}

export interface ProtocolRebuild extends Dict {
  id: string;
  candidate_id: string;
  protocol: string;
  evidence_class?: string;
  carrier_frequency: number;
  carrier_changed?: boolean;
  timing_count: number;
  changed_timings: number;
  duration_delta_us: number;
  equivalent_interpretation_count?: number;
  address?: number;
  command?: number;
  toggle?: number;
  bits?: number;
}

export interface CommandData extends Dict {
  name?: string;
  code?: string;
  format?: string;
  icon?: string;
  role?: string;
  signal?: SignalData;
  analysis?: AnalysisData;
  source?: Dict;
  current_revision?: number;
  revision_count?: number;
  loss_report?: LossReport;
  home_assistant?: { entity_id?: string; platform?: string };
}

export interface LossReport extends Dict {
  lossless?: boolean;
  losses?: string[];
  commands?: LossReport[];
  warnings?: string[];
  dropped_fields?: string[];
  changed_fields?: string[];
  trailing_space_added_us?: number | null;
  trailing_space_source?: string | null;
}

export interface ApplianceData extends Dict {
  name?: string;
  appliance_type?: string;
  preferred_platform?: string;
  emitter_id?: string;
  remote_profile_id?: string | null;
  infrared_emitter_ref?: string | null;
  route_status?: "ready" | "unassigned" | "missing" | "unavailable";
  area?: { area_id: string; name: string } | null;
  commands?: Dict<CommandData>;
  home_assistant?: {
    entity_id?: string;
    available?: boolean;
    platform?: string;
    device_id?: string;
    device_url?: string;
    configuration_url?: string;
    command_entities?: Dict<string>;
  };
}

export interface RemoteProfileData extends Dict {
  name?: string;
  appliance_type?: string;
  commands?: Dict<CommandData>;
  dependent_appliance_ids?: string[];
}

export interface CommandSelectionState {
  remoteProfileId: string;
  commandIds: string[];
}

export interface InfraredHardwareEntity extends Dict {
  ref: string;
  entity_id: string;
  name: string;
  available: boolean;
  last_activity?: string | null;
  platform?: string;
  compatibility_adapter?: boolean;
  device_id?: string | null;
  device_name?: string | null;
  device_url?: string | null;
  entity_url?: string;
  area_name?: string | null;
}

export interface AreaSummary {
  area_id: string;
  name: string;
}

export interface RegistryData extends Dict {
  remote_profiles?: Dict<RemoteProfileData>;
  appliances?: Dict<ApplianceData>;
  infrared_hardware?: {
    emitters: InfraredHardwareEntity[];
    receivers: InfraredHardwareEntity[];
    compatibility_adapter_available?: boolean;
  };
  areas?: AreaSummary[];
}

export interface LabState {
  sourceProfileId: string;
  remoteProfileId: string;
  commandId: string;
  sourceName: string;
  sourceRevision: number;
  original: number[];
  timings: number[];
  carrierFrequency: number;
  originalCarrierFrequency: number;
  carrierSource: string;
  sourceAnalysis: AnalysisData;
  draftAnalysis?: AnalysisData;
  analysisPending?: boolean;
  undo: LabSnapshot[];
  redo: LabSnapshot[];
  selected: number;
  selectionStart: number;
  selectionEnd: number;
  selectedFrame: number;
  frameRoles: string[];
  originalFrameRoles: string[];
  zoom: number;
  pan: number;
  cursors: [number, number];
  activeCursor: number;
  view: "edit" | "compare";
  detailTab?: "decoded" | "timings" | "code";
  convertFormat?: string;
  saveOpen?: boolean;
  editingOverlays?: boolean;
  binaryDecoderMode?: "auto" | "pulse_distance" | "pulse_width" | "protocol";
  snap: number;
  boundaryMode: "shift" | "preserve";
  dirty: boolean;
  custom?: boolean;
  saveName: string;
  saveId: string;
  idTouched: boolean;
  preview?: LabPreview;
  codeRepresentation?: LabCodeRepresentation;
  leavePrompt?: boolean;
  testCooldownUntil?: number;
}

export interface LabCodeRepresentation {
  key: string;
  format: string;
  value?: string;
  loading: boolean;
  error?: string;
  lossReport?: LossReport;
}

export interface LabSnapshot {
  timings: number[];
  frameRoles: string[];
  carrierFrequency: number;
}

export interface LabPreview {
  kind: string;
  timings: number[];
  changed: number;
  durationDelta: number;
  durationDeltaPercent?: number;
  maxTimingError: number;
  maxTimingErrorPercent?: number;
  frameDelta: number;
  roundTripChanges: number | null;
  evidenceClass: string;
  protocol?: string;
  compatible: boolean;
  warning?: string;
  insertTimings?: number[];
  carrierFrequency?: number;
  frameRoles?: string[];
  description?: string;
  timingBasis?: string;
  applyLabel?: string;
  recognitionLabel?: string;
  protocolAlignment?: boolean;
}
