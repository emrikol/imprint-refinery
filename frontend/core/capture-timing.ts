export const CAPTURE_ARMING_GRACE_SECONDS = 5;

export interface CaptureTimingState {
  promptActive: boolean;
  remaining: number;
  expired: boolean;
}

/**
 * Give preparation and listening distinct windows on one absolute deadline.
 * Capture starts immediately, so a signal received during preparation is valid.
 */
export const captureTimingState = (
  startedAtMs: number,
  nowMs: number,
  captureWindowSeconds: number,
): CaptureTimingState => {
  const captureWindow = Math.max(
    1,
    Math.floor(Number(captureWindowSeconds) || 60),
  );
  const elapsedSeconds = Math.max(0, nowMs - startedAtMs) / 1000;
  const totalSeconds = captureWindow + CAPTURE_ARMING_GRACE_SECONDS;
  const remaining = Math.max(
    0,
    Math.min(captureWindow, Math.ceil(totalSeconds - elapsedSeconds)),
  );

  return {
    promptActive: elapsedSeconds >= CAPTURE_ARMING_GRACE_SECONDS,
    remaining,
    expired: elapsedSeconds >= totalSeconds,
  };
};
