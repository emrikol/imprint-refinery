import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { AnalysisData, Emitter } from "../types";
import {
  copyText,
  evidenceLabel,
  formatDuration,
  trapTabKey,
} from "../core/utils";
import { safeCustomElement } from "../core/registration";
import { tokens } from "../styles";

@safeCustomElement("imprint-feedback")
export class ImprintFeedback extends LitElement {
  @property() message = "";
  @property() detail = "";
  @property() kind: "info" | "success" | "error" = "info";
  @property({ type: Boolean }) dismissible = false;
  @state() private copyStatus = "";
  static styles = [
    tokens,
    css`
    :host { display: block; }
    .feedback { display: flex; gap: 9px; align-items: flex-start; padding: 11px 14px; border-radius: 10px; background: var(--imprint-accent-soft); }
    .feedback > div { min-width: 0; flex: 1; }
    .success { background: color-mix(in srgb, var(--imprint-success) 11%, transparent); color: var(--imprint-success); }
    .error { background: color-mix(in srgb, var(--imprint-danger) 10%, transparent); color: var(--imprint-danger); }
    .dismiss { flex: 0 0 auto; width: 44px; min-width: 44px; min-height: 44px; margin: -7px -9px -7px 0; border: 0; background: transparent; }
    details { margin-top: 6px; color: var(--imprint-muted); } code { display: block; margin-top: 5px; overflow-wrap: anywhere; } .detail-actions { display: flex; gap: 8px; align-items: center; margin-top: 7px; }
  `,
  ];
  render() {
    if (!this.message) return nothing;
    return html`<div class="feedback ${this.kind}" role=${this.kind === "error" ? "alert" : "status"} aria-live=${this.kind === "error" ? "assertive" : "polite"}>
      <ha-icon icon=${this.kind === "error" ? "mdi:alert-circle-outline" : this.kind === "success" ? "mdi:check-circle-outline" : "mdi:information-outline"}></ha-icon>
      <div><strong>${this.message}</strong>${this.detail && this.detail !== this.message ? html`<details><summary>Technical details</summary><code>${this.detail}</code><div class="detail-actions"><button class="btn" @click=${() => void this.copyDetails()}><ha-icon icon="mdi:content-copy"></ha-icon>Copy details</button><span role="status" aria-live="polite">${this.copyStatus}</span></div></details>` : nothing}</div>
      ${this.dismissible ? html`<button class="btn icon dismiss" title="Dismiss error" aria-label="Dismiss error notification" @click=${() => this.dispatchEvent(new CustomEvent("feedback-dismiss", { bubbles: true, composed: true }))}><ha-icon icon="mdi:close"></ha-icon></button>` : nothing}
    </div>`;
  }
  private async copyDetails() {
    try {
      await copyText(this.detail);
      this.copyStatus = "Copied";
    } catch {
      this.copyStatus = "Copy failed";
    }
  }
}

@safeCustomElement("imprint-status")
export class ImprintStatus extends LitElement {
  @property() state = "idle";
  @property({ type: Boolean }) busy = false;
  static styles = [
    tokens,
    css`
    :host { display: inline-flex; }
    span { display: inline-flex; align-items: center; gap: 7px; color: var(--imprint-muted); font-size: 13px; font-weight: 650; }
    i { width: 8px; height: 8px; border-radius: 50%; background: var(--imprint-success); }
    .busy i { background: var(--imprint-warning); animation: pulse 1.2s ease-in-out infinite; }
    .error i { background: var(--imprint-danger); }
    @keyframes pulse { 50% { opacity: .35; transform: scale(.8); } }
  `,
  ];
  render() {
    const errors = [
      "error",
      "delivery_failed",
      "expired",
      "queue_full",
      "stopped",
      "unavailable",
    ];
    const processing =
      this.busy ||
      ["capturing", "sending", "queued", "dispatching"].includes(this.state);
    const label = processing
      ? this.state === "capturing"
        ? "Capturing"
        : "Working"
      : this.state === "unavailable"
        ? "Unavailable"
        : errors.includes(this.state)
          ? "Needs attention"
          : "Ready";
    return html`<span class=${errors.includes(this.state) ? "error" : processing ? "busy" : ""} title=${`Emitter status: ${this.state}`}><i></i>${label}</span>`;
  }
}

