import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { CatalogState, RegistryData } from "../types";
import { emit } from "../core/utils";
import { safeCustomElement } from "../core/registration";
import { featureStyles } from "../styles";
import "./primitives";

@safeCustomElement("imprint-catalog-guided")
export class ImprintCatalogGuided extends LitElement {
  @property({ attribute: false }) catalog: CatalogState | null = null;
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ type: Boolean }) busy = false;
  @property({ type: Number }) cooldown = 0;
  @property({ type: Number }) matchRemaining = 0;
  @property() emitterName = "IR emitter";
  @property() importTargetKey = "";
  @state() private category = "tv";
  @state() private brand = "";
  @state() private model = "";
  @state() private selectedCommandIds: string[] = [];
  @state() private importTarget = "";
  @state() private importText = "";
  static styles = [
    featureStyles,
    css`
    :host { display: block; }
    .catalog { max-width: 1180px; margin: 0 auto; display: grid; gap: 16px; }
    .head { display: grid; grid-template-columns: minmax(0,1fr) 460px; gap: 24px; align-items: end; }
    .head-copy { display: grid; gap: 8px; }
    .back { justify-self: start; border: 0; padding: 6px 8px; min-height: 44px; margin-inline-start: -8px; color: var(--imprint-accent); background: transparent; }
    .head h1 { margin: 0; font-size: 28px; font-weight: 500; }
    .steps { display: flex; align-items: center; gap: 9px; }
    .step { display: flex; align-items: center; gap: 8px; color: var(--imprint-muted); font-size: 12px; font-weight: 700; }
    .step i { width: 36px; height: 36px; border: 1px solid var(--imprint-line); border-radius: 50%; display: grid; place-items: center; font-style: normal; }
    .step.active { color: var(--imprint-accent); }
    .step.active i, .step.done i { color: var(--text-primary-color, #07161a); border-color: var(--imprint-accent); background: var(--imprint-accent); }
    .step-line { width: 24px; height: 1px; background: var(--imprint-line); }
    .emitter { min-height: 64px; display: flex; gap: 10px; align-items: center; padding: 12px 16px; border: 1px solid var(--imprint-line); border-radius: 10px; background: var(--imprint-surface); }
    .emitter strong { margin-right: auto; }
    .ready-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--imprint-success); }
    .choices { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12px; }
    .choice { min-height: 185px; text-align: left; border: 1px solid var(--imprint-line); border-radius: 14px; background: var(--imprint-surface); padding: 18px; display: grid; align-content: start; gap: 10px; }
    .choice:hover { border-color: var(--imprint-accent); background: var(--imprint-accent-soft); }
    .choice ha-icon { --mdc-icon-size: 34px; color: var(--imprint-accent); }
    .result-list { display: grid; gap: 8px; }
    .result { display: grid; grid-template-columns: minmax(220px,1fr) 150px minmax(220px,.9fr) auto; gap: 12px; align-items: center; padding: 15px; border: 1px solid var(--imprint-line); border-radius: 9px; }
    .result-actions { display: flex; gap: 7px; }
    .profile { display: grid; gap: 14px; }
    .commands { display: grid; gap: 7px; }
    .command { min-height: 70px; display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 12px; align-items: center; padding: 12px 15px; border-bottom: 1px solid var(--imprint-line); background: var(--imprint-surface); }
    .guided { display: grid; grid-template-columns: minmax(0,1fr) 310px; border: 1px solid var(--imprint-line); border-radius: 10px; overflow: hidden; }
    .guided-main { padding: 28px 34px; text-align: center; display: grid; align-content: start; gap: 14px; }
    .guided-side { padding: 24px; border-left: 1px solid var(--imprint-line); background: var(--imprint-surface); text-align: left; }
    .guided-icon { width: 82px; height: 82px; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; background: var(--imprint-accent-soft); color: var(--imprint-accent); }
    .guided-icon ha-icon { --mdc-icon-size: 40px; }
    .progress { height: 7px; border-radius: 99px; overflow: hidden; background: var(--imprint-surface-2); }
    .progress i { display: block; height: 100%; background: var(--imprint-accent); }
    .import-summary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 8px; }
    .search-panel { padding: 16px; }
    .search-fields { display: grid; grid-template-columns: 1fr 1.2fr 1.4fr auto; gap: 12px; align-items: end; }
    .catalog-meta { color: var(--imprint-muted); font-size: 12px; }
    .confirm-card { min-height: 160px; padding: 28px 40px; border: 1px solid color-mix(in srgb, var(--imprint-success) 60%, var(--imprint-line)); border-radius: 10px; background: color-mix(in srgb, var(--imprint-success) 10%, transparent); display: grid; align-content: center; }
    .profile-actions { display: flex; justify-content: flex-end; gap: 9px; align-items: center; padding: 12px; border: 1px solid var(--imprint-line); border-radius: 9px; }
    @media (max-width: 800px) {
      .head { grid-template-columns: 1fr; align-items: start; }
      .steps { overflow-x: auto; }
      .choices, .search-fields { grid-template-columns: 1fr; }
      .choice { min-height: 130px; }
      .result { grid-template-columns: 1fr; }
      .guided { grid-template-columns: 1fr; }
      .guided-main { padding: 20px 16px; gap: 12px; }
      .guided-side { border-left: 0; border-top: 1px solid var(--imprint-line); }
      .steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; overflow: visible; }
      .step { min-width: 0; flex-direction: column; gap: 4px; text-align: center; overflow-wrap: anywhere; }
      .step i { width: 32px; height: 32px; }
      .step-line { display: none; }
      .import-summary { grid-template-columns: repeat(2,1fr); }
      .profile-actions { position: sticky; bottom: 0; flex-wrap: wrap; background: var(--imprint-surface); }
    }
  `,
  ];
  private action(action: string, detail: Record<string, unknown> = {}) {
    emit(this, "catalog-action", { action, ...detail });
  }

  private flowStep(state: CatalogState) {
    if (state.selectedProfile) return 4;
    if (
      state.guidedSession?.status === "completed" ||
      state.guidedSession?.pause_reason === "worked"
    )
      return 3;
    if (state.guidedSession) return 2;
    return 1;
  }

  private stepper(state: CatalogState) {
    const current = this.flowStep(state);
    return html`<div class="steps" aria-label=${`Step ${current} of 4`}>${["Find", "Test", "Confirm", "Import"].map((label, index) => html`${index ? html`<span class="step-line"></span>` : nothing}<span class="step ${current === index + 1 ? "active" : current > index + 1 ? "done" : ""}"><i>${current > index + 1 ? "✓" : index + 1}</i>${label}</span>`)}</div>`;
  }

  private emitterStatus() {
    return html`<div class="emitter"><strong>${this.emitterName}</strong><i class="ready-dot"></i><span class="muted">Ready</span></div>`;
  }

  render() {
    const state = this.catalog;
    if (!state) return nothing;
    const step = this.flowStep(state);
    const title =
      step === 2
        ? `Match your ${state.brand || state.category?.toUpperCase() || "appliance"}`
        : step === 3
          ? "Confirm your remote"
          : step === 4
            ? state.selectedProfile?.name || "Review commands"
            : "Add an appliance";
    return html`<section class="catalog"><header class="head"><div class="head-copy"><button class="back" @click=${() => this.action("close")}>Command library</button><h1>${title}</h1>${this.stepper(state)}</div>${this.emitterStatus()}</header>${state.error ? html`<imprint-feedback kind="error" .message=${state.error}></imprint-feedback>` : nothing}${this.renderMode(state)}</section>`;
  }

  private renderMode(state: CatalogState) {
    if (state.selectedProfile) return this.renderProfile(state);
    if (
      state.guidedSession?.status === "completed" ||
      state.guidedSession?.pause_reason === "worked"
    )
      return this.renderConfirm(state);
    if (state.guidedSession) return this.renderGuided(state);
    if (state.mode === "find") return this.renderSearch(state);
    if (state.mode === "match") return this.renderMatch(state);
    if (state.mode === "import") return this.renderImport(state);
    return html`<div class="choices"><button class="choice" @click=${() => this.action("mode", { mode: "find" })}><ha-icon icon="mdi:magnify"></ha-icon><h2>Find by brand or model</h2><p>Search the bundled catalog and preview a profile before importing it.</p></button><button class="choice" @click=${() => this.action("mode", { mode: "match" })}><ha-icon icon="mdi:radar"></ha-icon><h2>Identify my remote</h2><p>Learn a button and narrow matches with guided real-appliance tests.</p></button><button class="choice" @click=${() => this.action("mode", { mode: "import" })}><ha-icon icon="mdi:import"></ha-icon><h2>Import a file</h2><p>Inspect commands, unsupported entries, provenance, and loss before saving.</p></button></div>`;
  }

  private renderImport(state: CatalogState) {
    const preview: any = state.preview;
    const commands: any[] = preview?.commands || [];
    const appliances = Object.entries(this.registry.locations || {}).flatMap(
      ([locId, location]) =>
        Object.entries(location.appliances || {}).map(
          ([applianceId, appliance]) => ({
            key: `${locId}||${applianceId}`,
            name: appliance.name || applianceId,
            location: location.name || locId,
          }),
        ),
    );
    const preferredTarget =
      this.importTargetKey || String((state as any).importTargetKey || "");
    if (!this.importTarget && (preferredTarget || appliances.length))
      queueMicrotask(() => {
        if (!this.importTarget)
          this.importTarget = preferredTarget || appliances[0]?.key || "";
      });
    const nativeRestore =
      preview?.format === "native_json" && preview?.scope !== "command";
    return html`<section class="panel section grid"><h2>Import a remote file</h2><p class="muted">Choose or paste a supported Pronto, GIRR, Flipper, LIRC, raw, Zosung, or Imprint backup representation. You’ll preview unsupported commands and conversion loss before importing.</p><div class="actions"><label class="btn"><ha-icon icon="mdi:file-upload-outline"></ha-icon>Choose file<input class="sr-only" type="file" accept=".json,.ir,.xml,.conf,.txt,application/json,text/plain,application/xml" @change=${(event: Event) => void this.readFile(event)}></label></div><label class="field">Remote data<textarea placeholder="Paste Pronto, GIRR, Flipper, LIRC, raw timings, Zosung code, or an Imprint backup" .value=${this.importText} @input=${(e: Event) => this.setImportText((e.target as HTMLTextAreaElement).value)}></textarea></label><button class="btn primary" ?disabled=${this.busy || !this.importText.trim()} @click=${() => this.action("import-inspect")}>Inspect import</button>${preview ? html`<div class="grid"><div class="import-summary"><div class="metric"><span>Commands found</span><strong>${commands.length}</strong></div><div class="metric"><span>Unsupported</span><strong>${preview.unsupported_count || 0}</strong></div><div class="metric"><span>Round-trip</span><strong>${preview.loss_report?.lossless === false ? "Documented loss" : "Lossless where evaluated"}</strong></div></div><div class="commands">${commands.map((command) => html`<div class="command"><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon><div><strong>${command.name || command.command_id || "Unnamed command"}</strong><div class="muted">${command.compatible === false ? "Unsupported" : "Ready to import"}${command.loss_report?.lossless === false ? " · representation loss" : ""}</div></div><span class="badge ${command.compatible === false ? "warning" : "success"}">${command.compatible === false ? "Skipped" : "Ready"}</span></div>`)}</div>${nativeRestore ? html`<div class="notice"><ha-icon icon="mdi:folder-multiple-outline"></ha-icon><span>This native ${preview.scope || "library"} backup can restore its original locations, appliances, and revision history without overwriting existing commands.</span></div><button class="btn primary" ?disabled=${this.busy} @click=${() => this.action("import-restore")}>Restore original organization</button><div class="muted">Or import compatible commands into one appliance:</div>` : nothing}<label class="field">Import into<select .value=${this.importTarget} @change=${(event: Event) => (this.importTarget = (event.target as HTMLSelectElement).value)}><option value="">No appliance (organize later)</option>${appliances.map((appliance) => html`<option value=${appliance.key}>${appliance.name} · ${appliance.location}</option>`)}</select></label><button class="btn ${nativeRestore ? "" : "primary"}" ?disabled=${this.busy || !commands.some((command) => command.compatible !== false)} @click=${() => this.action("import-run", { targetKey: this.importTarget, commands, format: preview.format })}>Import compatible commands</button></div>` : nothing}${state.unsupportedCommands?.length ? html`<div class="notice warning"><ha-icon icon="mdi:alert-outline"></ha-icon><div><strong>${state.unsupportedCommands.length} unsupported command${state.unsupportedCommands.length === 1 ? "" : "s"}</strong>${state.unsupportedCommands.map((command) => html`<div>${command.name || "Unnamed"}: ${command.error || "Unsupported representation"}${command.source ? ` · ${command.source}` : ""}</div>`)}</div></div>` : nothing}<button class="btn" @click=${() => this.action("mode", { mode: "choices" })}>Choose another method</button></section>`;
  }

  private renderMatch(state: CatalogState) {
    const capturing = Boolean((state as any).capturing);
    return html`<section class="panel guided"><div class="guided-icon"><ha-icon icon=${capturing ? "mdi:access-point" : "mdi:remote"}></ha-icon></div><h2>${capturing ? "Waiting for a remote signal" : "Identify an unknown remote"}</h2><p>${capturing ? html`Point the original remote at <strong>${this.emitterName}</strong> and press one distinctive button once.` : "Capture one clear button. Imprint compares its timing fingerprint with the offline catalog, then lets you review and verify likely profiles."}</p>${capturing ? html`<div class="countdown" aria-live="polite">${this.matchRemaining}s</div><button class="btn" ?disabled=${this.busy} @click=${() => this.action("match-cancel")}>Cancel capture</button>` : html`<button class="btn primary" ?disabled=${this.busy} @click=${() => this.action("match-start")}>${state.searched ? "Capture another button" : "Capture a button"}</button>`}${state.searched && !(state.candidates || []).length ? html`<div class="notice warning"><ha-icon icon="mdi:alert-outline"></ha-icon><span>No catalog profile matched this signal. Try a different, distinctive button.</span></div>` : nothing}${
      (state.candidates || []).length
        ? html`<div class="result-list" style="width:100%;text-align:left">${(
            state.candidates || []
          ).map((match: any) => {
            const candidate = match.profile || {};
            return html`<article class="result"><div><strong>${candidate.name || candidate.model || candidate.profile_id}</strong><div class="muted">${[candidate.brand, candidate.model, candidate.category].filter(Boolean).join(" · ")}</div><span class="badge ${this.matchQuality(match).tone}">${this.matchQuality(match).label}</span></div><button class="btn" @click=${() => this.action("profile", { profileId: candidate.profile_id })}>Review</button></article>`;
          })}</div>`
        : nothing
    }<button class="btn" ?disabled=${capturing} @click=${() => this.action("mode", { mode: "choices" })}>Choose another method</button></section>`;
  }

  private matchQuality(match: any): { label: string; tone: string } {
    const quality = String(
      match.match_quality ||
        match.evidence_class ||
        match.match_type ||
        "unverified",
    ).toLowerCase();
    if (quality.includes("exact") || quality === "verified")
      return { label: "Exact fingerprint", tone: "success" };
    if (quality.includes("family") || quality.includes("protocol"))
      return { label: "Protocol family match", tone: "" };
    if (
      quality.includes("compat") ||
      quality.includes("normalized") ||
      quality === "likely"
    )
      return { label: "Compatible pattern", tone: "" };
    return { label: "Unverified candidate", tone: "warning" };
  }

  private setImportText(value: string) {
    this.importText = value;
    this.action("import-text", { text: value });
  }
  private async readFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.setImportText(await file.text());
    } catch {
      this.action("import-file-error", {
        message: "The selected file could not be read.",
      });
    } finally {
      input.value = "";
    }
  }

  private renderSearch(state: CatalogState) {
    const results = state.results || [];
    return html`<section class="grid"><div><h2>Find existing codes</h2><p class="muted">Search the local, versioned remote catalog. No original remote is needed.</p></div><form class="panel search-panel" @submit=${(
      e: SubmitEvent,
    ) => {
      e.preventDefault();
      this.action("search", {
        category: this.category,
        brand: this.brand,
        model: this.model,
      });
    }}><div class="search-fields"><label class="field">Category<select .value=${this.category} @change=${(e: Event) => (this.category = (e.target as HTMLSelectElement).value)}><option value="tv">TV</option><option value="receiver">Receiver</option><option value="soundbar">Soundbar</option><option value="media_player">Media player</option><option value="fan">Fan</option><option value="air_conditioner">Air conditioner</option><option value="generic">Other</option></select></label><label class="field">Brand<input placeholder="Vizio" .value=${this.brand || state.brand || ""} @input=${(e: Event) => (this.brand = (e.target as HTMLInputElement).value)}></label><label class="field">Model or remote number<input placeholder="Optional" .value=${this.model || state.model || ""} @input=${(e: Event) => (this.model = (e.target as HTMLInputElement).value)}></label><button class="btn primary" ?disabled=${this.busy || !(this.brand || state.brand || "").trim()}>Search codes</button></div></form>${state.searched && !results.length ? html`<div class="empty">No bundled profiles matched. Try a shorter model number or identify the remote from a learned button.</div>` : html`<div class="grid"><div class="status-line"><h2>${results.length} matching profile${results.length === 1 ? "" : "s"}</h2></div><div class="result-list">${results.map((result: any) => html`<article class="result"><div><strong>${result.name || result.model || result.profile_id}</strong><div class="muted">${result.match === "exact_model" ? "Exact model" : "Remote family"}</div></div><div><strong>${result.command_count || "—"} commands</strong><div class="muted">${result.protocol || "Raw timing"}</div></div><div class="catalog-meta">${result.source_name || "Bundled catalog"} · ${result.source_license || "license listed in profile"}<br><span style="color:var(--imprint-success)">Works with selected IR emitter</span></div><div class="result-actions"><button class="btn" @click=${() => this.action("profile", { profileId: result.profile_id })}>Preview</button><button class="btn primary" @click=${() => this.action("guided-start", { profileId: result.profile_id })}>Test this remote</button></div></article>`)}</div></div>`}<div class="catalog-meta">Catalog ${state.catalog?.version || "bundled"} · Available offline · ${state.catalog?.source || "versioned local source"}</div></section>`;
  }

  private renderProfile(state: CatalogState) {
    const profile: any = state.selectedProfile;
    const commands: any[] = profile.commands || [];
    const plan: any = profile.import_plan || state.importPlan || {};
    const starterIds: string[] = plan.starter_command_ids || [];
    if (!this.selectedCommandIds.length)
      queueMicrotask(() => {
        if (!this.selectedCommandIds.length)
          this.selectedCommandIds = [...starterIds];
      });
    return html`<section class="profile"><div class="role-head"><div><span class="badge">Remote family</span><h2>${profile.name || profile.model || profile.profile_id}</h2><p>${commands.length} commands · ${profile.source?.name || profile.source_name || "Bundled catalog"} · ${profile.source?.license || profile.source_license || "source license"}</p></div></div><div class="commands panel">${commands.map(
      (command) => {
        const metadata = command.import || {};
        const id = command.command_id;
        return html`<label class="command"><input type="checkbox" .checked=${this.selectedCommandIds.includes(id)} ?disabled=${!command.code} @change=${(e: Event) => (this.selectedCommandIds = (e.target as HTMLInputElement).checked ? [...this.selectedCommandIds, id] : this.selectedCommandIds.filter((value) => value !== id))}><div><strong>${command.name || id}</strong><div class="muted">${command.analysis?.protocol || profile.protocol || "Raw timing"} · ${command.signal?.carrier_frequency ? `${(command.signal.carrier_frequency / 1000).toFixed(1)} kHz` : "carrier assumed"}${metadata.target_conflict ? " · target conflict" : ""}${command.compatible === false ? " · unsupported" : ""}</div></div><button type="button" class="btn" ?disabled=${this.busy || !command.code} @click=${() => this.action("profile-test", { profileId: profile.profile_id, commandId: id })}>Test once</button></label>`;
      },
    )}</div><details><summary>Profile provenance and import checks</summary><div class="import-summary"><div class="metric"><span>Starter set</span><strong>${starterIds.length}</strong></div><div class="metric"><span>Target conflicts</span><strong>${plan.conflict_count ?? 0}</strong></div><div class="metric"><span>Duplicate matches</span><strong>${plan.duplicate_count ?? 0}</strong></div><div class="metric"><span>Unsupported</span><strong>${plan.unsupported_count ?? 0}</strong></div></div><pre><code>${JSON.stringify(plan.provenance || profile.source || {}, null, 2)}</code></pre></details><div class="profile-actions"><strong>${this.selectedCommandIds.length} selected</strong><button class="btn" @click=${() => {
      this.selectedCommandIds = [];
      this.action("profile-close");
    }}>Back</button><button class="btn" ?disabled=${this.busy} @click=${() => this.action("profile-import", { profile, mode: "starter", commandIds: starterIds })}>Import starter</button><button class="btn" ?disabled=${this.busy || !this.selectedCommandIds.length} @click=${() => this.action("profile-import", { profile, mode: "selected", commandIds: this.selectedCommandIds })}>Import selected</button><button class="btn primary" ?disabled=${this.busy} @click=${() => this.action("profile-import", { profile, mode: "all", commandIds: plan.all_command_ids || commands.filter((command) => command.code).map((command) => command.command_id) })}>Import ${commands.filter((command) => command.code).length}</button></div></section>`;
  }

  private renderGuided(state: CatalogState) {
    const session: any = state.guidedSession;
    const candidates: any[] = session.candidates || state.candidates || [];
    const progress = session.progress || {};
    const total =
      progress.total ||
      session.total_steps ||
      session.total ||
      candidates.length ||
      1;
    const current = Math.max(0, Number(progress.position || 1) - 1);
    const prompt =
      session.current_candidate?.command?.name ||
      session.prompt ||
      "Test the highlighted command";
    return html`<section class="guided"><div class="guided-main"><p class="muted">Candidate ${Math.min(total, current + 1)} of ${total} unique Power codes</p><h2>Make sure the TV is on</h2><p class="muted">${session.instruction || `We’ll send one ${prompt} command. If the appliance responds, stop here and tell us it worked.`}</p><div class="notice" style="justify-content:center">One press only · ${session.current_candidate?.command?.analysis?.protocol || "raw timing"} · Covers ${candidates.length || 1} known remote profile${candidates.length === 1 ? "" : "s"}</div><button class="btn primary wide" ?disabled=${this.busy || this.cooldown > 0 || session.status === "paused"} @click=${() => this.action("guided-test")}><ha-icon icon="mdi:play"></ha-icon>${this.cooldown ? `Retry in ${this.cooldown}s` : `Test ${prompt}`}</button><small class="muted">The next candidate stays locked until you answer.</small><hr style="width:100%;border:0;border-top:1px solid var(--imprint-line)"><strong style="color:var(--imprint-success)">${session.pending_test ? "Command sent once" : "Ready for one explicit test"}</strong><h3>Did the appliance respond?</h3><div class="actions" style="justify-content:center"><button class="btn" ?disabled=${this.busy || !session.pending_test} @click=${() => this.action("guided-answer", { result: "worked" })}>It worked</button><button class="btn" ?disabled=${this.busy || !session.pending_test} @click=${() => this.action("guided-answer", { result: "no_response" })}>No response</button><button class="btn" ?disabled=${this.busy || !session.pending_test} @click=${() => this.action("guided-answer", { result: "not_sure" })}>Not sure</button></div></div><aside class="guided-side"><h2>Remaining matches</h2><div class="guided-icon" style="margin:10px 0"><strong>${candidates.length || 1}</strong></div><p class="muted">${candidates.length || 1} profile${candidates.length === 1 ? "" : "s"} remain · equivalent signals are de-duplicated</p><hr style="border:0;border-top:1px solid var(--imprint-line);margin:22px 0"><h3>Why these tests?</h3><p class="muted">Each explicit one-shot test narrows the remaining candidates without an unattended sweep.</p><div class="actions"><button class="btn" ?disabled=${this.busy} @click=${() => this.action("guided-control", { command: session.status === "paused" ? "resume" : "pause" })}>${session.status === "paused" ? "Resume" : "Pause"}</button><button class="btn danger" ?disabled=${this.busy} @click=${() => this.action("guided-control", { command: "cancel" })}>Cancel</button></div></aside></section>`;
  }

  private renderConfirm(state: CatalogState) {
    const session: any = state.guidedSession || {};
    const candidates: any[] = session.candidates || state.candidates || [];
    const confirmed =
      candidates.find((candidate) => candidate.confirmed) ||
      session.current_candidate ||
      candidates[0];
    const profileId = confirmed?.profile_id || confirmed?.profile_ids?.[0];
    const profileName =
      confirmed?.profile_names?.[0] ||
      confirmed?.profile_name ||
      confirmed?.command?.source?.profile_name ||
      "Matching remote family";
    return html`<section class="grid"><div class="confirm-card"><h2>Your appliance responded to this code</h2><p class="muted">Choose the matching remote family, then review the commands before anything is imported.</p></div><fieldset class="panel section"><legend>Matching remote profiles</legend><label class="command"><input type="radio" name="confirmed-profile" checked><div><strong>${profileName}</strong><div class="muted">Uses the Power code you just confirmed</div></div></label></fieldset><div class="actions" style="justify-content:flex-end"><button class="btn" @click=${() => this.action("guided-control", { command: "resume" })}>Test again</button><button class="btn primary" ?disabled=${!profileId} @click=${() => this.action("profile", { profileId })}>Review and import commands</button></div></section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-catalog-guided": ImprintCatalogGuided;
  }
}
