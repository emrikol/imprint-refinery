import { LitElement, css, html, nothing } from "lit";
import { property } from "lit/decorators.js";
import type { LearnState, RegistryData } from "../types";
import {
  applianceDisplayName,
  deepActiveElement,
  emit,
  evidenceLabel,
  formatDuration,
  isSystemUnassigned,
  locationDisplayName,
  trapTabKey,
} from "../core/utils";
import { safeCustomElement } from "../core/registration";
import { featureStyles } from "../styles";
import "./primitives";

@safeCustomElement("imprint-learn-flow")
export class ImprintLearnFlow extends LitElement {
  @property({ attribute: false }) learn: LearnState | null = null;
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) emitterReady = true;
  @property({ type: Number }) remaining = 0;
  @property() emitterName = "IR emitter";
  @property({ attribute: false }) returnFocusElement: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;
  private coveredLibrary: HTMLElement | null = null;
  private coveredLibraryWasInert = false;
  private coveredLibraryAriaHidden: string | null = null;
  static styles = [
    featureStyles,
    css`
    :host { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(6,10,16,.72); backdrop-filter: blur(2px); }
    .learn { width: min(560px, 100%); max-height: calc(100dvh - 36px); overflow: auto; margin: 0 auto; padding: 24px; box-shadow: 0 24px 70px rgba(0,0,0,.42); }
    .capture { text-align: center; padding: 28px 26px; }
    .remote-ring { width: 68px; height: 68px; margin: 0 auto 14px; border-radius: 50%; display: grid; place-items: center; color: var(--imprint-accent); background: var(--imprint-accent-soft); animation: breathe 1.5s ease-in-out infinite; }
    .remote-ring ha-icon { --mdc-icon-size: 34px; }
    .capture-motif { position: relative; width: min(300px, 86%); height: 54px; display: flex; gap: 5px; align-items: center; justify-content: center; margin: 18px auto 12px; overflow: hidden; }
    .capture-motif::after { content: ""; position: absolute; inset: 50% 0 auto; height: 2px; border-radius: 2px; background: var(--imprint-accent); opacity: 0; transform: scaleX(.18); transition: opacity 160ms ease, transform 240ms cubic-bezier(.16,1,.3,1); }
    .capture-motif i { width: 4px; height: 34px; border-radius: 4px; background: var(--imprint-accent); transform: scaleY(.18); transform-origin: center; opacity: .72; transition: transform 180ms ease, opacity 160ms ease; }
    .capture-motif.waiting i { animation: listen 940ms ease-in-out infinite alternate; }
    .capture-motif i:nth-child(2n) { animation-duration: 1.28s; animation-delay: -.72s; }
    .capture-motif i:nth-child(3n) { animation-duration: .76s; animation-delay: -.31s; }
    .capture-motif i:nth-child(4n) { animation-duration: 1.46s; animation-delay: -.93s; }
    .capture-motif i:nth-child(5n) { animation-duration: 1.08s; animation-delay: -.54s; }
    .capture-motif.received i { animation: none; transform: scaleY(.04); opacity: 0; }
    .capture-motif.received::after { opacity: .72; transform: scaleX(1); }
    @keyframes listen { 0% { transform: scaleY(.12); opacity: .38; } 100% { transform: scaleY(1); opacity: .92; } }
    @keyframes breathe { 50% { transform: scale(1.05); box-shadow: 0 0 0 14px color-mix(in srgb, var(--imprint-accent) 7%, transparent); } }
    @media (prefers-reduced-motion: reduce) { .remote-ring, .capture-motif i { animation: none; } .capture-motif.waiting i { transform: scaleY(.42); opacity: .68; } }
    .countdown { width: 138px; height: 138px; margin: 10px auto 0; border: 10px solid color-mix(in srgb, var(--imprint-muted) 35%, transparent); border-top-color: var(--imprint-accent); border-radius: 50%; display: grid; place-items: center; font-variant-numeric: tabular-nums; font-size: 30px; font-weight: 800; }
    .countdown::after { content: "seconds remaining"; display: block; width: 80px; margin-top: -44px; font-size: 12px; line-height: 1.1; font-weight: 500; }
    .review { width: min(600px, 100%); display: grid; gap: 16px; }
    .review .role-head { margin-bottom: 0; }
    .signal-preview { display: grid; gap: 7px; }
    .signal-label { color: var(--imprint-muted); font-size: 13px; font-weight: 650; }
    .signal-summary { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
    .review-form { display: grid; gap: 13px; min-width: 0; }
    .review-form .field, .review-form input, .review-form select { min-width: 0; max-width: 100%; }
    .review-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .review-actions .btn { width: 100%; }
    .review-secondary { display: flex; align-items: center; justify-content: center; gap: 8px 18px; flex-wrap: wrap; }
    .text-action { min-height: 44px; border: 0; padding: 8px 4px; color: var(--imprint-accent); background: transparent; font-weight: 650; }
    .technical { border-top: 1px solid var(--imprint-line); padding-top: 12px; }
    .technical summary { min-height: 44px; display: flex; align-items: center; cursor: pointer; font-weight: 650; }
    .technical-body { display: grid; gap: 13px; padding-top: 10px; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .facts > div { min-width: 0; padding: 10px; border-radius: 9px; background: var(--imprint-surface-2); display: flex; justify-content: space-between; gap: 12px; }
    .facts strong { text-align: right; overflow-wrap: anywhere; }
    .field small { line-height: 1.35; }
    .payload { max-height: 220px; overflow: auto; margin: 0; padding: 11px; border-radius: 9px; background: var(--imprint-surface-2); }
    .reassurance { display: flex; gap: 8px; align-items: flex-start; margin: 0; color: var(--imprint-muted); font-size: 13px; }
    .duplicate { border: 1px solid color-mix(in srgb, var(--imprint-warning) 38%, var(--imprint-line)); padding: 13px; border-radius: 11px; }
    @media (max-width: 660px) {
      :host { align-items: end; padding: 0; }
      .learn { width: 100%; max-height: 94dvh; border-radius: 18px 18px 0 0; padding: 18px; }
      .capture { padding: 24px 18px; }
    }
    @media (max-width: 420px) { .review-actions, .facts { grid-template-columns: 1fr; } }
  `,
  ];

  connectedCallback() {
    const root = this.getRootNode();
    if (root instanceof ShadowRoot) {
      this.returnFocus = this.returnFocusElement || deepActiveElement(root);
      this.coveredLibrary = root.querySelector<HTMLElement>(
        "imprint-library-inspector",
      );
      if (this.coveredLibrary) {
        this.coveredLibraryWasInert = this.coveredLibrary.inert;
        this.coveredLibraryAriaHidden =
          this.coveredLibrary.getAttribute("aria-hidden");
        this.coveredLibrary.inert = true;
        this.coveredLibrary.setAttribute("aria-hidden", "true");
      }
    }
    super.connectedCallback();
    this.addEventListener("keydown", this.handleKeydown);
  }

  disconnectedCallback() {
    this.removeEventListener("keydown", this.handleKeydown);
    if (this.coveredLibrary) {
      this.coveredLibrary.inert = this.coveredLibraryWasInert;
      if (this.coveredLibraryAriaHidden === null)
        this.coveredLibrary.removeAttribute("aria-hidden");
      else
        this.coveredLibrary.setAttribute(
          "aria-hidden",
          this.coveredLibraryAriaHidden,
        );
    }
    const target = this.returnFocus;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
    super.disconnectedCallback();
  }

  protected firstUpdated() {
    this.focusInitial();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("returnFocusElement") && this.returnFocusElement)
      this.returnFocus = this.returnFocusElement;
    const previous = changed.get("learn") as LearnState | null | undefined;
    if (changed.has("learn") && previous?.step !== this.learn?.step)
      this.focusInitial();
  }

  private focusable() {
    return [
      ...this.renderRoot.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element.offsetParent !== null &&
        element.getClientRects().length > 0 &&
        !element.closest("details:not([open])"),
    );
  }

  private focusInitial() {
    requestAnimationFrame(() =>
      (
        this.focusable()[0] ||
        this.renderRoot.querySelector<HTMLElement>("[role=dialog]")
      )?.focus(),
    );
  }

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      emit(this, "learn-cancel");
      return;
    }
    const focusable = this.focusable();
    const active = (this.renderRoot as ShadowRoot)
      .activeElement as HTMLElement | null;
    trapTabKey(event, focusable, active);
  };

  private updateField(field: string, value: string) {
    emit(this, "learn-change", { field, value });
  }

  render() {
    const learn = this.learn;
    if (!learn) return nothing;
    if (learn.step === "waiting" || learn.step === "preparing") {
      return html`<section class="learn panel capture" role="dialog" aria-modal="true" aria-labelledby="imprint-learn-title" tabindex="-1">
        <div class="remote-ring"><ha-icon icon=${learn.step === "preparing" ? "mdi:waveform" : "mdi:remote"}></ha-icon></div>
        <h1 id="imprint-learn-title">${learn.step === "preparing" ? "Signal received" : "Waiting for a remote signal"}</h1>
        ${learn.step === "waiting" ? html`<p>Point the original remote at <strong>${this.emitterName}</strong> and press the button once. A short, deliberate press works best.</p>` : html`<p>Preparing the captured timing preview.</p>`}
        <div class="capture-motif ${learn.step === "preparing" ? "received" : "waiting"}" aria-hidden="true">${Array.from({ length: 18 }, () => html`<i></i>`)}</div>
        ${learn.step === "waiting" ? html`<div class="countdown" aria-live="polite">${this.remaining}s</div>` : html`<p role="status">Decoding the completed signal…</p>`}
        <div class="actions" style="justify-content:center;margin-top:22px"><button class="btn" ?disabled=${this.busy} @click=${() => emit(this, "learn-cancel")}>Cancel capture</button></div>
      </section>`;
    }
    if (learn.step === "error") {
      return html`<section class="learn panel section" role="dialog" aria-modal="true" aria-labelledby="imprint-learn-title" tabindex="-1">
        <div class="role-head"><div><p class="eyebrow">Capture stopped</p><h1 id="imprint-learn-title">No usable signal was captured</h1><p>${learn.error || "The receiver did not return a command."}</p></div><ha-icon icon="mdi:alert-circle-outline"></ha-icon></div>
        <imprint-feedback kind="error" .message=${learn.error || "Capture failed"} .detail=${learn.errorDetail || ""}></imprint-feedback>
        <div class="actions" style="margin-top:18px"><button class="btn primary" ?disabled=${this.busy} @click=${() => emit(this, "learn-retry")}><ha-icon icon="mdi:refresh"></ha-icon>Try again</button><button class="btn" ?disabled=${this.busy} @click=${() => emit(this, "learn-cancel")}>Return to library</button></div>
      </section>`;
    }
    const preview = learn.preview || {};
    const analysis = preview.analysis || {};
    const signal = preview.signal || {};
    const singlePress = analysis.single_press_candidate;
    const canOptimize =
      !learn.optimized &&
      Array.isArray(singlePress?.timings) &&
      singlePress.timings.length > 0 &&
      singlePress.timings.length < (signal.timings || []).length;
    const appliances = Object.entries(this.registry.locations || {}).flatMap(
      ([locId, location]) =>
        Object.entries(location.appliances || {}).flatMap(
          ([applianceId, appliance]) =>
            isSystemUnassigned(locId, applianceId, appliance.name)
              ? []
              : [
                  {
                    locId,
                    applianceId,
                    name: applianceDisplayName(
                      locId,
                      applianceId,
                      appliance.name,
                    ),
                    location: locationDisplayName(locId, location.name),
                  },
                ],
        ),
    );
    const targetKey = appliances.some(
      (appliance) =>
        `${appliance.locId}||${appliance.applianceId}` === learn.targetKey,
    )
      ? learn.targetKey
      : "";
    return html`<section class="learn panel section review" role="dialog" aria-modal="true" aria-labelledby="imprint-learn-title" tabindex="-1">
      <div class="role-head"><div><h1 id="imprint-learn-title">Command captured</h1><p>Name it, send it once if useful, then save it to your library.</p></div><button class="btn icon" title="Cancel capture" aria-label="Cancel capture" ?disabled=${this.busy} @click=${() => emit(this, "learn-cancel")}><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="signal-preview"><span class="signal-label">Signal received</span><imprint-waveform .timings=${signal.timings || []} .reveal=${true}></imprint-waveform></div>
      <div class="signal-summary"><imprint-evidence .analysis=${analysis}></imprint-evidence><span class="badge">${analysis.protocol || analysis.protocol_name || "Unknown protocol"}</span><span class="badge">${formatDuration(analysis.total_duration_us || 0)}</span></div>
      ${canOptimize ? html`<div class="notice warning"><ha-icon icon="mdi:repeat-off"></ha-icon><div><strong>Repeated pattern detected${evidenceLabel(analysis) === "Pattern only" ? ", but the protocol is unknown" : ""}.</strong><p style="margin:4px 0 9px">Optimization may change hold or repeat behavior. The original capture will be retained as the prior revision.</p><button class="btn" ?disabled=${this.busy} @click=${() => emit(this, "learn-optimize")}>Optimize for a single press</button></div></div>` : learn.optimized ? html`<div class="notice"><ha-icon icon="mdi:history"></ha-icon><span>Single-press optimization previewed. Saving keeps the original capture as the prior revision; test this version before relying on it.</span></div>` : nothing}
      ${learn.duplicateMatch ? html`<div class="duplicate"><strong>This looks like ${learn.duplicateMatch.commandName}</strong><p class="muted">Already saved for ${learn.duplicateMatch.applianceName}. Review the existing command, replace it, or save this capture separately.</p><div class="actions"><button class="btn" @click=${() => emit(this, "learn-duplicate-view")}>View existing</button><button class="btn" @click=${() => emit(this, "learn-duplicate-replace")}>Replace existing</button><button class="btn" @click=${() => emit(this, "learn-duplicate-ignore")}>Save separately</button></div></div>` : nothing}
      <div class="review-form">
        <label class="field">Command name<input .value=${learn.name} @input=${(e: Event) => this.updateField("name", (e.target as HTMLInputElement).value)} placeholder="Power"></label>
        <label class="field">Appliance (optional)<select .value=${targetKey} @change=${(e: Event) => this.updateField("targetKey", (e.target as HTMLSelectElement).value)}><option value="">No appliance</option>${appliances.map((appliance) => html`<option value=${`${appliance.locId}||${appliance.applianceId}`}>${appliance.name}${appliance.location ? ` · ${appliance.location}` : ""}</option>`)}<option value="__new__">New appliance…</option></select></label>
        ${learn.targetKey === "__new__" ? html`<label class="field">New appliance name<input .value=${learn.newApplianceName} @input=${(e: Event) => this.updateField("newApplianceName", (e.target as HTMLInputElement).value)} placeholder="Living room TV"></label>` : nothing}
      </div>
      ${!this.emitterReady ? html`<div class="notice warning"><ha-icon icon="mdi:access-point-off"></ha-icon><span>The selected emitter is unavailable. You can still save the capture without testing it.</span></div>` : nothing}
      <div class="review-actions"><button class="btn" ?disabled=${this.busy || !this.emitterReady} @click=${() => emit(this, "learn-test")}><ha-icon icon="mdi:play"></ha-icon>Test once</button><button class="btn primary" ?disabled=${this.busy || !learn.name.trim() || (learn.targetKey === "__new__" && !learn.newApplianceName.trim())} @click=${() => emit(this, "learn-save", { another: false })}><ha-icon icon="mdi:content-save-outline"></ha-icon>Save command</button></div>
      <div class="review-secondary"><button class="text-action" ?disabled=${this.busy || !this.emitterReady} @click=${() => emit(this, "learn-retry")}>Capture again</button><button class="text-action" ?disabled=${this.busy || !learn.name.trim() || (learn.targetKey === "__new__" && !learn.newApplianceName.trim())} @click=${() => emit(this, "learn-save", { another: true })}>Save & learn another</button></div>
      <details class="technical"><summary>Technical details</summary><div class="technical-body">
        <div class="facts"><div><span>Timings</span><strong>${analysis.pulse_count ?? signal.timings?.length ?? "—"}</strong></div><div><span>Carrier</span><strong>${signal.carrier_frequency ? `${(signal.carrier_frequency / 1000).toFixed(1)} kHz${signal.carrier_source === "assumed" ? " profile default" : ""}` : "Not provided"}</strong></div><div><span>Evidence</span><strong>${evidenceLabel(analysis)}</strong></div></div>
        ${signal.carrier_source === "assumed" ? html`<div class="muted">The captured timings are measured. The receiver did not report carrier frequency, so a 38 kHz default is used.</div>` : nothing}
        <label class="field">Home Assistant shortcut (optional)<select .value=${learn.role} @change=${(e: Event) => this.updateField("role", (e.target as HTMLSelectElement).value)}><option value="">Custom command / no shortcut</option><optgroup label="Power"><option value="power_toggle">Power toggle</option><option value="power_on">Power on</option><option value="power_off">Power off</option></optgroup><optgroup label="Audio"><option value="volume_up">Volume up</option><option value="volume_down">Volume down</option><option value="mute_toggle">Mute toggle</option><option value="mute">Mute</option><option value="unmute">Unmute</option></optgroup><optgroup label="Playback"><option value="play">Play</option><option value="pause">Pause</option><option value="play_pause_toggle">Play / pause</option><option value="stop">Stop</option><option value="next">Next</option><option value="previous">Previous</option><option value="fast_forward">Fast forward</option><option value="rewind">Rewind</option></optgroup><option value="source">Source</option></select><small>Your command name can describe any custom action. Choose a shortcut only when Home Assistant should expose a standard control.</small></label>
        <div class="actions"><button class="btn" ?disabled=${!learn.code} @click=${() => emit(this, "learn-copy-code", { code: learn.code })}><ha-icon icon="mdi:content-copy"></ha-icon>Copy raw code</button></div>
        <pre class="payload"><code>${JSON.stringify({ format: preview.format, signal, analysis, catalog_matches: learn.catalogMatches || [] }, null, 2)}</code></pre>
      </div></details>
      <p class="reassurance"><ha-icon icon="mdi:information-outline"></ha-icon><span>Nothing is saved until you choose Save command.</span></p>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-learn-flow": ImprintLearnFlow;
  }
}
