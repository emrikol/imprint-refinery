import type { AnalysisData, LabPreview, LabState } from "../types";
import { frameRanges, previewImpact, timingTotal } from "./signal";

export type SelectionMode = "duration" | "pair" | "range" | "frame" | "all";
export type ClipboardFormat = "signed" | "unsigned" | "json" | "pronto";

export interface SignalLabState extends LabState {
  copyFormat?: ClipboardFormat;
  transformScale?: number;
  transformQuantum?: number;
  transformGap?: number;
  zoomAnchorTime?: number;
}

export interface ViewWindow {
  total: number;
  zoom: number;
  span: number;
  start: number;
  end: number;
}

export interface TimingGeometry {
  offsets: number[];
  signalTotal: number;
  view: ViewWindow;
  first: number;
  last: number;
  detailed: boolean;
}

export interface TimingDiff {
  index: number;
  original?: number;
  current?: number;
  delta: number | null;
}

export interface ClipboardParseResult {
  format: "json" | "raw_signed" | "raw_unsigned" | "pronto";
  timings: number[] | null;
  carrierFrequency?: number;
}

export const clamp = (
  value: number,
  minimum: number,
  maximum: number,
): number =>
  Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(value) ? value : minimum),
  );

export const snapValue = (value: number, quantum: number): number => {
  const step = Math.max(1, Number(quantum) || 1);
  return clamp(Math.round(value / step) * step, 1, 65_535);
};

export const viewWindow = (
  timings: number[],
  zoom: number,
  pan: number,
  totalOverride?: number,
): ViewWindow => {
  const total = Math.max(1, Number(totalOverride) || timingTotal(timings));
  const safeZoom = clamp(Number(zoom) || 1, 1, 16);
  const span = total / safeZoom;
  const start = clamp(Number(pan) || 0, 0, 1) * Math.max(0, total - span);
  return { total, zoom: safeZoom, span, start, end: start + span };
};

export const zoomAt = (
  timings: number[],
  zoom: number,
  pan: number,
  nextZoom: number,
  anchorRatio: number,
  totalOverride?: number,
): { zoom: number; pan: number; anchorTime: number } => {
  const before = viewWindow(timings, zoom, pan, totalOverride);
  const ratio = clamp(anchorRatio, 0, 1);
  const anchorTime = before.start + before.span * ratio;
  const resolvedZoom = clamp(nextZoom, 1, 16);
  const nextSpan = before.total / resolvedZoom;
  const maxStart = Math.max(0, before.total - nextSpan);
  const nextStart = clamp(anchorTime - ratio * nextSpan, 0, maxStart);
  return {
    zoom: resolvedZoom,
    pan: maxStart ? nextStart / maxStart : 0,
    anchorTime,
  };
};

export const timingOffsets = (timings: number[]): number[] => {
  const offsets = [0];
  for (const duration of timings)
    offsets.push(offsets.at(-1)! + Number(duration || 0));
  return offsets;
};

export const timingAtTime = (timings: number[], time: number): number => {
  const target = Math.max(0, Number(time) || 0);
  let elapsed = 0;
  for (let index = 0; index < timings.length; index++) {
    elapsed += Number(timings[index]) || 0;
    if (target <= elapsed) return index;
  }
  return Math.max(0, timings.length - 1);
};

export const timingMidpoint = (timings: number[], index: number): number => {
  const offsets = timingOffsets(timings);
  const safeIndex = clamp(
    Math.round(index),
    0,
    Math.max(0, timings.length - 1),
  );
  return (offsets[safeIndex] + offsets[safeIndex + 1]) / 2;
};

