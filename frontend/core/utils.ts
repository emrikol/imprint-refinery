import type { AnalysisData } from "../types";

export interface BinaryPayload {
  value: string;
  bit_count?: number;
  display_order?: string;
  bit_order?: string;
  encoding?: string;
  symbol?: string;
  zero_us?: number;
  one_us?: number;
  evidence?: string;
  confidence_score?: number;
  agreement_count?: number;
  method_count?: number;
  fit_score?: number;
}

export type BinaryDecoderMode =
  | "auto"
  | "pulse_distance"
  | "pulse_width"
  | "protocol";

export const binaryDecoderChoices: Array<{
  value: BinaryDecoderMode;
  label: string;
}> = [
  { value: "auto", label: "Auto · require agreement" },
  { value: "pulse_distance", label: "Pulse-distance model" },
  { value: "pulse_width", label: "Pulse-width model" },
  { value: "protocol", label: "Named protocol decoder" },
];

export const evidenceLabel = (analysis?: AnalysisData): string => {
  const value = analysis?.evidence_class || analysis?.confidence || "unknown";
  return (
    (
      {
        verified: "Verified",
        high: "Verified",
        likely: "Likely",
        medium: "Likely",
        ambiguous: "Ambiguous",
        pattern_only: "Pattern only",
        unknown: "Unknown",
      } as Record<string, string>
    )[value] || "Unknown"
  );
};

export const formatDuration = (microseconds = 0): string => {
  if (microseconds >= 1_000_000)
    return `${(microseconds / 1_000_000).toFixed(2)} s`;
  if (microseconds >= 1_000) return `${(microseconds / 1_000).toFixed(2)} ms`;
  return `${Math.round(microseconds)} µs`;
};

export interface RepeatSummary {
  captured: string;
  capturedDetail: string;
  required: string;
  requiredDetail: string;
}

export const repeatSummary = (analysis?: AnalysisData): RepeatSummary => {
  const captured = Number.isInteger(analysis?.repeat_count)
    ? Number(analysis?.repeat_count)
    : Number.isInteger(analysis?.repeated_frame_count)
      ? Number(analysis?.repeated_frame_count)
      : analysis?.frame_count === 1
        ? 0
        : null;
  const required = Number.isInteger(analysis?.required_repeats)
    ? Number(analysis?.required_repeats)
    : null;
  return {
    captured: captured == null ? "Unclear" : String(captured),
    capturedDetail:
      captured == null
        ? "The capture has multiple possible frame interpretations."
        : "Repeat frames found in this saved capture.",
    required:
      required == null
        ? "Not determined"
        : required
          ? String(required)
          : "None",
    requiredDetail:
      required == null
        ? "The protocol candidates do not agree."
        : required
          ? `A valid press needs ${required + 1} frames total.`
          : "No repeats are required for one press.",
  };
};

export const binaryPayloadFor = (
  analysis?: AnalysisData,
  mode: BinaryDecoderMode = "auto",
): BinaryPayload | null => {
  const decoders = analysis?.binary_decoders as any;
  if (mode === "pulse_distance" || mode === "pulse_width") {
    const result = decoders?.results?.find(
      (item: any) => item?.mode === mode && item?.status === "matched",
    );
    return result?.payload?.value
      ? {
          ...result.payload,
          fit_score: Math.round(Number(result.fit || 0) * 100),
        }
      : null;
  }
  if (mode === "protocol") {
    const results = Array.isArray(decoders?.protocol_results)
      ? decoders.protocol_results
      : [];
    const values = new Set(
      results.map((item: any) => item?.payload?.value).filter(Boolean),
    );
    return values.size === 1 && results[0]?.payload?.value
      ? (results[0].payload as BinaryPayload)
      : null;
  }
  if (decoders?.auto && decoders.auto.status !== "matched") return null;
  const direct = analysis?.binary_payload as
    | Record<string, unknown>
    | undefined;
  if (direct && typeof direct === "object" && typeof direct.value === "string")
    return direct as unknown as BinaryPayload;
  const candidate = (analysis?.protocol_candidates || []).find(
    (item: any) => item?.binary_payload?.value,
  );
  return (candidate?.binary_payload as BinaryPayload | undefined) || null;
};

