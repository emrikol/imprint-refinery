import {
  clamp,
  editBoundary,
  timingAtTime,
  viewWindow,
} from "../../core/signal-lab";

type Point = { x: number; y: number };

interface NavigationState {
  zoom: number;
  pan: number;
  total: number;
}

interface NavigationUpdate {
  zoom: number;
  pan: number;
  anchorTime: number;
}

interface TouchBaseline extends NavigationState {
  points: Map<number, Point>;
  distance: number;
  anchorTime: number;
  rect: DOMRect;
}

export class WaveformGestureController {
  private cleanupDrag: (() => void) | null = null;
  private readonly touchPoints = new Map<number, Point>();
  private touchBaseline: TouchBaseline | null = null;

  constructor(
    private readonly navigation: () => NavigationState,
    private readonly navigate: (update: NavigationUpdate) => void,
  ) {}

  get active(): boolean {
    return this.cleanupDrag !== null;
  }

  stop(): void {
    this.cleanupDrag?.();
  }

  listen(
    move: (event: PointerEvent) => void,
    end?: (event: PointerEvent) => void,
    keydown?: (event: KeyboardEvent) => void,
  ): void {
    this.stop();
    const finish = (event: PointerEvent) => {
      if (end) end(event);
      else this.stop();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    if (keydown) document.addEventListener("keydown", keydown);
    this.cleanupDrag = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (keydown) document.removeEventListener("keydown", keydown);
      this.cleanupDrag = null;
    };
  }

  beginTouch(event: PointerEvent, rect: DOMRect): void {
    event.preventDefault();
    this.touchPoints.set(event.pointerId, pointFrom(event));
    this.touchBaseline = this.makeBaseline(rect);
    if (this.active) return;

    const move = (moveEvent: PointerEvent) => {
      if (!this.touchPoints.has(moveEvent.pointerId) || !this.touchBaseline) {
        return;
      }
      moveEvent.preventDefault();
      this.touchPoints.set(moveEvent.pointerId, pointFrom(moveEvent));
      const active = [...this.touchPoints.values()];
      const baseline = this.touchBaseline;
      if (active.length > 1) {
        const distanceNow = pointDistance(active[0], active[1]);
        const midpointNow = (active[0].x + active[1].x) / 2;
        const ratioNow = clientRatio(midpointNow, baseline.rect);
        const nextZoom = clamp(
          (baseline.zoom * distanceNow) / baseline.distance,
          1,
          16,
        );
        const span = baseline.total / nextZoom;
        const maxStart = Math.max(0, baseline.total - span);
        const start = clamp(baseline.anchorTime - ratioNow * span, 0, maxStart);
        this.navigate({
          zoom: nextZoom,
          pan: maxStart ? start / maxStart : 0,
          anchorTime: baseline.anchorTime,
        });
      } else if (active.length === 1 && baseline.zoom > 1) {
        const first = [...baseline.points.values()][0];
        const delta =
          (active[0].x - first.x) / Math.max(1, baseline.rect.width);
        this.navigate({
          zoom: baseline.zoom,
          pan: clamp(
            baseline.pan - delta / (1 - 1 / baseline.zoom),
            0,
            1,
          ),
          anchorTime: baseline.anchorTime,
        });
      }
    };
    const end = (endEvent: PointerEvent) => {
      this.touchPoints.delete(endEvent.pointerId);
      if (this.touchPoints.size) {
        this.touchBaseline = this.makeBaseline(
          this.touchBaseline?.rect || rect,
          true,
        );
        return;
      }
      this.touchBaseline = null;
      this.stop();
    };
    this.listen(move, end);
  }

  beginPan(event: PointerEvent, rect: DOMRect): void {
    event.preventDefault();
    const startX = event.clientX;
    const baseline = this.navigation();
    const move = (moveEvent: PointerEvent) => {
      const pan = clamp(
        baseline.pan -
          (moveEvent.clientX - startX) /
            Math.max(1, rect.width) /
            (1 - 1 / baseline.zoom),
        0,
        1,
      );
      const window = viewWindow([], baseline.zoom, pan, baseline.total);
      this.navigate({
        zoom: baseline.zoom,
        pan,
        anchorTime: window.start + window.span / 2,
      });
    };
    this.listen(move);
  }