export const waveGeometry = (
  timings: number[],
  zoom: number,
  pan: number,
  totalOverride?: number,
  detailLimit = 600,
): TimingGeometry => {
  const offsets = timingOffsets(timings);
  const signalTotal = offsets.at(-1) || 0;
  const view = viewWindow(timings, zoom, pan, totalOverride);
  let first = timings.findIndex(
    (_value, index) => offsets[index + 1] >= view.start,
  );
  if (first < 0) first = Math.max(0, timings.length - 1);
  let last = first;
  while (last < timings.length && offsets[last] <= view.end) last++;
  first = Math.max(0, first - 1);
  last = Math.min(timings.length, last + 1);
  return {
    offsets,
    signalTotal,
    view,
    first,
    last,
    detailed: last - first <= detailLimit,
  };
};

export const selectionRange = (
  length: number,
  start: number,
  end: number,
): [number, number] => {
  if (!length) return [0, -1];
  return [
    clamp(Math.min(start, end), 0, length - 1),
    clamp(Math.max(start, end), 0, length - 1),
  ];
};

export const selectModeRange = (
  timings: number[],
  selected: number,
  mode: SelectionMode,
): [number, number] => {
  const safeSelected = clamp(selected, 0, Math.max(0, timings.length - 1));
  if (mode === "pair") {
    const start = Math.floor(safeSelected / 2) * 2;
    return [start, Math.min(start + 1, timings.length - 1)];
  }
  if (mode === "frame") {
    const frame = frameRanges(timings).find(
      (item) => safeSelected >= item.start && safeSelected < item.end,
    );
    if (frame) return [frame.start, frame.end - 1];
  }
  if (mode === "all") return [0, timings.length - 1];
  return [safeSelected, safeSelected];
};

export const compareTimings = (
  original: number[],
  current: number[],
): TimingDiff[] =>
  Array.from(
    { length: Math.max(original.length, current.length) },
    (_unused, index) => ({
      index,
      original: original[index],
      current: current[index],
      delta:
        original[index] == null || current[index] == null
          ? null
          : current[index] - original[index],
    }),
  ).filter((item) => item.original !== item.current);

export const editBoundary = (
  timings: number[],
  index: number,
  value: number,
  quantum: number,
  preserveFrameLength: boolean,
): number[] | null => {
  if (index < 0 || index >= timings.length) return null;
  const next = [...timings];
  const nextValue = snapValue(value, quantum);
  const delta = nextValue - timings[index];
  next[index] = nextValue;
  if (preserveFrameLength && index + 1 < next.length) {
    const neighbor = timings[index + 1] - delta;
    if (neighbor < 1 || neighbor > 65_535) return null;
    next[index + 1] = neighbor;
  }
  return next;
};

export const applySelectionTransform = (
  kind: "scale" | "round" | "normalize" | "gap" | "align_frames",
  timings: number[],
  range: [number, number],
  options: { scale?: number; quantum?: number; gap?: number } = {},
): number[] => {
  const next = [...timings];
  const [start, end] = selectionRange(next.length, range[0], range[1]);
  if (kind === "scale") {
    const factor = clamp(Number(options.scale) || 100, 1, 1000) / 100;
    for (let index = start; index <= end; index++)
      next[index] = clamp(Math.round(next[index] * factor), 1, 65_535);
  } else if (kind === "round") {
    const quantum = Math.max(1, Number(options.quantum) || 50);
    for (let index = start; index <= end; index++)
      next[index] = snapValue(next[index], quantum);
  } else if (kind === "gap") {
    const target = end % 2 === 1 ? end : Math.min(end + 1, next.length - 1);
    if (target % 2 === 1)
      next[target] = clamp(Number(options.gap) || 40_000, 1, 65_535);
  } else if (kind === "normalize") {
    for (const parity of [0, 1]) {
      const indexes = Array.from(
        { length: end - start + 1 },
        (_unused, offset) => start + offset,
      ).filter((index) => index % 2 === parity);
      const clusters: number[][] = [];
      for (const value of indexes
        .map((index) => next[index])
        .sort((left, right) => left - right)) {
        const cluster = clusters.find((items) => {
          const mean =
            items.reduce((sum, item) => sum + item, 0) / items.length;
          return Math.abs(value - mean) <= Math.max(120, value * 0.2);
        });
        if (cluster) cluster.push(value);
        else clusters.push([value]);
      }
      for (const index of indexes) {
        const cluster = clusters.find((items) => items.includes(next[index]));
        if (cluster)
          next[index] = Math.round(
            cluster.reduce((sum, item) => sum + item, 0) / cluster.length,
          );
      }
    }
  } else {
    const frames = frameRanges(next);
    const lengths = new Set(frames.map((frame) => frame.end - frame.start));
    if (frames.length < 2 || lengths.size !== 1) return next;
    const length = frames[0].end - frames[0].start;
    const median = Array.from({ length }, (_unused, offset) => {
      const values = frames
        .map((frame) => next[frame.start + offset])
        .sort((left, right) => left - right);
      const middle = Math.floor(values.length / 2);
      return values.length % 2
        ? values[middle]
        : Math.round((values[middle - 1] + values[middle]) / 2);
    });
    for (const frame of frames) {
      for (let offset = 0; offset < length; offset++)
        next[frame.start + offset] = median[offset];
    }
  }
  return next;
};