export const binaryDecoderMessage = (
  analysis: AnalysisData | undefined,
  mode: BinaryDecoderMode,
): string => {
  const decoders = analysis?.binary_decoders as any;
  if (mode === "auto") {
    if (decoders?.auto?.status === "ambiguous")
      return "The applicable decoders produced different bitstreams. Choose a decoder to inspect each interpretation.";
    return "No supported binary timing model fits this waveform cleanly.";
  }
  if (mode === "protocol")
    return "The named protocol decoders do not agree on one raw bitstream.";
  const reason = decoders?.results?.find(
    (item: any) => item?.mode === mode,
  )?.reason;
  return (
    (
      {
        not_enough_symbols: "There are not enough symbols to apply this model.",
        mark_axis_has_too_many_classes:
          "The mark timings contain more than two duration classes.",
        mark_axis_is_not_binary:
          "The mark timings do not form two clean duration classes.",
        space_axis_is_not_binary:
          "The space timings do not form two clean duration classes.",
        space_axis_has_too_many_classes:
          "The space timings contain more than two duration classes.",
        space_axis_does_not_have_two_classes:
          "Pulse-distance decoding requires two clean space-duration classes.",
        requires_two_mark_classes_and_one_space_class:
          "Pulse-width decoding requires two mark-duration classes and one space-duration class.",
        leading_pair_matches_data:
          "The leading pair looks like data rather than a separate header.",
      } as Record<string, string>
    )[String(reason || "")] ||
    "This decoder does not fit the captured timing pattern."
  );
};

export const binaryScoreLabel = (
  payload: BinaryPayload,
  mode: BinaryDecoderMode,
): string => {
  if (mode === "auto" && payload.confidence_score != null) {
    const agreement =
      payload.method_count && payload.method_count > 1
        ? ` · ${payload.agreement_count}/${payload.method_count} decoders agree`
        : " · one applicable decoder";
    return `${payload.confidence_score}% support${agreement}`;
  }
  if (payload.fit_score != null) return `${payload.fit_score}% timing fit`;
  return "Protocol interpretation";
};

export const groupedBinary = (value = ""): string =>
  value.match(/.{1,8}/g)?.join(" ") || value;

export const binaryEncodingLabel = (encoding?: string): string =>
  (
    ({
      pulse_distance: "Pulse-distance",
      pulse_distance_width: "Pulse distance/width",
      pulse_width: "Pulse-width",
      biphase: "Biphase",
    }) as Record<string, string>
  )[String(encoding || "")] || "Binary timing";

export const decodedInteger = (value: number): string => {
  const byteWidth = Math.max(
    1,
    Math.ceil(Math.max(1, value.toString(2).length) / 8),
  );
  const hex = value
    .toString(16)
    .toUpperCase()
    .padStart(byteWidth * 2, "0");
  const binary = value.toString(2).padStart(byteWidth * 8, "0");
  return `${value} · 0x${hex} · 0b${binary}`;
};

export const binaryPayloadExplanation = (
  payload: BinaryPayload,
  protocol?: string,
): string => {
  if (payload.evidence?.includes("recognized_protocol")) {
    const order =
      payload.bit_order === "lsb_first"
        ? "Each decoded field is sent least-significant bit first."
        : "The protocol decoder determines the field order.";
    return `Derived from the waveform's timing clusters and confirmed by ${protocol || "the protocol decoder"}. Bits are shown in transmission order. ${order}`;
  }
  const changingPart = payload.symbol === "mark_length" ? "mark" : "space";
  return `Short ${changingPart} ≈ ${payload.zero_us || "?"} µs maps to 0; long ${changingPart} ≈ ${payload.one_us || "?"} µs maps to 1. The timing clusters support this stream, but the protocol, bit order, and field meanings are unknown.`;
};

export const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export const errorMessage = (error: unknown): string =>
  String(
    (error as any)?.message ||
      (error as any)?.body?.message ||
      (error as any)?.error ||
      error,
  );

export const validId = (value: string): boolean => /^[a-z0-9_]+$/.test(value);

export const copyText = async (value: string): Promise<void> => {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.readOnly = true;
  area.style.cssText = "position:fixed;opacity:0";
  document.body.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("Copy was blocked by the browser");
};

export const safeFilename = (value: string, fallback = "imprint-signal"): string =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;

export const downloadText = (
  value: string,
  filename: string,
  mediaType = "text/plain;charset=utf-8",
): void => {
  const url = URL.createObjectURL(new Blob([value], { type: mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const emit = <T>(
  target: EventTarget,
  type: string,
  detail?: T,
): void => {
  target.dispatchEvent(
    new CustomEvent(type, { detail, bubbles: true, composed: true }),
  );
};
