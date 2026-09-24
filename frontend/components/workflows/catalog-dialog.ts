import { css, html, nothing, type TemplateResult } from "lit";
import type { ApplianceData, Dict, InfraredHardwareEntity } from "../../types";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";

export interface CatalogDialogOptions {
  stage?: "search" | "complete";
  data: Dict;
  appliances: Dict<ApplianceData>;
  emitters: InfraredHardwareEntity[];
  receivers: InfraredHardwareEntity[];
  error?: string;
  busy?: boolean;
  onAction: WorkflowActionHandler;
}

export const catalogDialogStyles = css`
  .imprint-catalog-results { display: grid; gap: 8px; min-width: 0; }
  .imprint-catalog-result {
    padding: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    border: 1px solid var(--imprint-line);
    border-radius: 10px;
  }
  .imprint-catalog-result strong,
  .imprint-catalog-result small { display: block; }
  .imprint-catalog-result > div { flex: 1 1 240px; min-width: 0; }
  .imprint-catalog-result > ha-button { flex: 0 1 auto; }
  .imprint-catalog-result small { color: var(--imprint-muted); }
  .imprint-catalog-methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .imprint-catalog-method {
    min-width: 0;
    padding: 14px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 12px;
    align-items: start;
    width: 100%;
    text-align: start;
  }
  .imprint-catalog-method ha-icon { color: var(--imprint-accent); }
  .imprint-catalog-method strong,
  .imprint-catalog-method span { display: block; }
  .imprint-catalog-method span { margin-top: 3px; color: var(--imprint-muted); }
  .imprint-guided-center { display: grid; gap: 14px; justify-items: center; text-align: center; }
  .imprint-guided-center > * { max-width: 640px; }
  .imprint-guided-progress { color: var(--imprint-muted); font-size: 13px; }
  @media (max-width: 620px) { .imprint-catalog-methods { grid-template-columns: 1fr; } }
`;

