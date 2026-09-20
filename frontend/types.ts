export type Dict<T = unknown> = Record<string, T>;

export interface HomeAssistant {
  locale?: { language?: string };
  states?: Dict<{ state: string; attributes?: Dict }>;
  services?: Dict<Dict>;
  callService(domain: string, service: string, data?: Dict): Promise<unknown>;
  callWS(message: Dict): Promise<any>;
}

export interface Emitter {
  key: string;
  name?: string;
  entity_id?: string;
  enabled?: boolean;
  available?: boolean;
  can_capture?: boolean;
  transport?: "home_assistant_ir" | "zha_bridge";
  config?: Dict;
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
  commands?: Dict<CommandData>;
  home_assistant?: {
    entity_id?: string;
    platform?: string;
    device_id?: string;
    device_url?: string;
    configuration_url?: string;
  };
}

export interface LocationData extends Dict {
  name?: string;
  appliances?: Dict<ApplianceData>;
}

export interface RegistryData extends Dict {
  emitters?: Emitter[];
  locations?: Dict<LocationData>;
}

export interface CommandRef {
  locId: string;
  applianceId: string;
  cmdId: string;
}

export interface CommandEntry extends CommandRef {
  location: LocationData;
  appliance: ApplianceData;
  command: CommandData;
}

export interface InspectorState extends CommandRef {
  tab: "overview" | "signal" | "code" | "history";
  history?: any;
  loading?: boolean;
  representation?: string;
  representations?: Dict<string>;
  representationLoading?: boolean;
  conversionLossReport?: LossReport;
  zoom?: number;
  pan?: number;
  revisionSelected?: number | null;
  binaryDecoderMode?: "auto" | "pulse_distance" | "pulse_width" | "protocol";
}

export interface LearnState {
  seq: number;
  step: "waiting" | "preparing" | "review" | "error";
  locationId: string;
  applianceId: string;
  commandId: string;
  name: string;
  role: string;
  targetKey: string;
  newApplianceName: string;
  code: string;
  originalCode?: string;
  originalPreview?: any;
  optimized?: boolean;
  preview?: any;
  catalogMatches?: any[];
  duplicateMatch?: CommandRef & { commandName: string; applianceName: string };
  replacingEquivalent?: boolean;
  error?: string;
  errorDetail?: string;
  deadline: number;
}

export interface LabState extends CommandRef {
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
  maxTimingError: number;
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
}

export interface CatalogState extends Dict {
  mode: "choices" | "find" | "match" | "import";
  stage?: "guided" | "confirm";
  category?: string;
  brand?: string;
  model?: string;
  name?: string;
  searched?: boolean;
  results?: any[];
  catalog?: any;
  selectedProfile?: any;
  guidedSession?: any;
  candidates?: any[];
  confirmedCandidate?: any;
  confirmedProfileId?: string;
  verifiedFingerprints?: string[];
  importPlan?: {
    all_command_ids?: string[];
    starter_command_ids?: string[];
    counts?: Dict<number>;
    target?: Dict;
    provenance?: Dict;
  };
  unsupportedCommands?: Array<{
    name?: string;
    source?: string;
    error?: string;
  }>;
  lossReport?: LossReport;
  error?: string;
}

export interface UIAction<T = Dict> {
  action: string;
  detail?: T;
}