export const makePreview = (
  kind: string,
  before: number[],
  after: number[],
  analysis: AnalysisData,
  warning = "",
  insertTimings?: number[],
): LabPreview => ({
  ...previewImpact(kind, before, after, null, analysis, warning),
  insertTimings,
});

export const formatTimingSelection = (
  timings: number[],
  start: number,
  carrierFrequency: number,
  format: Exclude<ClipboardFormat, "pronto">,
): string => {
  if (format === "json")
    return JSON.stringify({ carrier_frequency: carrierFrequency, timings });
  if (format === "unsigned") return timings.join(", ");
  return timings
    .map((duration, offset) => `${(start + offset) % 2 ? "-" : "+"}${duration}`)
    .join(" ");
};

export const parseTimingClipboard = (value: string): ClipboardParseResult => {
  const source = value.trim();
  if (!source) throw new Error("The clipboard does not contain timing data.");
  if (/^0000\s+[0-9a-f]{4}(?:\s+[0-9a-f]{4}){2,}/i.test(source)) {
    return { format: "pronto", timings: null };
  }
  if (source.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error("The JSON timing data is not valid.");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { timings?: unknown }).timings)
    ) {
      throw new Error("JSON timing data must contain a timings array.");
    }
    const timings = (parsed as { timings: unknown[] }).timings.map(Number);
    assertTimingValues(timings);
    const carrier = Number(
      (parsed as { carrier_frequency?: unknown }).carrier_frequency,
    );
    return {
      format: "json",
      timings,
      carrierFrequency:
        Number.isFinite(carrier) && carrier > 0 ? carrier : undefined,
    };
  }
  const tokens = source.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length || tokens.some((token) => !/^[+-]?\d+$/.test(token))) {
    throw new Error("Paste signed, unsigned, JSON, or Pronto timing data.");
  }
  const signed = tokens.some((token) => /^[+-]/.test(token));
  const values = tokens.map(Number);
  if (signed) {
    values.forEach((value, index) => {
      const correctSign = index % 2 === 0 ? value > 0 : value < 0;
      if (!correctSign)
        throw new Error("Signed timings must alternate +mark and -space.");
    });
  }
  const timings = values.map(Math.abs);
  assertTimingValues(timings);
  return { format: signed ? "raw_signed" : "raw_unsigned", timings };
};

export const pasteParityError = (
  start: number,
  replacedCount: number,
  insertedCount: number,
): string | null => {
  if (start % 2)
    return "Paste must begin at a mark. Select a mark or a complete pair.";
  if (replacedCount % 2 !== insertedCount % 2) {
    return "The pasted timing count must preserve mark/space parity.";
  }
  return null;
};

export const estimatedPayloadBytes = (timings: number[]): number =>
  timings.length * 2;

const assertTimingValues = (timings: number[]): void => {
  if (
    !timings.length ||
    timings.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 65_535,
    )
  ) {
    throw new Error("Every timing must be a whole number from 1 to 65,535 µs.");
  }
};