const renderSearch = ({
  data,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const results = (data.results || []) as Dict[];
  return renderDialogShell({
    heading: "Find remote codes",
    description: "Search the bundled offline catalog and import a reusable remote profile.",
    error,
    busy,
    workflow: "catalog-search",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-catalog-methods">
        <ha-button class="imprint-catalog-method" appearance="outlined" variant="neutral" @click=${() => onAction({ type: "catalog-mode", mode: "identify" })}>
          <ha-icon slot="start" icon="mdi:radar"></ha-icon><span><strong>Identify from one button</strong><span>Capture a distinctive button and compare it with the offline catalog.</span></span>
        </ha-button>
        <ha-button class="imprint-catalog-method" appearance="outlined" variant="neutral" @click=${() => onAction({ type: "catalog-mode", mode: "guided-setup" })}>
          <ha-icon slot="start" icon="mdi:remote"></ha-icon><span><strong>Guided appliance test</strong><span>Try one safe command at a time, then answer Worked or No response.</span></span>
        </ha-button>
      </div>
      <hr class="imprint-workflow-separator">
      <div class="imprint-workflow-grid">
        <ha-input autofocus .label=${"Category"} .value=${String(data.category || "")} placeholder="tv, fan, receiver" @input=${workflowFieldInput(onAction, "category")}></ha-input>
        <ha-input .label=${"Brand"} .value=${String(data.brand || "")} placeholder="Brand" @input=${workflowFieldInput(onAction, "brand")}></ha-input>
        <ha-input class="imprint-workflow-wide" .label=${"Model"} .value=${String(data.model || "")} placeholder="Optional model" @input=${workflowFieldInput(onAction, "model")}></ha-input>
      </div>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="brand" appearance="accent" .disabled=${busy} @click=${() => onAction({ type: "catalog-search" })}>Search catalog</ha-button>
      </div>
      <div class="imprint-catalog-results">
        ${results.map((result) => html`
          <div class="imprint-catalog-result">
            <div>
              <strong>${result.name || result.model || result.profile_id}</strong>
              <small>${[result.brand, result.model, result.command_count ? `${result.command_count} commands` : ""].filter(Boolean).join(" · ")}</small>
            </div>
            <ha-button variant="neutral" appearance="outlined" .disabled=${busy} @click=${() => onAction({ type: "catalog-import", profile: result })}>Import profile</ha-button>
          </div>
        `)}
      </div>
      ${data.searched && !results.length
        ? renderWorkspaceEmpty({
            compact: true,
            icon: "mdi:database-search-outline",
            heading: "No matching profiles",
            description: "No bundled profiles matched that search.",
          })
        : nothing}
    `,
  });
};

const hardwareOptions = (
  items: InfraredHardwareEntity[],
  placeholder: string,
) => [
  { value: "", label: placeholder },
  ...items.filter((item) => item.available).map((item) => ({
    value: item.ref,
    label: item.name || item.entity_id || item.ref,
  })),
];

const renderGuidedSetup = ({
  data,
  emitters,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => renderDialogShell({
  heading: "Guided remote matching",
  description: "Imprint sends one candidate at a time. Nothing is imported until you confirm a response.",
  error,
  busy,
  workflow: "catalog-guided-setup",
  onClose: () => onAction({ type: "close" }),
  content: html`
    <div class="imprint-workflow-grid">
      <ha-input autofocus .label=${"Category"} .value=${String(data.category || "")} placeholder="tv, fan, receiver" @input=${workflowFieldInput(onAction, "category")}></ha-input>
      <ha-input .label=${"Brand"} .value=${String(data.brand || "")} placeholder="Brand" @input=${workflowFieldInput(onAction, "brand")}></ha-input>
      <ha-select class="imprint-workflow-wide" .label=${"Test with IR emitter"} .value=${String(data.infrared_emitter_ref || "")} .options=${hardwareOptions(emitters, "Choose an IR emitter")} @selected=${workflowFieldSelected(onAction, "infrared_emitter_ref")}></ha-select>
    </div>
    ${renderWorkspaceEmpty({
      compact: true,
      icon: "mdi:gesture-tap-button",
      heading: "You stay in control",
      description: "Each candidate is sent once only after you press Test. Answer Worked, No response, or Not sure before continuing.",
    })}
    <div class="imprint-workflow-inline-actions">
      <ha-button variant="neutral" appearance="outlined" @click=${() => onAction({ type: "catalog-mode", mode: "search" })}>Back</ha-button>
      <ha-button variant="brand" appearance="accent" .disabled=${busy || !String(data.category || "").trim() || !String(data.brand || "").trim() || !data.infrared_emitter_ref} @click=${() => onAction({ type: "catalog-guided-start" })}>Start guided matching</ha-button>
    </div>
  `,
});

const renderGuided = ({
  data,
  emitters,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const session = (data.guided_session || {}) as Dict;
  const candidate = (session.current_candidate || {}) as Dict;
  const command = (candidate.command || {}) as Dict;
  const progress = (session.progress || {}) as Dict;
  const pending = Boolean(session.pending_test);
  const paused = session.status === "paused";
  const delay = Number(data.guided_cooldown || 0);
  return renderDialogShell({
    heading: "Guided remote matching",
    description: `Candidate ${Number(progress.position || 1)} of ${Number(progress.total || 1)} · ${String(command.name || "Power")}`,
    error,
    busy,
    workflow: "catalog-guided",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-guided-center">
        <ha-icon icon="mdi:remote" style="--mdc-icon-size:56px;color:var(--imprint-accent)"></ha-icon>
        <h2>Watch the appliance, then send one test</h2>
        <p class="muted">This command represents ${Array.isArray(candidate.profile_ids) ? candidate.profile_ids.length : 1} matching remote profile${Array.isArray(candidate.profile_ids) && candidate.profile_ids.length === 1 ? "" : "s"}.</p>
        <ha-select .label=${"Test with IR emitter"} .value=${String(data.infrared_emitter_ref || "")} .options=${hardwareOptions(emitters, "Choose an IR emitter")} @selected=${workflowFieldSelected(onAction, "infrared_emitter_ref")}></ha-select>
        ${paused
          ? html`<ha-button variant="brand" appearance="accent" .disabled=${busy} @click=${() => onAction({ type: "catalog-guided-control", command: "resume" })}>Resume testing</ha-button>`
          : html`<ha-button variant="brand" appearance="accent" .disabled=${busy || pending || delay > 0 || !data.infrared_emitter_ref} @click=${() => onAction({ type: "catalog-guided-test" })}>${delay > 0 ? `Next test available in ${Math.ceil(delay)}s` : "Test once"}</ha-button>`}
        <strong>${pending ? "Command sent once. Did the appliance respond?" : "No command is sent automatically."}</strong>
        <div class="imprint-workflow-inline-actions">
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !pending} @click=${() => onAction({ type: "catalog-guided-answer", result: "worked" })}>Worked</ha-button>
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !pending} @click=${() => onAction({ type: "catalog-guided-answer", result: "no_response" })}>No response</ha-button>
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !pending} @click=${() => onAction({ type: "catalog-guided-answer", result: "not_sure" })}>Not sure</ha-button>
        </div>
        <ha-button variant="danger" appearance="plain" .disabled=${busy || pending} @click=${() => onAction({ type: "catalog-guided-control", command: "cancel" })}>Cancel guided matching</ha-button>
      </div>
    `,
  });
};

const renderGuidedConfirm = (options: CatalogDialogOptions): TemplateResult => {
  const { data, error = "", busy = false, onAction } = options;
  const session = (data.guided_session || {}) as Dict;
  const candidate = (session.current_candidate || {}) as Dict;
  const profileIds = Array.isArray(candidate.profile_ids) ? candidate.profile_ids.map(String) : [];
  const profileNames = Array.isArray(candidate.profile_names) ? candidate.profile_names.map(String) : [];
  const selected = String(data.guided_profile_id || profileIds[0] || "");
  return renderDialogShell({
    heading: "A command worked",
    description: "Choose the matching remote family to import as a reusable profile.",
    error,
    busy,
    workflow: "catalog-guided-confirm",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <ha-select .label=${"Matching remote profile"} .value=${selected} .options=${profileIds.map((value, index) => ({ value, label: profileNames[index] || value }))} @selected=${workflowFieldSelected(onAction, "guided_profile_id")}></ha-select>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" @click=${() => onAction({ type: "catalog-guided-control", command: "resume" })}>Keep testing</ha-button>
        <ha-button variant="brand" appearance="accent" .disabled=${busy || !selected} @click=${() => onAction({ type: "catalog-import", profile: { profile_id: selected, name: profileNames[profileIds.indexOf(selected)] || selected } })}>Import matching profile</ha-button>
      </div>
    `,
  });
};

const renderGuidedNoMatch = ({ error = "", busy = false, onAction }: CatalogDialogOptions): TemplateResult => renderDialogShell({
  heading: "No confirmed match",
  description: "None of the candidate commands produced a response.",
  error,
  busy,
  workflow: "catalog-guided-no-match",
  onClose: () => onAction({ type: "close" }),
  content: html`
    ${renderWorkspaceEmpty({ compact: true, icon: "mdi:remote-off", heading: "No matching remote found", description: "Try a shorter brand name, identify a distinctive button, or import an existing remote file." })}
    <div class="imprint-workflow-inline-actions"><ha-button variant="brand" appearance="accent" @click=${() => onAction({ type: "catalog-mode", mode: "search" })}>Try another method</ha-button></div>
  `,
});

const renderIdentify = ({
  data,
  receivers,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const results = (data.identify_results || []) as Dict[];
  const identifying = Boolean(data.identifying);
  return renderDialogShell({
    heading: "Identify an unknown remote",
    description: "Capture one distinctive button and compare its timing fingerprint with the offline catalog.",
    error,
    busy,
    workflow: "catalog-identify",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <ha-select .label=${"IR receiver"} .value=${String(data.infrared_receiver_ref || "")} .options=${hardwareOptions(receivers, "Choose an IR receiver")} @selected=${workflowFieldSelected(onAction, "infrared_receiver_ref")}></ha-select>
      ${identifying ? renderWorkspaceEmpty({ compact: true, icon: "mdi:access-point", heading: "Waiting for a remote signal", description: "Point the original remote at the receiver and press one distinctive button once." }) : nothing}
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" .disabled=${identifying} @click=${() => onAction({ type: "catalog-mode", mode: "search" })}>Back</ha-button>
        ${identifying
          ? html`<ha-button variant="danger" appearance="outlined" @click=${() => onAction({ type: "catalog-cancel-capture" })}>Cancel capture</ha-button>`
          : html`<ha-button variant="brand" appearance="accent" .disabled=${busy || !data.infrared_receiver_ref} @click=${() => onAction({ type: "catalog-identify" })}>Capture a button</ha-button>`}
      </div>
      ${results.length ? html`<div class="imprint-catalog-results">${results.map((match) => {
        const profile = (match.profile || {}) as Dict;
        return html`<div class="imprint-catalog-result"><div><strong>${profile.name || profile.model || profile.profile_id}</strong><small>${[profile.brand, profile.model, match.match_quality].filter(Boolean).join(" · ")}</small></div><ha-button variant="neutral" appearance="outlined" @click=${() => onAction({ type: "catalog-import", profile })}>Import profile</ha-button></div>`;
      })}</div>` : data.identified ? renderWorkspaceEmpty({ compact: true, icon: "mdi:database-search-outline", heading: "No catalog match", description: "Try another distinctive button or use guided testing." }) : nothing}
    `,
  });
};

const renderComplete = ({
  data,
  appliances,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const applianceEntries = Object.entries(appliances);
  const profileId = String(data.remote_profile_id || "");
  return renderDialogShell({
    heading: "Remote profile imported",
    description: `${String(data.remote_profile_name || profileId)} is ready to use.`,
    error,
    busy,
    workflow: "catalog-complete",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <p>Connect this command set to equipment now, or finish and assign it later.</p>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="brand" appearance="accent" @click=${() => onAction({ type: "catalog-create-appliance", profileId })}>
          <ha-icon slot="start" icon="mdi:plus"></ha-icon>Create appliance
        </ha-button>
      </div>
      ${applianceEntries.length ? html`
        <hr class="imprint-workflow-separator">
        <div class="imprint-workflow-grid">
          <ha-select class="imprint-workflow-wide" .label=${"Assign to an existing appliance"} .value=${String(data.appliance_id || "")} .options=${[
            { value: "", label: "Choose an appliance" },
            ...applianceEntries.map(([id, appliance]) => ({ value: id, label: appliance.name || id })),
          ]} @selected=${workflowFieldSelected(onAction, "appliance_id")}></ha-select>
        </div>
        <div class="imprint-workflow-inline-actions">
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !data.appliance_id} @click=${() => onAction({ type: "catalog-assign" })}>Assign profile</ha-button>
        </div>
      ` : nothing}
    `,
    footer: renderDialogFooter([
      {
        label: "Done",
        disabled: busy,
        onClick: requestDialogClose,
      },
    ]),
  });
};

export const renderCatalogDialog = (
  options: CatalogDialogOptions,
): TemplateResult => {
  if (options.stage === "complete") return renderComplete(options);
  const mode = String(options.data.mode || "search");
  if (mode === "guided-setup") return renderGuidedSetup(options);
  if (mode === "guided") return renderGuided(options);
  if (mode === "guided-confirm") return renderGuidedConfirm(options);
  if (mode === "guided-no-match") return renderGuidedNoMatch(options);
  if (mode === "identify") return renderIdentify(options);
  return renderSearch(options);
};