@safeCustomElement("imprint-emitter-picker")
export class ImprintEmitterPicker extends LitElement {
  @property({ attribute: false }) emitters: Emitter[] = [];
  @property() selected = "";
  @property() state = "idle";
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) showLearn = false;
  static styles = [
    tokens,
    css`
    :host { display: block; }
    .bar { min-height: 64px; display: flex; gap: 12px; align-items: center; padding: 10px 13px; border: 1px solid var(--imprint-line); border-radius: var(--imprint-radius); background: var(--imprint-surface); }
    .bar > ha-icon { color: var(--imprint-accent); font-size: 23px; }
    .copy { display: flex; gap: 8px; align-items: center; min-width: 0; margin-right: auto; }
    .copy .eyebrow { display: none; }
    .copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    select { min-height: 44px; max-width: 220px; border: 1px solid var(--imprint-line); border-radius: 9px; background: var(--imprint-surface); padding: 7px 9px; }
    @media (max-width: 620px) { .bar { align-items: center; flex-wrap: wrap; } .copy { width: calc(100% - 42px); } select, .btn { flex: 1; max-width: none; } imprint-status { margin-left: 35px; } }
  `,
  ];
  render() {
    const enabled = this.emitters.filter((item) => item.enabled !== false);
    const active = enabled.find((item) => item.key === this.selected);
    const ready = active && (active as any).available !== false;
    return html`<div class="bar" aria-label="Active IR emitter">
      <ha-icon icon="mdi:remote"></ha-icon>
      <div class="copy"><span class="eyebrow">Active emitter</span><strong>${active?.name || active?.entity_id || active?.key || "No emitter available"}</strong></div>
      ${enabled.length > 1 ? html`<label><span class="sr-only">Change emitter</span><select .value=${this.selected} ?disabled=${this.busy} @change=${(event: Event) => this.dispatchEvent(new CustomEvent("emitter-change", { detail: { emitterId: (event.target as HTMLSelectElement).value }, bubbles: true, composed: true }))}>${enabled.map((tx) => html`<option value=${tx.key}>${tx.name || tx.entity_id || tx.key}</option>`)}</select></label>` : nothing}
      <imprint-status .state=${ready ? this.state : "unavailable"} .busy=${this.busy}></imprint-status>
      ${this.showLearn ? html`<button class="btn primary" ?disabled=${!ready || this.busy} @click=${() => this.dispatchEvent(new CustomEvent("learn-request", { bubbles: true, composed: true }))}><ha-icon icon="mdi:plus"></ha-icon>Learn command</button>` : nothing}
    </div>`;
  }
}

@safeCustomElement("imprint-waveform")
export class ImprintWaveform extends LitElement {
  @property({ attribute: false }) timings: number[] = [];
  @property({ type: Number }) zoom = 1;
  @property({ type: Number }) pan = 0;
  @property() label = "IR timing waveform";
  @property({ type: Number }) selected = -1;
  @property({ type: Boolean }) reveal = false;
  static styles = [
    tokens,
    css`
    :host { display: block; }
    .wrap { height: 132px; overflow: hidden; border: 1px solid var(--imprint-line); border-radius: 12px; background: var(--imprint-surface-2); }
    svg { width: 100%; height: 100%; display: block; }
    .wrap.reveal svg { animation: reveal-wave 460ms cubic-bezier(.16,1,.3,1) both; }
    path { fill: none; stroke: var(--imprint-accent); stroke-width: 3; }
    .gaps rect { fill: color-mix(in srgb, var(--imprint-warning) 15%, transparent); }
    .empty { min-height: 132px; display: grid; place-items: center; color: var(--imprint-muted); }
    @keyframes reveal-wave { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0); } }
    @media (prefers-reduced-motion: reduce) { .wrap.reveal svg { animation: none; } }
  `,
  ];
  render() {
    const values = this.timings
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length)
      return html`<div class="empty">Signal preview unavailable</div>`;
    const width = 1000,
      high = 24,
      low = 102,
      total = values.reduce((a, b) => a + b, 0);
    let x = 0,
      path = `M 0 ${low} V ${high}`;
    const gaps: Array<{ x: number; width: number }> = [];
    values.forEach((duration, index) => {
      const next = x + (duration / total) * width;
      path += ` H ${next.toFixed(3)}`;
      if (index % 2 === 1 && duration >= 10_000)
        gaps.push({ x, width: next - x });
      if (index < values.length - 1)
        path += ` V ${index % 2 === 0 ? low : high}`;
      x = next;
    });
    const safeZoom = Math.max(1, Math.min(16, this.zoom));
    const viewWidth = width / safeZoom;
    const start = Math.max(0, Math.min(width - viewWidth, this.pan));
    return html`<div class="wrap ${this.reveal ? "reveal" : ""}" role="img" aria-label=${`${this.label}; ${values.length} timings; ${formatDuration(total)}`}><svg viewBox="${start} 0 ${viewWidth} 126" preserveAspectRatio="none" aria-hidden="true"><g class="gaps">${gaps.map((gap) => html`<rect x=${gap.x} y="10" width=${Math.max(0, gap.width)} height="106" rx="2"></rect>`)}</g><path d=${path} vector-effect="non-scaling-stroke"></path></svg></div>`;
  }
}