  beginEdge(
    event: PointerEvent,
    rect: DOMRect,
    options: {
      timings: number[];
      index: number;
      snap: number;
      preserve: boolean;
      onPreview: (timings: number[], baseline: number[]) => void;
      onCommit: (timings: number[], baseline: number[]) => void;
      onCancel: (baseline: number[]) => void;
    },
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const baseline = [...options.timings];
    const startX = event.clientX;
    const visible = this.navigation().total / Math.max(1, this.navigation().zoom);
    let latest = baseline;
    const move = (moveEvent: PointerEvent) => {
      const delta =
        ((moveEvent.clientX - startX) / Math.max(1, rect.width)) * visible;
      const next = editBoundary(
        baseline,
        options.index,
        baseline[options.index] + delta,
        options.snap || 1,
        options.preserve,
      );
      if (!next) return;
      latest = next;
      options.onPreview(next, baseline);
    };
    const end = () => {
      this.stop();
      options.onCommit(latest, baseline);
    };
    const cancel = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      this.stop();
      options.onCancel(baseline);
    };
    this.listen(move, end, cancel);
  }

  beginCursor(
    event: PointerEvent,
    rect: DOMRect,
    index: number,
    onChange: (index: number, time: number) => void,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const state = this.navigation();
    const window = viewWindow([], state.zoom, state.pan, state.total);
    const move = (moveEvent: PointerEvent) => {
      const ratio = clientRatio(moveEvent.clientX, rect);
      onChange(index, Math.round(window.start + ratio * window.span));
    };
    move(event);
    this.listen(move);
  }

  beginRange(
    event: PointerEvent,
    rect: DOMRect,
    timings: number[],
    onChange: (start: number, end: number, reveal: boolean) => void,
  ): void {
    event.preventDefault();
    const state = this.navigation();
    const window = viewWindow(timings, state.zoom, state.pan, state.total);
    const indexAt = (clientX: number) =>
      timingAtTime(
        timings,
        window.start + clientRatio(clientX, rect) * window.span,
      );
    const start = indexAt(event.clientX);
    onChange(start, start, true);
    this.listen((moveEvent) => {
      onChange(start, indexAt(moveEvent.clientX), false);
    });
  }

  beginMinimap(event: PointerEvent, rect: DOMRect): void {
    const state = this.navigation();
    if (state.zoom <= 1) return;
    event.preventDefault();
    const span = 1 / state.zoom;
    const currentStart = state.pan * (1 - span);
    const initialRatio = clientRatio(event.clientX, rect);
    const grab =
      initialRatio >= currentStart && initialRatio <= currentStart + span
        ? initialRatio - currentStart
        : span / 2;
    const move = (moveEvent: PointerEvent) => {
      const ratio = clientRatio(moveEvent.clientX, rect);
      const start = clamp(ratio - grab, 0, 1 - span);
      const pan = start / Math.max(Number.EPSILON, 1 - span);
      const window = viewWindow([], state.zoom, pan, state.total);
      this.navigate({
        zoom: state.zoom,
        pan,
        anchorTime: window.start + window.span / 2,
      });
    };
    move(event);
    this.listen(move);
  }

  private makeBaseline(rect: DOMRect, center = false): TouchBaseline {
    const state = this.navigation();
    const points = [...this.touchPoints.values()];
    const distance =
      points.length > 1 ? pointDistance(points[0], points[1]) : 1;
    const midpoint =
      points.length > 1 ? (points[0].x + points[1].x) / 2 : points[0].x;
    const ratio = center ? 0.5 : clientRatio(midpoint, rect);
    const current = viewWindow([], state.zoom, state.pan, state.total);
    return {
      ...state,
      points: new Map(this.touchPoints),
      distance,
      anchorTime: current.start + ratio * current.span,
      rect,
    };
  }
}

function pointFrom(event: PointerEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

function pointDistance(first: Point, second: Point): number {
  return Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
}

function clientRatio(clientX: number, rect: DOMRect): number {
  return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
}
