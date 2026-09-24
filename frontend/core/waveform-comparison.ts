import { timingTotal } from "./signal";
import { timingAtTime } from "./signal-lab";

export interface WaveformComparisonSignal {
  label: string;
  timings: readonly number[];
  carrierFrequency?: number | null;
}

export type WaveformTimingChangeKind = "changed" | "inserted" | "removed";

export interface WaveformTimingChange {
  key: string;
  kind: WaveformTimingChangeKind;
  role: "mark" | "space";
  beforeIndex: number | null;
  afterIndex: number | null;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface WaveformComparisonResult {
  beforeTotal: number;
  afterTotal: number;
  sharedTotal: number;
  countDelta: number;
  durationDelta: number;
  carrierDelta: number | null;
  structureChanged: boolean;
  changes: WaveformTimingChange[];
}

export interface WaveformProbeValue {
  index: number;
  role: "mark" | "space";
  duration: number;
}

export interface WaveformComparisonProbe {
  time: number;
  percent: number;
  before: WaveformProbeValue | null;
  after: WaveformProbeValue | null;
  delta: number | null;
}

interface TimingPair {
  index: number;
  values: number[];
}

type PairAlignment = {
  before: TimingPair | null;
  after: TimingPair | null;
};

const MAX_ALIGNED_PAIRS = 400;

const pairsFor = (timings: readonly number[]): TimingPair[] => {
  const pairs: TimingPair[] = [];
  for (let index = 0; index < timings.length; index += 2) {
    pairs.push({ index, values: timings.slice(index, index + 2).map(Number) });
  }
  return pairs;
};

const pairCost = (before: TimingPair, after: TimingPair): number => {
  if (
    before.values.length === after.values.length &&
    before.values.every((value, index) => value === after.values[index])
  ) {
    return 0;
  }
  if (before.values.length !== after.values.length) return 2.1;
  const relativeError = before.values.reduce((total, value, index) => {
    const candidate = after.values[index];
    return total + Math.abs(value - candidate) / Math.max(value, candidate, 1);
  }, 0) / before.values.length;
  return Math.min(2.1, 0.2 + relativeError * 3);
};

const alignPairs = (
  beforeTimings: readonly number[],
  afterTimings: readonly number[],
): PairAlignment[] => {
  const before = pairsFor(beforeTimings);
  const after = pairsFor(afterTimings);
  if (before.length === after.length) {
    return before.map((pair, index) => ({ before: pair, after: after[index] }));
  }
  if (
    before.length > MAX_ALIGNED_PAIRS ||
    after.length > MAX_ALIGNED_PAIRS
  ) {
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_unused, index) => ({ before: before[index] || null, after: after[index] || null }),
    );
  }

  const gapCost = 1;
  const columns = after.length + 1;
  const scores = new Float64Array((before.length + 1) * columns);
  const steps = new Uint8Array(scores.length);
  const at = (row: number, column: number) => row * columns + column;
  for (let row = 1; row <= before.length; row++) {
    scores[at(row, 0)] = row * gapCost;
    steps[at(row, 0)] = 2;
  }
  for (let column = 1; column <= after.length; column++) {
    scores[at(0, column)] = column * gapCost;
    steps[at(0, column)] = 3;
  }
  for (let row = 1; row <= before.length; row++) {
    for (let column = 1; column <= after.length; column++) {
      const substitution =
        scores[at(row - 1, column - 1)] +
        pairCost(before[row - 1], after[column - 1]);
      const removal = scores[at(row - 1, column)] + gapCost;
      const insertion = scores[at(row, column - 1)] + gapCost;
      const best = Math.min(substitution, removal, insertion);
      scores[at(row, column)] = best;
      steps[at(row, column)] =
        substitution <= best + Number.EPSILON
          ? 1
          : removal <= insertion
            ? 2
            : 3;
    }
  }

  const alignment: PairAlignment[] = [];
  let row = before.length;
  let column = after.length;
  while (row || column) {
    const step = steps[at(row, column)];
    if (row && column && step === 1) {
      alignment.push({ before: before[--row], after: after[--column] });
    } else if (row && (!column || step === 2)) {
      alignment.push({ before: before[--row], after: null });
    } else {
      alignment.push({ before: null, after: after[--column] });
    }
  }
  return alignment.reverse();
};

const changesForAlignment = (
  alignment: PairAlignment[],
): WaveformTimingChange[] => {
  const changes: WaveformTimingChange[] = [];
  for (const pair of alignment) {
    const width = Math.max(
      pair.before?.values.length || 0,
      pair.after?.values.length || 0,
    );
    for (let offset = 0; offset < width; offset++) {
      const before = pair.before?.values[offset] ?? null;
      const after = pair.after?.values[offset] ?? null;
      if (before === after) continue;
      const beforeIndex = pair.before ? pair.before.index + offset : null;
      const afterIndex = pair.after ? pair.after.index + offset : null;
      const index = afterIndex ?? beforeIndex ?? offset;
      changes.push({
        key: `${beforeIndex ?? "x"}:${afterIndex ?? "x"}`,
        kind: before == null ? "inserted" : after == null ? "removed" : "changed",
        role: index % 2 ? "space" : "mark",
        beforeIndex,
        afterIndex,
        before,
        after,
        delta: before == null || after == null ? null : after - before,
      });
    }
  }
  return changes;
};

export const compareWaveforms = (
  before: WaveformComparisonSignal,
  after: WaveformComparisonSignal,
): WaveformComparisonResult => {
  const beforeTotal = timingTotal([...before.timings]);
  const afterTotal = timingTotal([...after.timings]);
  const beforeCarrier = Number(before.carrierFrequency || 0);
  const afterCarrier = Number(after.carrierFrequency || 0);
  return {
    beforeTotal,
    afterTotal,
    sharedTotal: Math.max(beforeTotal, afterTotal),
    countDelta: after.timings.length - before.timings.length,
    durationDelta: afterTotal - beforeTotal,
    carrierDelta:
      beforeCarrier && afterCarrier ? afterCarrier - beforeCarrier : null,
    structureChanged: before.timings.length !== after.timings.length,
    changes: changesForAlignment(alignPairs(before.timings, after.timings)),
  };
};

const probeValue = (
  timings: readonly number[],
  time: number,
): WaveformProbeValue | null => {
  const total = timingTotal([...timings]);
  if (!timings.length || time > total) return null;
  const index = timingAtTime([...timings], time);
  return {
    index,
    role: index % 2 ? "space" : "mark",
    duration: Number(timings[index]) || 0,
  };
};

export const comparisonProbeAt = (
  before: WaveformComparisonSignal,
  after: WaveformComparisonSignal,
  time: number,
): WaveformComparisonProbe => {
  const sharedTotal = Math.max(
    timingTotal([...before.timings]),
    timingTotal([...after.timings]),
    1,
  );
  const safeTime = Math.max(0, Math.min(Number(time) || 0, sharedTotal));
  const beforeValue = probeValue(before.timings, safeTime);
  const afterValue = probeValue(after.timings, safeTime);
  return {
    time: safeTime,
    percent: (safeTime / sharedTotal) * 100,
    before: beforeValue,
    after: afterValue,
    delta:
      beforeValue && afterValue
        ? afterValue.duration - beforeValue.duration
        : null,
  };
};
