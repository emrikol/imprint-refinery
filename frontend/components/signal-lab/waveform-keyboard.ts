import { clamp } from "../../core/signal-lab";

export type WaveformKeyboardTarget =
  | { kind: "timing"; index: number }
  | { kind: "cursor"; index: 0 | 1 };

export type WaveformKeyboardAction =
  | { kind: "select"; index: number }
  | { kind: "nudge"; index: number; amount: number }
  | { kind: "cursor"; index: 0 | 1; time: number };

export type WaveformKeyboardResult = {
  handled: boolean;
  target: WaveformKeyboardTarget;
  action?: WaveformKeyboardAction;
};

type WaveformKeyboardInput = {
  key: string;
  shiftKey: boolean;
  target: WaveformKeyboardTarget;
  timingCount: number;
  cursors: readonly [number, number];
  showCursors: boolean;
  selected: number;
  snap: number;
  total: number;
};

export function normalizeWaveformTarget(
  target: WaveformKeyboardTarget,
  timingCount: number,
  showCursors: boolean,
): WaveformKeyboardTarget {
  if (target.kind === "cursor" && showCursors) return target;
  return {
    kind: "timing",
    index: Math.round(clamp(target.index, 0, Math.max(0, timingCount - 1))),
  };
}

export function waveformKeyboardCommand({
  key,
  shiftKey,
  target: requestedTarget,
  timingCount,
  cursors,
  showCursors,
  selected,
  snap,
  total,
}: WaveformKeyboardInput): WaveformKeyboardResult {
  const target = normalizeWaveformTarget(
    requestedTarget,
    timingCount,
    showCursors,
  );
  const normalizedKey = key.toLowerCase();

  if (showCursors && (normalizedKey === "a" || normalizedKey === "b")) {
    const index = normalizedKey === "b" ? 1 : 0;
    return {
      handled: true,
      target: { kind: "cursor", index },
    };
  }

  if (normalizedKey === "t") {
    const index =
      target.kind === "timing"
        ? target.index
        : Math.round(clamp(selected, 0, timingCount - 1));
    return {
      handled: true,
      target: { kind: "timing", index },
      action: { kind: "select", index },
    };
  }

  if (target.kind === "cursor") {
    if (![
      "ArrowLeft",
      "ArrowRight",
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
    ].includes(key)) {
      return { handled: false, target };
    }
    const direction = ["ArrowRight", "ArrowUp"].includes(key) ? 1 : -1;
    const time =
      key === "Home"
        ? 0
        : key === "End"
          ? total
          : clamp(
              cursors[target.index] +
                Math.max(1, snap) * (shiftKey ? 10 : 1) * direction,
              0,
              total,
            );
    return {
      handled: true,
      target,
      action: { kind: "cursor", index: target.index, time },
    };
  }

  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) {
    const index =
      key === "Home"
        ? 0
        : key === "End"
          ? Math.max(0, timingCount - 1)
          : Math.round(
              clamp(
                target.index + (key === "ArrowRight" ? 1 : -1),
                0,
                Math.max(0, timingCount - 1),
              ),
            );
    return {
      handled: true,
      target: { kind: "timing", index },
      action: { kind: "select", index },
    };
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const amount =
      Math.max(1, snap) *
      (shiftKey ? 10 : 1) *
      (key === "ArrowUp" ? 1 : -1);
    return {
      handled: true,
      target,
      action: { kind: "nudge", index: target.index, amount },
    };
  }

  if (key === "Enter" || key === " ") {
    return {
      handled: true,
      target,
      action: { kind: "select", index: target.index },
    };
  }

  return { handled: false, target };
}
