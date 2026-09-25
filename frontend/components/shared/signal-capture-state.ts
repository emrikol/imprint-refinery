import { css, html, type CSSResult, type TemplateResult } from "lit";

export interface SignalCaptureStateOptions {
  phase: "listening" | "processing";
  active?: boolean;
  receiverName?: string;
  remaining?: number;
  timeout?: number;
  listeningContent: string | TemplateResult;
  processingContent?: string | TemplateResult;
  processingLabel?: string;
}

export const signalCaptureStateStyles: CSSResult = css`
  .irf-signal-capture-state {
    display: grid;
    justify-items: center;
    min-width: 0;
    padding: 22px 18px 8px;
    text-align: center;
  }
  .irf-signal-capture-mark {
    display: grid;
    place-items: center;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
  }
  .irf-signal-capture-mark ha-icon { --mdc-icon-size: 34px; }
  .irf-signal-capture-state.listening.active .irf-signal-capture-mark {
    animation: irf-capture-breathe 1.5s ease-in-out infinite;
  }
  .irf-signal-capture-status {
    max-width: 48ch;
    margin: 12px 0 0;
    color: var(--imprint-muted);
    line-height: 1.5;
  }
  .irf-signal-capture-motif {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    width: min(300px, 86%);
    height: 54px;
    margin: 18px auto 12px;
    overflow: hidden;
  }
  .irf-signal-capture-motif::after {
    content: "";
    position: absolute;
    inset: 50% 0 auto;
    height: 2px;
    border-radius: 2px;
    background: var(--imprint-accent);
    opacity: 0;
    transform: scaleX(.18);
    transition: opacity 160ms ease, transform 240ms cubic-bezier(.16, 1, .3, 1);
  }
  .irf-signal-capture-motif i {
    width: 4px;
    height: 34px;
    border-radius: 4px;
    background: var(--imprint-accent);
    opacity: .72;
    transform: scaleY(.18);
    transform-origin: center;
  }
  .irf-signal-capture-motif.listening.active i {
    animation: irf-capture-listen 940ms ease-in-out infinite alternate;
  }
  .irf-signal-capture-motif i:nth-child(2n) {
    animation-duration: 1.28s;
    animation-delay: -.72s;
  }
  .irf-signal-capture-motif i:nth-child(3n) {
    animation-duration: .76s;
    animation-delay: -.31s;
  }
  .irf-signal-capture-motif i:nth-child(4n) {
    animation-duration: 1.46s;
    animation-delay: -.93s;
  }
  .irf-signal-capture-motif i:nth-child(5n) {
    animation-duration: 1.08s;
    animation-delay: -.54s;
  }
  .irf-signal-capture-motif.processing i {
    opacity: 0;
    transform: scaleY(.04);
  }
  .irf-signal-capture-motif.processing::after {
    opacity: .72;
    transform: scaleX(1);
  }
  .irf-signal-capture-countdown {
    position: relative;
    display: grid;
    place-items: center;
    width: 138px;
    height: 138px;
    margin-top: 6px;
    border-radius: 50%;
    background: conic-gradient(
      var(--imprint-accent) 0 var(--irf-capture-progress),
      color-mix(in srgb, var(--imprint-muted) 32%, transparent) 0
    );
    font-variant-numeric: tabular-nums;
  }
  .irf-signal-capture-countdown::before {
    content: "";
    position: absolute;
    inset: 10px;
    border-radius: inherit;
    background: var(--imprint-surface);
  }
  .irf-signal-capture-countdown-copy {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
  }
  .irf-signal-capture-countdown strong { font-size: 30px; line-height: 1; }
  .irf-signal-capture-countdown span {
    width: 78px;
    margin-top: 6px;
    color: var(--imprint-muted);
    font-size: 11px;
    line-height: 1.1;
  }
  @keyframes irf-capture-listen {
    from { transform: scaleY(.12); opacity: .38; }
    to { transform: scaleY(1); opacity: .92; }
  }
  @keyframes irf-capture-breathe {
    50% {
      transform: scale(1.05);
      box-shadow: 0 0 0 14px color-mix(
        in srgb,
        var(--imprint-accent) 7%,
        transparent
      );
    }
  }
  @media (max-width: 520px) {
    .irf-signal-capture-state { padding-inline: 4px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .irf-signal-capture-state.listening.active .irf-signal-capture-mark,
    .irf-signal-capture-motif.listening.active i { animation: none; }
    .irf-signal-capture-motif.listening.active i {
      transform: scaleY(.42);
      opacity: .68;
    }
  }
`;

const renderCaptureMotif = (
  phase: "listening" | "processing",
  active: boolean,
): TemplateResult => html`
  <div
    class=${`irf-signal-capture-motif ${phase} ${active ? "active" : ""}`}
    aria-hidden="true"
  >
    ${Array.from({ length: 18 }, () => html`<i></i>`)}
  </div>
`;

export const renderSignalCaptureState = ({
  phase,
  active = true,
  receiverName = "the selected IR receiver",
  remaining = 0,
  timeout = 60,
  listeningContent,
  processingContent = "Preparing the captured signal…",
  processingLabel = "Preparing captured signal",
}: SignalCaptureStateOptions): TemplateResult => {
  const duration = Math.max(1, Number(timeout) || 60);
  const seconds = Math.max(0, Math.min(duration, Number(remaining) || 0));
  const progress = Math.round((seconds / duration) * 360);
  const listening = phase === "listening";
  const deadlineReached = listening && active && seconds === 0;
  const status = deadlineReached
    ? "Finishing the capture session…"
    : listening
      ? active
        ? listeningContent
        : `Preparing ${receiverName} for capture…`
      : processingContent;

  return html`<section
    class=${`irf-signal-capture-state ${phase} ${active ? "active" : ""}`}
    data-capture-phase=${phase}
  >
    <div class="irf-signal-capture-mark" aria-hidden="true">
      <ha-icon icon=${listening ? "mdi:remote" : "mdi:square-wave"}></ha-icon>
    </div>
    <p class="irf-signal-capture-status" role="status" aria-live="polite">
      ${status}
    </p>
    ${renderCaptureMotif(phase, active)}
    ${
      listening && active && !deadlineReached
        ? html`<div
            class="irf-signal-capture-countdown"
            style=${`--irf-capture-progress: ${progress}deg`}
            aria-hidden="true"
          >
            <div class="irf-signal-capture-countdown-copy">
              <strong>${seconds}s</strong>
              <span>seconds remaining</span>
            </div>
          </div>`
          : html`<ha-spinner aria-label=${
            deadlineReached
              ? "Finishing the capture session"
              : listening
                ? `Preparing ${receiverName} for capture`
                : processingLabel
          }></ha-spinner>`
    }
  </section>`;
};
