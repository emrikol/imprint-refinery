import type { AnalysisData, LabPreview, LabState, LabSnapshot } from "../types";

export const timingTotal = (timings: number[]): number =>
  timings.reduce((sum, value) => sum + Number(value || 0), 0);
export const timingsEqual = (left: number[], right: number[]): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export interface FrameRange {
  start: number;
  end: number;
  gapIndex: number | null;
}
export const frameRanges = (timings: number[]): FrameRange[] => {
  const ranges: FrameRange[] = [];
  let start = 0;
  for (let index = 1; index < timings.length; index += 2) {
    if (timings[index] < 10_000 || index + 1 >= timings.length) continue;
    ranges.push({ start, end: index + 1, gapIndex: index });
    start = index + 1;
  }
  if (start < timings.length)
    ranges.push({ start, end: timings.length, gapIndex: null });
  return ranges;
};

export const snapshot = (lab: LabState): LabSnapshot => ({
  timings: [...lab.timings],
  frameRoles: [...lab.frameRoles],
  carrierFrequency: lab.carrierFrequency,
});

export const draftDirty = (lab: LabState): boolean =>
  !timingsEqual(lab.timings, lab.original) ||
  JSON.stringify(lab.frameRoles) !== JSON.stringify(lab.originalFrameRoles) ||
  lab.carrierFrequency !== lab.originalCarrierFrequency;

export interface Validation {
  valid: boolean;
  compatible: boolean;
  issues: string[];
  total: number;
  evidence: string;
}

export const validateDraft = (
  timings: number[],
  carrier: number,
  analysis: AnalysisData = {},
  dirty = false,
): Validation => {
  const issues: string[] = [];
  if (!timings.length) issues.push("A signal needs at least one timing.");
  if (
    timings.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 65_535,
    )
  )
    issues.push("Every timing must be a whole number from 1 to 65,535 µs.");
  if (carrier < 30_000 || carrier > 60_000)
    issues.push("The carrier is outside the usual IR range.");
  if ((analysis.warnings || []).includes("carrier_frequency_mismatch"))
    issues.push(
      "The supplied carrier differs from the decoded protocol carrier.",
    );
  if (dirty && (analysis.evidence_class || analysis.confidence))
    issues.push(
      "Recognition describes the protected source and must be rechecked for this draft.",
    );
  return {
    valid: !issues.some(
      (issue) =>
        issue.startsWith("A signal") || issue.startsWith("Every timing"),
    ),
    compatible: !issues.some((issue) => issue.includes("1 to 65,535")),
    issues,
    total: timingTotal(timings),
    evidence: analysis.evidence_class || analysis.confidence || "unknown",
  };
};

export const previewImpact = (
  kind: string,
  before: number[],
  after: number[],
  encodedTimings: number[] | null,
  analysis: AnalysisData = {},
  warning = "",
): LabPreview => {
  const common = Math.min(before.length, after.length);
  let maxTimingError = 0;
  let changed = Math.abs(before.length - after.length);
  for (let index = 0; index < common; index++) {
    const delta = Math.abs(before[index] - after[index]);
    maxTimingError = Math.max(maxTimingError, delta);
    if (delta) changed++;
  }
  const roundTripChanges =
    encodedTimings == null
      ? null
      : Math.max(encodedTimings.length, after.length) -
        encodedTimings.filter((value, index) => value === after[index]).length;
  return {
    kind,
    timings: [...after],
    changed,
    durationDelta: timingTotal(after) - timingTotal(before),
    maxTimingError,
    frameDelta: frameRanges(after).length - frameRanges(before).length,
    roundTripChanges,
    evidenceClass: analysis.evidence_class || analysis.confidence || "unknown",
    protocol: analysis.protocol || analysis.protocol_name,
    compatible: true,
    warning,
  };
};
