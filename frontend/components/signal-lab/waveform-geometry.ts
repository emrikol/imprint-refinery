import type { AnalysisData } from "../../types";
import { frameRanges } from "../../core/signal";
import { waveGeometry } from "../../core/signal-lab";

export interface DensityBucket {
  x: number;
  width: number;
  height: number;
}

export function axisTicks(start: number, end: number): number[] {
  const span = Math.max(1, end - start);
  const rough = span / 8;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10) * magnitude;
  const ticks = [start];
  for (let time = Math.ceil(start / step) * step; time < end; time += step) {
    if (time - start > step * 0.4 && end - time > step * 0.4) ticks.push(time);
  }
  ticks.push(end);
  return ticks;
}

export function axisLabel(time: number): string {
  if (time >= 1000) {
    const milliseconds = time / 1000;
    return `${
      milliseconds >= 10
        ? milliseconds.toFixed(1).replace(/\.0$/, "")
        : milliseconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
    } ms`;
  }
  return `${Math.round(time)} µs`;
}

export function densityBuckets(
  timings: number[],
  start: number,
  end: number,
  offsets: number[],
  total: number,
  range: number,
): DensityBucket[] {
  const bucketSize = Math.max(1, Math.ceil((end - start) / 500));
  const result: DensityBucket[] = [];
  for (let index = start; index < end; index += bucketSize) {
    const stop = Math.min(end, index + bucketSize);
    let marks = 0;
    let duration = 0;
    for (let cursor = index; cursor < stop; cursor++) {
      duration += timings[cursor];
      if (cursor % 2 === 0) marks += timings[cursor];
    }
    result.push({
      x: (offsets[index] / total) * 1000,
      width: Math.max(1, ((offsets[stop] - offsets[index]) / total) * 1000),
      height: Math.max(8, duration ? (marks / duration) * range : 8),
    });
  }
  return result;
}

export function minimapPath(timings: number[], total: number): string {
  if (timings.length > 800) {
    const geometry = waveGeometry(timings, 1, 0, total, 400);
    return densityBuckets(
      timings,
      0,
      timings.length,
      geometry.offsets,
      total,
      32,
    )
      .map(
        (bucket, index) =>
          `${index ? "L" : "M"} ${bucket.x + bucket.width} ${42 - bucket.height}`,
      )
      .join(" ");
  }
  let elapsed = 0;
  let path = "M 0 42 V 10";
  timings.forEach((duration, index) => {
    elapsed += duration;
    path += ` H ${((elapsed / total) * 1000).toFixed(3)}`;
    if (index < timings.length - 1) path += ` V ${index % 2 ? 10 : 42}`;
  });
  if (timings.length % 2) path += " V 42";
  return path;
}

export function resolvedFrameRole(
  index: number,
  frameCount: number,
  frameRoles: string[],
  analysis: AnalysisData,
): string {
  const manual = frameRoles[index];
  if (manual && manual !== "auto") return manual;
  const roles = Array.isArray(analysis.frame_roles) ? analysis.frame_roles : [];
  const frames = Array.isArray(analysis.frames) ? analysis.frames : [];
  if (roles.length !== frameCount && frames.length !== frameCount) return "";
  const role = roles.find(
    (item) => Number((item as { index?: unknown }).index) === index,
  ) as { role?: string } | undefined;
  if (role?.role && role.role !== "unclassified") return role.role;
  if (
    index > 0 &&
    (frames[index] as { group?: unknown })?.group ===
      (frames[0] as { group?: unknown })?.group
  ) {
    return "repeat";
  }
  return index === 0 && frameCount > 1 ? "intro" : "";
}

export interface TrackGeometry {
  geometry: ReturnType<typeof waveGeometry>;
  high: number;
  low: number;
  height: number;
  path: string;
  segments: number[];
  density: DensityBucket[];
  visibleFrames: Array<{
    start: number;
    end: number;
    index: number;
    startTime: number;
    endTime: number;
  }>;
  frameCount: number;
  showBefore: boolean;
  showAfter: boolean;
  boundaryClasses: string;
  idlePercent: number;
  markPercent: number;
  ticks: number[];
}

export function trackGeometry(
  timings: number[],
  total: number,
  zoom: number,
  pan: number,
  compare: boolean,
  includeFrames: boolean,
): TrackGeometry {
  const geometry = waveGeometry(timings, zoom, pan, total);
  const high = compare ? 24 : 30;
  const low = compare ? 92 : 136;
  const height = compare ? 112 : 162;
  const showBefore = geometry.view.start <= Number.EPSILON;
  const showAfter = geometry.view.end >= geometry.view.total - Number.EPSILON;
  let path = "";
  if (geometry.detailed && timings.length) {
    const firstX = (geometry.offsets[geometry.first] / geometry.view.total) * 1000;
    path =
      geometry.first === 0
        ? `M 0 ${low} V ${high}`
        : `M ${firstX.toFixed(3)} ${geometry.first % 2 ? low : high}`;
    for (let index = geometry.first; index < geometry.last; index++) {
      const nextX =
        (geometry.offsets[index + 1] / geometry.view.total) * 1000;
      path += ` H ${nextX.toFixed(3)}`;
      if (index < timings.length - 1 && index < geometry.last - 1) {
        path += ` V ${index % 2 ? high : low}`;
      }
    }
  }
  if (path && showAfter && geometry.last >= timings.length) {
    if (timings.length % 2) {
      path += ` V ${low}`;
    }
    path += " H 1000";
  }
  const segments = geometry.detailed
    ? Array.from(
        { length: geometry.last - geometry.first },
        (_unused, offset) => geometry.first + offset,
      )
    : [];
  const density = geometry.detailed
    ? []
    : densityBuckets(
        timings,
        geometry.first,
        geometry.last,
        geometry.offsets,
        total,
        low - high,
      );
  const frames = includeFrames ? frameRanges(timings) : [];
  const visibleFrames = frames
    .map((frame, index) => ({
      ...frame,
      index,
      startTime: geometry.offsets[frame.start] || 0,
      endTime: geometry.offsets[frame.end] ?? geometry.signalTotal,
    }))
    .filter(
      (frame) =>
        frame.endTime >= geometry.view.start &&
        frame.startTime <= geometry.view.end,
    )
    .slice(0, 80);
  return {
    geometry,
    high,
    low,
    height,
    path,
    segments,
    density,
    visibleFrames,
    frameCount: frames.length,
    showBefore,
    showAfter,
    boundaryClasses: `${showBefore ? "has-before" : ""} ${showAfter ? "has-after" : ""}`,
    idlePercent: (low / height) * 100,
    markPercent: (high / height) * 100,
    ticks: axisTicks(geometry.view.start, geometry.view.end),
  };
}