@safeCustomElement("imprint-evidence")
export class ImprintEvidence extends LitElement {
  @property({ attribute: false }) analysis: AnalysisData = {};
  static styles = [tokens];
  render() {
    const label = evidenceLabel(this.analysis);
    const recognized = ["Verified", "Likely"].includes(label);
    return html`<span class="badge ${recognized ? "success" : ""}" title="Recognition evidence, not proof of appliance compatibility"><ha-icon icon=${recognized ? "mdi:check-decagram-outline" : "mdi:information-outline"}></ha-icon>${label} evidence</span>`;
  }
}

@safeCustomElement("imprint-dialog")
export class ImprintDialog extends LitElement {
  @property() heading = "";
  @property() description = "";
  @property({ type: Boolean }) danger = false;
  private returnFocus: HTMLElement | null = null;
  static styles = [
    tokens,
    css`
    :host { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 18px; background: rgba(12,18,28,.58); }
    section { width: min(560px, 100%); max-height: calc(100vh - 36px); overflow: auto; border-radius: 16px; background: var(--imprint-surface); padding: 20px; box-shadow: 0 24px 70px rgba(0,0,0,.28); }
    header { display: flex; gap: 12px; justify-content: space-between; } h2 { margin-bottom: 6px; } p { color: var(--imprint-muted); }
  `,
  ];

  connectedCallback() {
    const root = this.getRootNode();
    this.returnFocus = (
      root instanceof ShadowRoot ? root.activeElement : document.activeElement
    ) as HTMLElement | null;
    super.connectedCallback();
    this.addEventListener("keydown", this.handleKeydown);
  }

  disconnectedCallback() {
    this.removeEventListener("keydown", this.handleKeydown);
    const target = this.returnFocus;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
    super.disconnectedCallback();
  }

  protected firstUpdated() {
    requestAnimationFrame(() => {
      const target =
        this.querySelector<HTMLElement>("[autofocus]") || this.focusable()[0];
      target?.focus();
    });
  }

  private focusable() {
    const selector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(selector),
      ...this.querySelectorAll<HTMLElement>(selector),
    ].filter((element) => element.offsetParent !== null);
  }

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    const focusable = this.focusable();
    const active =
      (this.renderRoot as ShadowRoot).activeElement ||
      this.querySelector<HTMLElement>(":focus") ||
      document.activeElement;
    trapTabKey(event, focusable, active);
  };

  private close() {
    this.dispatchEvent(
      new CustomEvent("dialog-close", { bubbles: true, composed: true }),
    );
  }

  render() {
    return html`<section role="dialog" aria-modal="true" aria-labelledby="imprint-dialog-title"><header><div><h2 id="imprint-dialog-title">${this.heading}</h2>${this.description ? html`<p>${this.description}</p>` : nothing}</div><button class="btn icon" title="Close dialog" aria-label="Close" @click=${() => this.close()}><ha-icon icon="mdi:close"></ha-icon></button></header><slot></slot></section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-feedback": ImprintFeedback;
    "imprint-status": ImprintStatus;
    "imprint-emitter-picker": ImprintEmitterPicker;
    "imprint-waveform": ImprintWaveform;
    "imprint-evidence": ImprintEvidence;
    "imprint-dialog": ImprintDialog;
  }
}
