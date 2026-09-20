import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type {
  ApplianceData,
  CommandData,
  InspectorState,
  RegistryData,
} from "../../types";
import {
  applianceDisplayName,
  binaryDecoderChoices,
  binaryDecoderMessage,
  binaryEncodingLabel,
  binaryPayloadExplanation,
  binaryPayloadFor,
  binaryScoreLabel,
  compatibilityLabel,
  copyText,
  decodedInteger,
  downloadText,
  emit,
  evidenceLabel,
  formatDuration,
  groupedBinary,
  humanizeToken,
  locationDisplayName,
  repeatSummary,
  type BinaryDecoderMode,
} from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { featureStyles } from "../../styles";
import {
  feedbackFor,
  homeAssistantUse,
  safeFilename,
  type SendFeedback,
  type SendFeedbackCollection,
} from "./model";
import "../primitives";

type InspectorTab = "overview" | "signal" | "code" | "history";

@safeCustomElement("imprint-command-inspector")
export class ImprintCommandInspector extends LitElement {
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ attribute: false }) inspector: InspectorState | null = null;
  @property({ attribute: false }) sendFeedback?: SendFeedbackCollection;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canTransmit = false;
  @property() selectedEmitter = "";
  @state() private tab: InspectorTab = "overview";
  @state() private zoom = 1;
  @state() private pan = 0;
  @state() private selectedRevision: number | null = null;
  @state() private revisionLabel = "";
  @state() private localSend?: SendFeedback;
  @state() private copyStatus = "";
  @state() private binaryMode: BinaryDecoderMode = "auto";
  private copyTimer?: number;
  private sendTimer?: number;

  static styles = [
    featureStyles,
    css`
    :host { display: block; min-width: 0; }
    .head { display: flex; align-items: center; gap: 11px; min-height: 70px; padding: 14px 54px 14px 16px; border-bottom: 1px solid var(--imprint-line); }
    .head > ha-icon { color: var(--imprint-accent); font-size: 28px; }
    .head > div { min-width: 0; margin-right: auto; }
    .head h2 { margin: 0 0 2px; display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; line-height: 1.2; }
    .body { padding: 15px; display: grid; gap: 14px; }
    .tabs { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); border-bottom: 1px solid var(--imprint-line); }
    .tabs button { min-height: 44px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: inherit; cursor: pointer; }
    .tabs button[aria-selected="true"] { color: var(--imprint-accent); border-bottom-color: var(--imprint-accent); font-weight: 750; }
    .tab-panel { display: grid; gap: 14px; min-width: 0; }
    .identity { display: grid; gap: 3px; }
    .status-line, .toolbar, .history-actions, .label-editor { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .status-line { justify-content: space-between; }
    .code { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 280px; overflow: auto; padding: 12px; border-radius: 9px; background: var(--imprint-surface-2); }
    .warnings, .frames, .candidates { display: grid; gap: 7px; }
    .decoded { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 5px; }
    .decoded span { display: inline-flex; gap: 4px; color: var(--imprint-muted); }
    .decoded code { color: var(--imprint-text); }
    .binary-summary { display: grid; gap: 8px; padding-block: 12px; border-block: 1px solid var(--imprint-line); }
    .binary-summary-head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
    .binary-summary-head > div { display: grid; gap: 2px; }
    .binary-summary-head small, .binary-summary p { color: var(--imprint-muted); }
    .binary-summary pre { margin: 0; padding: 11px; overflow-x: auto; border-radius: 9px; background: var(--imprint-surface-2); font: 650 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: .025em; white-space: pre-wrap; overflow-wrap: anywhere; user-select: all; }
    .binary-summary p { margin: 0; }
    .decoder-control { display: grid; grid-template-columns: minmax(180px, 320px); }
    .candidates h3 { margin-block-end: 0; }
    .alternatives { border-block-start: 1px solid var(--imprint-line); padding-block-start: 9px; }
    .alternatives summary { cursor: pointer; color: var(--imprint-muted); font-weight: 700; }
    .alternatives[open] summary { margin-block-end: 8px; }
    .frame { display: grid; grid-template-columns: auto 1fr auto; gap: 9px; padding: 8px 10px; border-bottom: 1px solid var(--imprint-line); }
    .history-layout { display: grid; grid-template-columns: minmax(160px,.75fr) minmax(240px,1.25fr); gap: 12px; }
    .revision-list { display: grid; align-content: start; gap: 6px; }
    .revision { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 9px; text-align: left; border: 1px solid var(--imprint-line); border-radius: 10px; padding: 9px; color: inherit; background: transparent; cursor: pointer; }
    .revision.selected { background: var(--imprint-accent-soft); border-color: var(--imprint-accent); }
    .revision-copy { display: grid; gap: 2px; min-width: 0; }
    .revision-copy small { color: var(--imprint-muted); }
    .revision-detail { display: grid; align-content: start; gap: 12px; padding: 12px; border-radius: 12px; background: var(--imprint-surface-2); }
    .lineage { display: grid; grid-template-columns: max-content 1fr; gap: 7px 10px; }
    .lineage span { color: var(--imprint-muted); }
    .label-editor label { flex: 1 1 180px; }
    .copy-status { min-height: 18px; color: var(--imprint-muted); font-size: 12px; }
    .copy-status.error { color: var(--error-color, #b42318); }
    .btn.transmit.success, .btn.transmit.success:hover { color: var(--text-primary-color, #fff); background: var(--imprint-success); border-color: var(--imprint-success); }
    .btn.transmit.error, .btn.transmit.error:hover { color: var(--text-primary-color, #fff); background: var(--imprint-danger); border-color: var(--imprint-danger); }
    .metric { min-width: 0; }
    .metric strong { overflow-wrap: anywhere; }
    .wide { width: auto; min-width: 0; max-width: 100%; justify-self: stretch; justify-content: center; }
    .ha-use { display: grid; gap: 10px; padding-block-start: 12px; border-block-start: 1px solid var(--imprint-line); }
    .ha-use h3, .ha-use p { margin: 0; }
    .ha-use code { font-size: 12px; }
    .ha-use a { text-decoration: none; }
    @media (max-width: 620px) { .tabs { grid-template-columns: repeat(2, 1fr); } .history-layout { grid-template-columns: 1fr; } }
  `,
  ];

  updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("inspector") && this.inspector) {
      const previous = changed.get("inspector") as
        | InspectorState
        | null
        | undefined;
      this.tab = this.inspector.tab || "overview";
      this.zoom = this.inspector.zoom || 1;
      this.pan = this.inspector.pan || 0;
      this.binaryMode = this.inspector.binaryDecoderMode || "auto";
      if (
        !previous ||
        previous.cmdId !== this.inspector.cmdId ||
        previous.applianceId !== this.inspector.applianceId ||
        previous.locId !== this.inspector.locId
      ) {
        this.selectedRevision = null;
        this.revisionLabel = "";
        this.localSend = undefined;
      }
      if (
        this.inspector.history?.revisions?.length &&
        (!previous || previous.history !== this.inspector.history)
      ) {
        const revisions = [...this.inspector.history.revisions].reverse();
        const requested =
          this.inspector.revisionSelected ?? this.selectedRevision;
        const selected =
          revisions.find(
            (revision: any) => Number(revision.revision) === Number(requested),
          ) || revisions[0];
        this.selectedRevision = Number(selected.revision);
        this.revisionLabel = String(selected.label || "");
      }
      const external = feedbackFor(
        this.sendFeedback,
        this.inspector.locId,
        this.inspector.applianceId,
        this.inspector.cmdId,
      );
      if (
        changed.has("sendFeedback") &&
        external &&
        external.kind !== "pending"
      )
        this.localSend = undefined;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.clearTimeout(this.copyTimer);
    window.clearTimeout(this.sendTimer);
  }

  private selected(): {
    command: CommandData;
    appliance: ApplianceData;
    applianceName: string;
    locationName: string;
  } | null {
    const ref = this.inspector;
    if (!ref) return null;
    const location = this.registry.locations?.[ref.locId];
    const appliance = location?.appliances?.[ref.applianceId];
    const command = appliance?.commands?.[ref.cmdId];
    return command
      ? {
          command,
          appliance,
          applianceName: applianceDisplayName(
            ref.locId,
            ref.applianceId,
            appliance.name,
          ),
          locationName: locationDisplayName(ref.locId, location?.name),
        }
      : null;
  }

  private setTab(tab: InspectorTab) {
    this.tab = tab;
    emit(this, "inspector-tab", { tab });
  }

  private handleTabKeydown(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs: InspectorTab[] = ["overview", "signal", "code", "history"];
    const current = tabs.indexOf(this.tab);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % tabs.length
            : (current - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    this.setTab(tabs[index]);
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<HTMLButtonElement>(`button[data-tab="${tabs[index]}"]`)
        ?.focus(),
    );
  }

  private setSignalView(zoom: number, pan: number) {
    this.zoom = Math.max(1, Math.min(16, zoom));
    this.pan = Math.max(0, Math.min(1000 - 1000 / this.zoom, pan));
    emit(this, "inspector-view-change", { zoom: this.zoom, pan: this.pan });
  }

  private setBinaryMode(mode: BinaryDecoderMode) {
    this.binaryMode = mode;
    emit(this, "inspector-binary-mode", { mode });
  }

  private send() {
    if (!this.inspector) return;
    this.localSend = { kind: "pending", message: "Sending once…" };
    window.clearTimeout(this.sendTimer);
    this.sendTimer = window.setTimeout(
      () => (this.localSend = undefined),
      8000,
    );
    emit(this, "command-send", this.inspector);
  }

  private sendNotice(): SendFeedback | undefined {
    const ref = this.inspector;
    return ref
      ? feedbackFor(this.sendFeedback, ref.locId, ref.applianceId, ref.cmdId) ||
          this.localSend
      : undefined;
  }

  private async copy(value: string, success: string) {
    window.clearTimeout(this.copyTimer);
    try {
      if (!value) throw new Error("The requested data is unavailable.");
      await copyText(value);
      this.copyStatus = success;
    } catch (error) {
      this.copyStatus = `Copy failed: ${String((error as Error).message || error)}`;
    }
    this.copyTimer = window.setTimeout(() => (this.copyStatus = ""), 3000);
  }

  private showStatus(message: string) {
    window.clearTimeout(this.copyTimer);
    this.copyStatus = message;
    this.copyTimer = window.setTimeout(() => (this.copyStatus = ""), 3000);
  }

  private formatSource(source: unknown): string {
    if (!source) return "Learned locally";
    if (typeof source === "string") return source;
    const detail = source as Record<string, unknown>;
    return humanizeToken(
      detail.name ||
        detail.profile_name ||
        detail.type ||
        detail.source ||
        "Saved source",
    );
  }

  private renderFeedback() {
    const notice = this.sendNotice();
    if (!notice) return nothing;
    return html`<span class="sr-only" role=${notice.kind === "error" ? "alert" : "status"} aria-live=${notice.kind === "error" ? "assertive" : "polite"}>${notice.message}${notice.detail ? ` ${notice.detail}` : ""}</span>`;
  }

  private renderOverview(
    command: CommandData,
    appliance: ApplianceData,
    applianceName: string,
    locationName: string,
  ) {
    const ref = this.inspector!;
    const analysis = command.analysis || {};
    const signal = command.signal || {};
    const revisions = Number(
      command.revision_count || (command.current_revision ? 1 : 0),
    );
    const use = homeAssistantUse(
      ref.locId,
      ref.applianceId,
      ref.cmdId,
      appliance,
      command,
    );
    const emitter =
      (this.registry.emitters || []).find(
        (item) => item.key === this.selectedEmitter,
      ) ||
      (this.registry.emitters || []).find((item) => item.enabled !== false);
    const sendNotice = this.sendNotice();
    const sendIcon =
      sendNotice?.kind === "success"
        ? "mdi:check"
        : sendNotice?.kind === "error"
          ? "mdi:alert-circle-outline"
          : sendNotice?.kind === "pending"
            ? "mdi:loading"
            : "mdi:send";
    return html`<section class="tab-panel" role="tabpanel">
      <div class="identity"><strong>${applianceName}</strong>${locationName ? html`<span class="muted">${locationName}</span>` : nothing}</div>
      <div class="status-line"><imprint-evidence .analysis=${analysis}></imprint-evidence></div>
      <div class="metric-grid"><div class="metric"><span>Active emitter</span><strong>${emitter?.name || emitter?.entity_id || emitter?.key || "Not configured"}</strong></div><div class="metric"><span>Compatibility</span><strong>${compatibilityLabel(signal, analysis)}</strong></div><div class="metric"><span>Carrier</span><strong>${signal.carrier_frequency ? `${(signal.carrier_frequency / 1000).toFixed(1)} kHz · ${signal.carrier_source === "assumed" ? "assumed" : "provided"}` : "Not provided"}</strong></div><div class="metric"><span>Revisions</span><strong>${revisions || "Not loaded"}</strong></div><div class="metric"><span>Duration</span><strong>${analysis.total_duration_us ? formatDuration(analysis.total_duration_us) : "Not analyzed"}</strong></div><div class="metric"><span>Source</span><strong>${this.formatSource(command.source)}</strong></div></div>
      ${!this.canTransmit ? html`<div class="notice warning"><ha-icon icon="mdi:access-point-off"></ha-icon><span>The emitter is unavailable. Inspection, copy, and export remain available.</span></div>` : nothing}
      <button class="btn primary wide transmit ${sendNotice?.kind || ""}" title=${sendNotice ? [sendNotice.message, sendNotice.detail].filter(Boolean).join(" ") : "Send this command once"} ?disabled=${this.busy || !this.canTransmit || sendNotice?.kind === "pending"} @click=${() => this.send()}><ha-icon icon=${sendIcon}></ha-icon>Send once</button>
      ${this.renderFeedback()}
      <div class="toolbar"><button class="btn" @click=${() => emit(this, "command-rename", ref)}>Rename</button><button class="btn" @click=${() => emit(this, "command-duplicate", ref)}>Duplicate</button><button class="btn" @click=${() => emit(this, "command-relearn", ref)}>Relearn</button><button class="btn danger" @click=${() => emit(this, "command-delete", ref)}>Delete</button></div>
      <section class="ha-use" aria-labelledby="ha-use-heading"><div><h3 id="ha-use-heading">Use in Home Assistant</h3><p class="muted">${use.entityId ? (use.action === "imprint_refinery.send_saved_command" ? "Choose this saved command by name in an Imprint device action, then set repeats and delay." : use.action === "remote.send_command" ? `Send this command through ${use.entityId}; automations can set repeats and delay seconds.` : `This command is available as ${use.entityId}.`) : "Home Assistant is still registering this command's entity."}</p></div>${use.yaml ? html`<div class="toolbar"><button class="btn" @click=${() => void this.copy(use.yaml, "Home Assistant action copied.")}><ha-icon icon="mdi:content-copy"></ha-icon>Copy action</button><button class="btn" @click=${() => void this.copy(use.entityId, "Entity ID copied.")}><ha-icon icon="mdi:identifier"></ha-icon>Copy entity ID</button>${use.deviceUrl ? html`<a class="btn" href=${use.deviceUrl}><ha-icon icon="mdi:open-in-new"></ha-icon>Open device</a>` : nothing}</div><details><summary>${use.advanced ? "Advanced Home Assistant action" : "Ready-to-use Home Assistant action"}</summary><pre class="code"><code>${use.yaml}</code></pre></details>` : nothing}</section>
    </section>`;
  }

  private renderSignal(command: CommandData) {
    const ref = this.inspector!;
    const analysis = command.analysis || {};
    const signal = command.signal || {};
    const timings = signal.timings || [];
    const signed = timings
      .map((value, index) => `${index % 2 ? "-" : "+"}${value}`)
      .join(" ");
    const frames = Array.isArray(analysis.frames) ? analysis.frames : [];
    const roles = Array.isArray(analysis.frame_roles)
      ? analysis.frame_roles
      : [];
    const repeats = repeatSummary(analysis);
    const sendNotice = this.sendNotice();
    return html`<section class="tab-panel" role="tabpanel">
      <div class="status-line"><div><strong>${analysis.protocol || analysis.protocol_name || "Unknown protocol"}</strong><div class="muted">${evidenceLabel(analysis)} evidence</div></div><span class="badge">${analysis.pulse_count ?? timings.length} pulses</span></div>
      ${timings.length ? html`<imprint-waveform .timings=${timings} .zoom=${this.zoom} .pan=${this.pan}></imprint-waveform>` : html`<div class="notice warning"><ha-icon icon="mdi:waveform-off"></ha-icon><span>No canonical timings are available. The stored payload can still be copied or exported from Code.</span></div>`}
      <div class="toolbar"><button class="btn icon" title="Zoom out" aria-label="Zoom out" ?disabled=${this.zoom <= 1} @click=${() => this.setSignalView(this.zoom / 2, this.pan)}><ha-icon icon="mdi:magnify-minus-outline"></ha-icon></button><button class="btn" title="Fit the whole signal" ?disabled=${this.zoom === 1 && this.pan === 0} @click=${() => this.setSignalView(1, 0)}>Fit</button><button class="btn icon" title="Zoom in" aria-label="Zoom in" ?disabled=${this.zoom >= 16} @click=${() => this.setSignalView(this.zoom * 2, this.pan)}><ha-icon icon="mdi:magnify-plus-outline"></ha-icon></button>${this.zoom > 1 ? html`<label class="field" style="flex:1 1 180px">Pan<input type="range" min="0" max=${1000 - 1000 / this.zoom} step="1" .value=${String(this.pan)} @input=${(event: Event) => this.setSignalView(this.zoom, Number((event.target as HTMLInputElement).value))}></label>` : nothing}<button class="btn" ?disabled=${!signed} @click=${() => void this.copy(signed, "Timings copied.")}>Copy timings</button><button class="btn transmit ${sendNotice?.kind || ""}" title=${sendNotice ? [sendNotice.message, sendNotice.detail].filter(Boolean).join(" ") : "Test this command once"} ?disabled=${this.busy || !this.canTransmit || sendNotice?.kind === "pending"} @click=${() => this.send()}>Test once</button></div>
      <div class="metric-grid"><div class="metric"><span>Duration</span><strong>${analysis.total_duration_us ? formatDuration(analysis.total_duration_us) : "Not analyzed"}</strong></div><div class="metric"><span>Carrier</span><strong>${signal.carrier_frequency ? `${(signal.carrier_frequency / 1000).toFixed(1)} kHz` : "Not provided"}</strong><small>${signal.carrier_source === "assumed" ? "The receiver did not report a carrier frequency." : "Provided by the source"}</small></div><div class="metric"><span>Frames</span><strong>${(analysis.frame_count ?? frames.length) || "Unknown"}</strong></div><div class="metric"><span>Captured repeats</span><strong>${repeats.captured}</strong><small>${repeats.capturedDetail}</small></div><div class="metric"><span>Required repeats</span><strong>${repeats.required}</strong><small>${repeats.requiredDetail}</small></div></div>
      ${frames.length || roles.length ? html`<div class="frames">${(roles.length ? roles : frames).map((frame: any, index: number) => html`<div class="frame"><strong>${index + 1}</strong><span>${String(frame.role || frame.kind || "Frame").replaceAll("_", " ")}</span><small>${frame.duration_us ? formatDuration(Number(frame.duration_us)) : ""}</small></div>`)}</div>` : nothing}
      ${this.renderFeedback()}
      <button class="btn primary wide" ?disabled=${!timings.length} @click=${() => emit(this, "signal-lab-open", ref)}><ha-icon icon="mdi:tune-vertical-variant"></ha-icon>Open in Signal Lab</button>
      <div class="notice"><ha-icon icon="mdi:lock-outline"></ha-icon><span>The saved revision stays protected. Signal Lab works on a copy.</span></div>
    </section>`;
  }

  private renderCode(command: CommandData) {
    const ref = this.inspector!;
    const analysis = command.analysis || {};
    const representation = ref.representation || command.format || "raw_signed";
    const value =
      ref.representations?.[representation] ??
      (representation === command.format ? command.code || "" : "");
    const candidates = analysis.protocol_candidates || [];
    const binaryMode = ref.binaryDecoderMode || this.binaryMode;
    const binary = binaryPayloadFor(analysis, binaryMode);
    const extension: Record<string, string> = {
      girr: "xml",
      pronto: "txt",
      flipper: "ir",
      lirc: "conf",
      raw_signed: "txt",
      raw_unsigned: "txt",
      zosung_base64: "txt",
    };
    return html`<section class="tab-panel" role="tabpanel">
      <div class="decoder-control"><label class="field">Bitstream decoder<select @change=${(event: Event) => this.setBinaryMode((event.target as HTMLSelectElement).value as BinaryDecoderMode)}>${binaryDecoderChoices.map((choice) => html`<option value=${choice.value} ?selected=${choice.value === binaryMode}>${choice.label}</option>`)}</select></label></div>
      ${
        binary
          ? html`<section class="binary-summary" aria-labelledby="inspector-binary-heading">
        <div class="binary-summary-head"><div><strong id="inspector-binary-heading">Raw bitstream</strong><small>${binary.bit_count || binary.value.length} bits · ${binaryEncodingLabel(binary.encoding)} · transmission order</small><small>${binaryScoreLabel(binary, binaryMode)}</small></div><button class="btn" @click=${() => void this.copy(binary.value, "Raw bitstream copied.")}><ha-icon icon="mdi:content-copy"></ha-icon>Copy bits</button></div>
        <pre aria-label="Binary payload in transmission order"><code>${groupedBinary(binary.value)}</code></pre>
        <p>${binaryPayloadExplanation(binary, String(analysis.protocol || analysis.protocol_name || ""))}</p>
      </section>`
          : html`<div class="notice warning" role="status"><ha-icon icon="mdi:source-branch-remove"></ha-icon><span>${binaryDecoderMessage(analysis, binaryMode)}</span></div>`
      }
      <label class="field">Representation<select .value=${representation} @change=${(event: Event) => emit(this, "representation-request", { ...ref, format: (event.target as HTMLSelectElement).value })}><option value="zosung_base64">Zosung Base64</option><option value="pronto">Pronto Hex</option><option value="girr">Girr 1.2</option><option value="flipper">Flipper .ir</option><option value="lirc">LIRC raw</option><option value="raw_signed">Raw signed</option><option value="raw_unsigned">Raw unsigned</option></select></label>
      ${ref.representationLoading ? html`<div class="notice" role="status"><ha-icon icon="mdi:progress-clock"></ha-icon><span>Converting representation…</span></div>` : value ? html`<pre class="code"><code>${value}</code></pre>` : html`<div class="notice warning"><ha-icon icon="mdi:file-alert-outline"></ha-icon><span>${command.code ? "This representation is unavailable or incompatible with the stored signal." : "This command has no readable stored payload."}</span></div>`}
      <div class="toolbar"><button class="btn" ?disabled=${!value} @click=${() => void this.copy(String(value), "Representation copied.")}><ha-icon icon="mdi:content-copy"></ha-icon>Copy</button><button class="btn" ?disabled=${!value} @click=${() => {
        downloadText(
          String(value),
          `${safeFilename(command.name || ref.cmdId)}.${extension[representation] || "txt"}`,
        );
        this.showStatus("Export downloaded.");
        emit(this, "command-export", { ...ref, format: representation });
      }}><ha-icon icon="mdi:download-outline"></ha-icon>Export</button><imprint-evidence .analysis=${analysis}></imprint-evidence></div>
      <div class="notice"><ha-icon icon="mdi:information-outline"></ha-icon><span>${representation === "zosung_base64" ? "Zosung Base64 is a converted vendor representation. Copying or exporting never transmits." : "Converted output is shown only when the backend can represent it without hiding incompatibilities."}</span></div>
      ${candidates.length ? html`<details class="alternatives"><summary>Protocol interpretations (${candidates.length})</summary><section class="candidates">${candidates.map((candidate: any) => this.renderCandidate(candidate))}</section></details>` : html`<div class="muted">No named protocol is claimed. The raw timing sequence and timing-derived bitstream remain usable.</div>`}
      ${analysis.recognition ? html`<details><summary>Recognition evidence</summary><pre class="code"><code>${JSON.stringify(analysis.recognition, null, 2)}</code></pre></details>` : nothing}
    </section>`;
  }

  private renderCandidate(candidate: any) {
    const fields = ["address", "command", "data", "toggle", "checksum"].filter(
      (key) => candidate[key] !== undefined && candidate[key] !== null,
    );
    return html`<div class="metric"><span>${String(candidate.protocol || "Candidate")}</span><strong>${String(candidate.evidence_class || candidate.confidence_level || candidate.confidence || "Unranked evidence").replaceAll("_", " ")}</strong>${candidate.bits ? html`<small>${candidate.bits}-bit frame</small>` : nothing}${fields.length ? html`<div class="decoded">${fields.map((key) => html`<span>${key}<code>${this.decodedValue(candidate[key])}</code></span>`)}</div>` : nothing}${candidate.carrier_mismatch ? html`<small>Decoded carrier differs from the emitter assumption.</small>` : nothing}</div>`;
  }

  private decodedValue(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0)
      return decodedInteger(value);
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  private revisionSnapshot(revision: any): CommandData {
    return (revision?.snapshot || {}) as CommandData;
  }

  private selectRevision(revision: any) {
    this.selectedRevision = Number(revision.revision);
    this.revisionLabel = String(revision.label || "");
    emit(this, "revision-inspect", {
      ...this.inspector!,
      revision: revision.revision,
    });
  }

  private async copyRevision(revision: any) {
    const snapshot = this.revisionSnapshot(revision);
    await this.copy(
      String(snapshot.code || ""),
      `Revision ${revision.revision} code copied.`,
    );
  }

  private exportRevision(revision: any) {
    const snapshot = this.revisionSnapshot(revision);
    downloadText(
      JSON.stringify(
        { schema_version: 1, revision: { ...revision, snapshot } },
        null,
        2,
      ),
      `${safeFilename(snapshot.name || this.inspector!.cmdId)}-revision-${revision.revision}.imprint.json`,
      "application/json",
    );
    this.showStatus(`Revision ${revision.revision} exported.`);
  }

  private renderHistory() {
    const ref = this.inspector!;
    if (ref.loading)
      return html`<div class="notice" role="status"><ha-icon icon="mdi:progress-clock"></ha-icon><span>Loading revision history…</span></div>`;
    const revisions = [...(ref.history?.revisions || [])].reverse();
    if (!revisions.length)
      return html`<div class="empty"><div><ha-icon icon="mdi:history"></ha-icon><h3>No revision history is available</h3><p>The command is still inspectable. History appears after the registry migration or the next committed save.</p></div></div>`;
    const selected =
      revisions.find(
        (revision: any) => revision.revision === this.selectedRevision,
      ) || revisions[0];
    const snapshot = this.revisionSnapshot(selected);
    const analysis = snapshot.analysis || {};
    const signal = snapshot.signal || {};
    const current = selected.revision === ref.history?.current_revision;
    return html`<section class="tab-panel" role="tabpanel"><div class="history-layout">
      <div class="revision-list" aria-label="Command revisions">${revisions.map((revision: any) => html`<button class="revision ${revision.revision === selected.revision ? "selected" : ""}" aria-pressed=${revision.revision === selected.revision} @click=${() => this.selectRevision(revision)}><strong>v${revision.revision}</strong><span class="revision-copy"><span>${revision.label || String(revision.action || "Saved").replaceAll("_", " ")}</span><small>${revision.created_at ? new Date(revision.created_at).toLocaleString() : "Time unavailable"}${revision.revision === ref.history?.current_revision ? " · Current" : ""}</small></span></button>`)}</div>
      <article class="revision-detail"><div class="status-line"><div><strong>Revision ${selected.revision}</strong><div class="muted">${String(selected.action || "Saved").replaceAll("_", " ")}</div></div>${current ? html`<span class="badge success">Current</span>` : nothing}</div>
        <div class="lineage"><span>Created</span><strong>${selected.created_at ? new Date(selected.created_at).toLocaleString() : "Unknown"}</strong><span>Parent</span><strong>${selected.parent_revision == null ? "Original revision" : `Revision ${selected.parent_revision}`}</strong><span>Evidence</span><strong>${evidenceLabel(analysis)}</strong></div>
        ${(signal.timings || []).length ? html`<imprint-waveform .timings=${signal.timings || []}></imprint-waveform><div class="muted">${analysis.pulse_count ?? signal.timings?.length} pulses · ${analysis.total_duration_us ? formatDuration(analysis.total_duration_us) : "Duration unavailable"}</div>` : html`<div class="notice warning"><ha-icon icon="mdi:waveform-off"></ha-icon><span>This revision has no timing preview. Its stored payload can still be copied or exported.</span></div>`}
        <div class="label-editor"><label class="field">Revision label<input class="input" maxlength="80" placeholder="Optional note for this revision" .value=${this.revisionLabel} @input=${(event: Event) => (this.revisionLabel = (event.target as HTMLInputElement).value)}></label><button class="btn" @click=${() => emit(this, "revision-label", { ...ref, revision: selected.revision, label: this.revisionLabel.trim() })}><ha-icon icon="mdi:tag-outline"></ha-icon>Save label</button></div>
        <div class="history-actions"><button class="btn" ?disabled=${current} @click=${() => emit(this, "revision-compare", { ...ref, revision: selected.revision })}>Compare with current</button><button class="btn" ?disabled=${this.busy || !this.canTransmit} @click=${() => emit(this, "revision-test", { ...ref, revision: selected.revision })}>Test once</button><button class="btn" ?disabled=${!snapshot.code} @click=${() => void this.copyRevision(selected)}>Copy code</button><button class="btn" @click=${() => this.exportRevision(selected)}>Export</button><button class="btn primary" ?disabled=${current} @click=${() => emit(this, "revision-restore", { ...ref, revision: selected.revision })}>Restore as new revision</button></div>
      </article>
    </div></section>`;
  }

  render() {
    const selected = this.selected();
    const ref = this.inspector;
    if (!selected || !ref)
      return html`<div class="empty"><div><ha-icon icon="mdi:chart-timeline-variant-shimmer"></ha-icon><h2>Inspect a command</h2><p>Select a saved command to see its real signal, code, evidence, and revision history.</p></div></div>`;
    const { command, appliance, applianceName, locationName } = selected;
    return html`<div class="head"><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon><div><h2>${command.name || ref.cmdId}</h2><span class="muted">${applianceName}</span></div></div>
      <div class="body"><div class="tabs" role="tablist" aria-label="Command details" @keydown=${this.handleTabKeydown}>${(["overview", "signal", "code", "history"] as const).map((tab) => html`<button role="tab" data-tab=${tab} tabindex=${this.tab === tab ? 0 : -1} aria-selected=${this.tab === tab} @click=${() => this.setTab(tab)}>${tab[0].toUpperCase() + tab.slice(1)}</button>`)}</div>${this.tab === "overview" ? this.renderOverview(command, appliance, applianceName, locationName) : this.tab === "signal" ? this.renderSignal(command) : this.tab === "code" ? this.renderCode(command) : this.renderHistory()}<div class="copy-status ${this.copyStatus.startsWith("Copy failed") ? "error" : ""}" role="status" aria-live="polite">${this.copyStatus}</div></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-command-inspector": ImprintCommandInspector;
  }
}
