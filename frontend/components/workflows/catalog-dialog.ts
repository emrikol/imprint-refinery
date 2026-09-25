import { css, html, nothing, type TemplateResult } from "lit";
import { haControlChecked } from "../../core/ha-controls";
import {
  applianceTypeLabel,
  applianceTypeOptions,
} from "../../core/appliance-types";
import type { ApplianceData, Dict, InfraredHardwareEntity } from "../../types";
import { renderActionTile } from "../shared/action-tile";
import {
  renderDialogFooter,
  renderDialogShell,
  requestDialogClose,
} from "../shared/dialog";
import { renderSignalCaptureState } from "../shared/signal-capture-state";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import {
  type WorkflowActionHandler,
  workflowFieldInput,
  workflowFieldSelected,
} from "./events";
import {
  catalogCategoryOptions,
  commandRoleLabel,
  identifyCommandRoleOptions,
} from "./options";

export interface CatalogDialogOptions {
  stage?: "search" | "complete";
  data: Dict;
  appliances: Dict<ApplianceData>;
  emitters: InfraredHardwareEntity[];
  receivers: InfraredHardwareEntity[];
  error?: string;
  busy?: boolean;
  capturing?: boolean;
  captureRemaining?: number;
  captureTimeout?: number;
  onAction: WorkflowActionHandler;
}

export const catalogDialogStyles = css`
  .imprint-catalog-profile-dialog { --ha-dialog-width-md: 820px; }
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
  .imprint-identify-controls {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .imprint-identify-controls .imprint-identify-receiver {
    grid-column: 1 / -1;
  }
  .imprint-identify-summary {
    display: grid;
    gap: 8px;
    padding-block: 12px;
    border-block: 1px solid var(--imprint-line);
  }
  .imprint-identify-summary-head {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    align-items: baseline;
    justify-content: space-between;
  }
  .imprint-identify-summary-head span { color: var(--imprint-muted); }
  .imprint-identify-captures {
    display: grid;
    gap: 4px;
    margin: 0;
    padding-inline-start: 24px;
  }
  .imprint-identify-captures li { padding-inline-start: 4px; }
  .imprint-identify-captures small { color: var(--imprint-muted); }
  .imprint-identify-evidence {
    display: grid;
    gap: 5px;
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .imprint-identify-evidence li {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    align-items: baseline;
  }
  .imprint-identify-evidence span { color: var(--primary-text-color); }
  .imprint-identify-evidence small { overflow-wrap: anywhere; }
  .imprint-catalog-profile { display: grid; gap: 16px; min-width: 0; }
  .imprint-catalog-profile-head { display: grid; gap: 4px; }
  .imprint-catalog-profile-head h2,
  .imprint-catalog-profile-head p { margin: 0; }
  .imprint-catalog-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .imprint-catalog-metric { padding: 10px; min-width: 0; }
  .imprint-catalog-metric span,
  .imprint-catalog-metric strong { display: block; overflow-wrap: anywhere; }
  .imprint-catalog-metric span { color: var(--imprint-muted); font-size: 13px; }
  .imprint-catalog-commands { display: grid; gap: 8px; min-width: 0; }
  .imprint-catalog-command {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 12px;
  }
  .imprint-catalog-command ha-checkbox { min-width: 0; }
  .imprint-catalog-command-copy { display: grid; gap: 2px; min-width: 0; }
  .imprint-catalog-command-copy small { color: var(--imprint-muted); overflow-wrap: anywhere; }
  .imprint-catalog-command details { grid-column: 1 / -1; min-width: 0; }
  .imprint-catalog-command summary,
  .imprint-catalog-provenance summary { cursor: pointer; }
  .imprint-catalog-detail-list { margin: 8px 0 0; padding-inline-start: 22px; }
  .imprint-catalog-provenance pre,
  .imprint-catalog-command pre {
    overflow: auto;
    margin: 8px 0 0;
    padding: 10px;
    border-radius: 8px;
    background: var(--secondary-background-color);
    font: 13px/1.45 var(--code-font-family, monospace);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .imprint-catalog-methods { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .imprint-guided-center { display: grid; gap: 14px; justify-items: center; text-align: center; }
  .imprint-guided-center > * { max-width: 640px; }
  .imprint-guided-progress { color: var(--imprint-muted); font-size: 13px; }
  @media (max-width: 620px) {
    .imprint-catalog-methods { grid-template-columns: 1fr; }
    .imprint-identify-controls { grid-template-columns: 1fr; }
    .imprint-catalog-summary { grid-template-columns: 1fr 1fr; }
    .imprint-catalog-command { grid-template-columns: 1fr; }
    .imprint-catalog-command > ha-button { justify-self: stretch; }
  }
`;

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

const provenance = (value: unknown): string =>
  JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);

const renderSearch = ({
  data,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const results = (data.results || []) as Dict[];
  return renderDialogShell({
    heading: "Find remote codes",
    description:
      "Search the bundled offline catalog and import a reusable remote profile.",
    error,
    busy,
    workflow: "catalog-search",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-catalog-methods">
        ${renderActionTile({
          icon: "mdi:radar",
          title: "Identify from one button",
          description:
            "Capture a distinctive button and compare it with the offline catalog.",
          onActivate: () =>
            onAction({ type: "catalog-mode", mode: "identify" }),
        })}
        ${renderActionTile({
          icon: "mdi:remote",
          title: "Guided appliance test",
          description:
            "Try one safe command at a time, then answer Worked or No response.",
          onActivate: () =>
            onAction({ type: "catalog-mode", mode: "guided-setup" }),
        })}
      </div>
      <hr class="imprint-workflow-separator">
      <div class="imprint-workflow-grid">
        <ha-select autofocus .label=${"Category"} .value=${String(data.category || "")} .options=${catalogCategoryOptions(true)} @selected=${workflowFieldSelected(onAction, "category")}></ha-select>
        <ha-input .label=${"Brand"} .value=${String(data.brand || "")} placeholder="Brand" @input=${workflowFieldInput(onAction, "brand")}></ha-input>
        <ha-input class="imprint-workflow-wide" .label=${"Model"} .value=${String(data.model || "")} placeholder="Optional model" @input=${workflowFieldInput(onAction, "model")}></ha-input>
      </div>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="brand" appearance="accent" .disabled=${busy} @click=${() => onAction({ type: "catalog-search" })}>Search catalog</ha-button>
      </div>
      <div class="imprint-catalog-results">
        ${results.map(
          (result) => html`
          <div class="imprint-catalog-result">
            <div>
              <strong>${result.name || result.model || result.profile_id}</strong>
              <small>${[result.brand, result.model, result.command_count ? `${result.command_count} commands` : ""].filter(Boolean).join(" · ")}</small>
            </div>
            <ha-button variant="neutral" appearance="outlined" .disabled=${busy} @click=${() => onAction({ type: "catalog-preview", profile: result })}>Review profile</ha-button>
          </div>
        `,
        )}
      </div>
      ${
        data.searched && !results.length
          ? renderWorkspaceEmpty({
              compact: true,
              icon: "mdi:database-search-outline",
              heading: "No matching profiles",
              description: "No bundled profiles matched that search.",
            })
          : nothing
      }
    `,
  });
};

const hardwareOptions = (
  items: InfraredHardwareEntity[],
  placeholder: string,
) => [
  { value: "", label: placeholder },
  ...items
    .filter((item) => item.available)
    .map((item) => ({
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
}: CatalogDialogOptions): TemplateResult =>
  renderDialogShell({
    heading: "Guided remote matching",
    description:
      "Imprint sends one candidate at a time. Nothing is imported until you confirm a response.",
    error,
    busy,
    workflow: "catalog-guided-setup",
    onClose: () => onAction({ type: "close" }),
    content: html`
    <div class="imprint-workflow-grid">
      <ha-select autofocus .label=${"Category"} .value=${String(data.category || "")} .options=${catalogCategoryOptions()} @selected=${workflowFieldSelected(onAction, "category")}></ha-select>
      <ha-input .label=${"Brand"} .value=${String(data.brand || "")} placeholder="Brand" @input=${workflowFieldInput(onAction, "brand")}></ha-input>
      <ha-select class="imprint-workflow-wide" .label=${"Test with IR emitter"} .value=${String(data.infrared_emitter_ref || "")} .options=${hardwareOptions(emitters, "Choose an IR emitter")} @selected=${workflowFieldSelected(onAction, "infrared_emitter_ref")}></ha-select>
    </div>
    ${renderWorkspaceEmpty({
      compact: true,
      icon: "mdi:gesture-tap-button",
      heading: "You stay in control",
      description:
        "Each candidate is sent once only after you press Test. Answer Worked, No response, or Not sure before continuing.",
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
        ${
          paused
            ? html`<ha-button variant="brand" appearance="accent" .disabled=${busy} @click=${() => onAction({ type: "catalog-guided-control", command: "resume" })}>Resume testing</ha-button>`
            : html`<ha-button variant="brand" appearance="accent" .disabled=${busy || pending || delay > 0 || !data.infrared_emitter_ref} @click=${() => onAction({ type: "catalog-guided-test" })}>${delay > 0 ? `Next test available in ${Math.ceil(delay)}s` : "Test once"}</ha-button>`
        }
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
  const profileIds = Array.isArray(candidate.profile_ids)
    ? candidate.profile_ids.map(String)
    : [];
  const profileNames = Array.isArray(candidate.profile_names)
    ? candidate.profile_names.map(String)
    : [];
  const selected = String(data.guided_profile_id || profileIds[0] || "");
  return renderDialogShell({
    heading: "A command worked",
    description:
      "Choose the matching remote family to import as a reusable profile.",
    error,
    busy,
    workflow: "catalog-guided-confirm",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <ha-select .label=${"Matching remote profile"} .value=${selected} .options=${profileIds.map((value, index) => ({ value, label: profileNames[index] || value }))} @selected=${workflowFieldSelected(onAction, "guided_profile_id")}></ha-select>
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" @click=${() => onAction({ type: "catalog-guided-control", command: "resume" })}>Keep testing</ha-button>
        <ha-button variant="brand" appearance="accent" .disabled=${busy || !selected} @click=${() => onAction({ type: "catalog-preview", profile: { profile_id: selected, name: profileNames[profileIds.indexOf(selected)] || selected } })}>Review matching profile</ha-button>
      </div>
    `,
  });
};

const renderGuidedNoMatch = ({
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult =>
  renderDialogShell({
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
  capturing = false,
  captureRemaining = 0,
  captureTimeout = 60,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const results = (data.identify_results || []) as Dict[];
  const captures = Array.isArray(data.identify_captures)
    ? (data.identify_captures as Dict[])
    : [];
  const captureSummaries = Array.isArray(data.identify_capture_summaries)
    ? (data.identify_capture_summaries as Dict[])
    : [];
  const matchCount = Number(data.identify_match_count ?? results.length);
  const applianceType = String(data.identify_appliance_type || "generic");
  const identifying = Boolean(data.identifying);
  const identifyStage = String(
    data.identify_stage || (identifying ? "listening" : "idle"),
  );
  const listening = identifyStage === "listening";
  const processing = identifyStage === "matching";
  const selectedReceiver = receivers.find(
    (receiver) => receiver.ref === String(data.infrared_receiver_ref || ""),
  );
  const latestSummary = captureSummaries.at(-1);
  const duplicateOf = Number(latestSummary?.duplicate_of || 0);
  const categoryLabel = (value: unknown): string => {
    const category = String(value || "");
    return (
      catalogCategoryOptions(true).find((option) => option.value === category)
        ?.label || category.replaceAll("_", " ")
    );
  };
  const matchMethod = (evidence: Dict): string => {
    if (evidence.match_method) return String(evidence.match_method);
    return evidence.match_quality === "normalized_50us"
      ? "Timing fingerprint match"
      : "Decoded command match";
  };
  return renderDialogShell({
    heading: "Identify an unknown remote",
    description:
      "Choose what the remote controls, then capture one or more labeled buttons. Every additional button must match the same catalog profile.",
    error,
    busy,
    workflow: "catalog-identify",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-identify-controls">
        <ha-select
          .label=${"Appliance type"}
          .helper=${captures.length
            ? "Start over to change the appliance type."
            : "Prioritizes matching catalog profiles and relevant button labels."}
          .value=${applianceType}
          .options=${applianceTypeOptions(applianceType)}
          .disabled=${identifying || captures.length > 0}
          @selected=${workflowFieldSelected(onAction, "identify_appliance_type")}
        ></ha-select>
        <ha-select
          .label=${"Button you will press"}
          .value=${String(data.identify_role || "")}
          .options=${identifyCommandRoleOptions(applianceType)}
          .disabled=${identifying}
          @selected=${workflowFieldSelected(onAction, "identify_role")}
        ></ha-select>
        <ha-select
          class="imprint-identify-receiver"
          .label=${"IR receiver"}
          .value=${String(data.infrared_receiver_ref || "")}
          .options=${hardwareOptions(receivers, "Choose an IR receiver")}
          .disabled=${identifying}
          @selected=${workflowFieldSelected(onAction, "infrared_receiver_ref")}
        ></ha-select>
      </div>
      ${
        listening || processing
          ? renderSignalCaptureState({
              phase: listening ? "listening" : "processing",
              active: listening ? capturing : true,
              receiverName: selectedReceiver?.name || "the IR receiver",
              remaining: captureRemaining,
              timeout: captureTimeout,
              listeningContent: html`Point the original remote at
                <strong>${selectedReceiver?.name || "the IR receiver"}</strong>
                and press one distinctive button once.`,
              processingContent:
                "Signal received. Comparing its timing fingerprint with the offline catalog…",
              processingLabel: "Matching captured signal",
            })
          : nothing
      }
      <div class="imprint-workflow-inline-actions">
        <ha-button variant="neutral" appearance="outlined" .disabled=${identifying} @click=${() => onAction({ type: "catalog-mode", mode: "search" })}>Back</ha-button>
        ${
          identifying
            ? html`<ha-button variant="danger" appearance="outlined" @click=${() => onAction({ type: "catalog-cancel-capture" })}>${listening ? "Cancel capture" : "Cancel matching"}</ha-button>`
            : html`<ha-button variant="brand" appearance="accent" .disabled=${busy || !data.infrared_receiver_ref} @click=${() => onAction({ type: "catalog-identify" })}>${captures.length ? "Capture another button" : "Capture a button"}</ha-button>`
        }
      </div>
      ${
        captures.length
          ? html`<section class="imprint-identify-summary" role="status" aria-live="polite">
              <div class="imprint-identify-summary-head">
                <strong>${applianceTypeLabel(applianceType)} · ${captures.length} button${captures.length === 1 ? "" : "s"} captured</strong>
                <span>${matchCount} profile${matchCount === 1 ? "" : "s"} match${matchCount === 1 ? "es" : ""} every button${data.identify_truncated ? ` · showing first ${results.length}` : ""}</span>
              </div>
              <ol class="imprint-identify-captures">
                ${captureSummaries.map((summary, index) => {
                  const role = String(captures[index]?.role || "");
                  const count = Number(summary.profile_count || 0);
                  return html`<li>
                    ${role ? commandRoleLabel(role) : `Unspecified button ${index + 1}`}
                    <small>· ${count} individual profile match${count === 1 ? "" : "es"}</small>
                  </li>`;
                })}
              </ol>
              <div class="imprint-workflow-inline-actions">
                <ha-button variant="neutral" appearance="plain" .disabled=${identifying} @click=${() => onAction({ type: "catalog-identify-remove-last" })}>Remove last button</ha-button>
                <ha-button variant="neutral" appearance="plain" .disabled=${identifying} @click=${() => onAction({ type: "catalog-identify-reset" })}>Start over</ha-button>
              </div>
            </section>`
          : nothing
      }
      ${
        duplicateOf
          ? renderWorkspaceNotice({
              tone: "warning",
              role: "status",
              icon: "mdi:content-duplicate",
              content: html`This is the same signal as button ${duplicateOf}, so it did not narrow the results. Remove it and capture a different button.`,
            })
          : nothing
      }
      ${
        results.length
          ? html`<div class="imprint-catalog-results" role="list">${results.map(
              (match) => {
                const profile = (match.profile || {}) as Dict;
                const evidence = Array.isArray(match.evidence)
                  ? (match.evidence as Dict[])
                  : [match];
                return html`<div class="imprint-catalog-result" role="listitem">
                <div>
                  <strong>${profile.model || profile.name || profile.profile_id}</strong>
                  <small>${[profile.brand, categoryLabel(profile.category)].filter(Boolean).join(" · ")}</small>
                  <ul class="imprint-identify-evidence" aria-label="Matched buttons">
                    ${evidence.map((item, index) => {
                      const command = (item.command || {}) as Dict;
                      const role = String(captures[index]?.role || "");
                      return html`<li>
                        <span>${role ? commandRoleLabel(role) : `Button ${index + 1}`} → <strong>${command.name || command.command_id || "Catalog command"}</strong></span>
                        <small>· ${matchMethod(item)}</small>
                      </li>`;
                    })}
                  </ul>
                </div>
                <ha-button variant="neutral" appearance="outlined" @click=${() => onAction({ type: "catalog-preview", profile })}>Review profile</ha-button>
              </div>`;
              },
            )}</div>`
          : data.identified
            ? renderWorkspaceEmpty({
                compact: true,
                icon: "mdi:database-search-outline",
                heading:
                  captures.length > 1
                    ? "No profile matches every button"
                    : "No catalog match",
                description:
                  captures.length > 1
                    ? "Remove the last button and try a different one, or start over with broader button labels."
                    : "Try a broader button label, another distinctive button, or guided testing.",
              })
            : nothing
      }
    `,
  });
};

const renderProfile = ({
  data,
  emitters,
  error = "",
  busy = false,
  onAction,
}: CatalogDialogOptions): TemplateResult => {
  const profile = (data.selected_profile || {}) as Dict;
  const plan = (profile.import_plan || {}) as Dict;
  const commands = (profile.commands || []) as Dict[];
  const unsupported = (profile.unsupported_commands || []) as Dict[];
  const compatible = commands.filter(
    (command) => Boolean(command.code) && command.compatible !== false,
  );
  const compatibleIds = compatible.map((command) => String(command.command_id));
  const allIds = stringArray(plan.all_command_ids).filter((commandId) =>
    compatibleIds.includes(commandId),
  );
  const starterIds = stringArray(plan.starter_command_ids).filter((commandId) =>
    compatibleIds.includes(commandId),
  );
  const selectedIds = stringArray(data.selected_command_ids).filter(
    (commandId) => compatibleIds.includes(commandId),
  );
  const source = (plan.provenance || profile.source || {}) as Dict;
  return renderDialogShell({
    heading: "Review remote profile",
    description:
      "Choose exactly which commands to import. Nothing is saved until you confirm below.",
    error,
    busy,
    className: "imprint-catalog-profile-dialog",
    workflow: "catalog-profile",
    onClose: () => onAction({ type: "close" }),
    content: html`
      <div class="imprint-catalog-profile">
        <div class="imprint-catalog-profile-head">
          <h2>${profile.name || profile.model || profile.profile_id}</h2>
          <p class="muted">${[
            profile.brand,
            profile.model,
            source.name || profile.source_name,
            source.license || profile.source_license,
          ]
            .filter(Boolean)
            .join(" · ")}</p>
        </div>
        <ha-select
          .label=${"Test with IR emitter"}
          .value=${String(data.infrared_emitter_ref || "")}
          .options=${hardwareOptions(emitters, "Choose an IR emitter")}
          @selected=${workflowFieldSelected(onAction, "infrared_emitter_ref")}
        ></ha-select>
        <div class="imprint-catalog-summary" aria-label="Import checks">
          <div class="panel imprint-catalog-metric"><span>Starter commands</span><strong>${starterIds.length}</strong></div>
          <div class="panel imprint-catalog-metric"><span>Target conflicts</span><strong>${Number(plan.conflict_count || 0)}</strong></div>
          <div class="panel imprint-catalog-metric"><span>Duplicate matches</span><strong>${Number(plan.duplicate_count || 0)}</strong></div>
          <div class="panel imprint-catalog-metric"><span>Unsupported</span><strong>${Number(plan.unsupported_count ?? unsupported.length)}</strong></div>
        </div>
        ${
          Number(plan.duplicate_count || 0) > 0
            ? renderWorkspaceNotice({
                tone: "warning",
                role: "alert",
                icon: "mdi:content-duplicate",
                content:
                  "Some signals already exist in the command library. Expand a command’s import details before importing another copy.",
              })
            : nothing
        }
        <div class="imprint-catalog-commands">
          ${commands.map((command) => {
            const commandId = String(command.command_id || "");
            const metadata = (command.import || {}) as Dict;
            const signal = (command.signal || {}) as Dict;
            const analysis = (command.analysis || {}) as Dict;
            const conflict = (metadata.target_conflict || null) as Dict | null;
            const duplicates = (metadata.duplicates || []) as Dict[];
            const selectable =
              Boolean(command.code) && command.compatible !== false;
            const carrier = Number(signal.carrier_frequency || 0);
            const hasDetails = Boolean(
              conflict ||
              duplicates.length ||
              metadata.provenance ||
              command.source,
            );
            return html`
              <div class="panel imprint-catalog-command">
                <ha-checkbox
                  .checked=${selectedIds.includes(commandId)}
                  .disabled=${!selectable}
                  @change=${(event: Event) =>
                    onAction({
                      type: "catalog-selection-change",
                      commandId,
                      selected: haControlChecked(event),
                    })}
                >
                  <span class="imprint-catalog-command-copy">
                    <strong>${command.name || commandId}</strong>
                    <small>${[
                      analysis.protocol || command.format || "Raw timing",
                      carrier
                        ? `${(carrier / 1000).toFixed(1)} kHz`
                        : "Carrier not reported",
                      metadata.starter ? "Starter" : "Optional",
                      !selectable ? "Unsupported" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}</small>
                  </span>
                </ha-checkbox>
                <ha-button
                  variant="neutral"
                  appearance="outlined"
                  .disabled=${busy || !selectable || !data.infrared_emitter_ref}
                  title=${data.infrared_emitter_ref ? "Send this command once" : "Choose an IR emitter first"}
                  @click=${() => onAction({ type: "catalog-test-command", command })}
                ><ha-icon slot="start" icon="mdi:send"></ha-icon>Test once</ha-button>
                ${
                  hasDetails
                    ? html`
                  <details>
                    <summary>Import details</summary>
                    ${
                      conflict || duplicates.length
                        ? html`<ul class="imprint-catalog-detail-list">
                        ${conflict ? html`<li>Conflicts with ${conflict.name || conflict.command_id}${conflict.current_revision ? ` at revision ${conflict.current_revision}` : ""} in the selected target.</li>` : nothing}
                        ${duplicates.map((duplicate) => html`<li>Duplicates ${duplicate.remote_profile_id || "another profile"} / ${duplicate.command_id || "command"}${duplicate.match_basis ? ` by ${duplicate.match_basis}` : ""}.</li>`)}
                      </ul>`
                        : nothing
                    }
                    <pre>${provenance(metadata.provenance || command.source)}</pre>
                  </details>
                `
                    : nothing
                }
              </div>
            `;
          })}
        </div>
        ${
          unsupported.length
            ? renderWorkspaceNotice({
                tone: "warning",
                role: "alert",
                icon: "mdi:alert-outline",
                content: html`<div><strong>${unsupported.length} command${unsupported.length === 1 ? " is" : "s are"} not importable</strong><ul class="imprint-catalog-detail-list">${unsupported.map(
                  (command) => {
                    const commandProvenance = (command.provenance ||
                      {}) as Dict;
                    return html`<li><strong>${command.name || "Unnamed command"}:</strong> ${command.error || "Unsupported representation"}${commandProvenance.source_path ? ` · ${commandProvenance.source_path}` : ""}</li>`;
                  },
                )}</ul></div>`,
              })
            : nothing
        }
        <details class="imprint-catalog-provenance">
          <summary>Profile provenance</summary>
          <pre>${provenance(source)}</pre>
        </details>
        <strong>${selectedIds.length} command${selectedIds.length === 1 ? "" : "s"} selected</strong>
      </div>
    `,
    footer: renderDialogFooter([
      {
        label: "Back",
        disabled: busy,
        onClick: () => onAction({ type: "catalog-profile-back" }),
      },
      {
        label: `Import starter (${starterIds.length})`,
        disabled: busy || !starterIds.length,
        onClick: () =>
          onAction({
            type: "catalog-import",
            profile,
            commandIds: starterIds,
            mode: "starter",
          }),
      },
      {
        label: `Import selected (${selectedIds.length})`,
        disabled: busy || !selectedIds.length,
        onClick: () =>
          onAction({
            type: "catalog-import",
            profile,
            commandIds: selectedIds,
            mode: "selected",
          }),
      },
      {
        label: `Import all (${allIds.length})`,
        variant: "brand",
        appearance: "accent",
        disabled: busy || !allIds.length,
        onClick: () =>
          onAction({
            type: "catalog-import",
            profile,
            commandIds: allIds,
            mode: "all",
          }),
      },
    ]),
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
      ${
        applianceEntries.length
          ? html`
        <hr class="imprint-workflow-separator">
        <div class="imprint-workflow-grid">
          <ha-select class="imprint-workflow-wide" .label=${"Assign to an existing appliance"} .value=${String(data.appliance_id || "")} .options=${[
            { value: "", label: "Choose an appliance" },
            ...applianceEntries.map(([id, appliance]) => ({
              value: id,
              label: appliance.name || id,
            })),
          ]} @selected=${workflowFieldSelected(onAction, "appliance_id")}></ha-select>
        </div>
        <div class="imprint-workflow-inline-actions">
          <ha-button variant="neutral" appearance="outlined" .disabled=${busy || !data.appliance_id} @click=${() => onAction({ type: "catalog-assign" })}>Assign profile</ha-button>
        </div>
      `
          : nothing
      }
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
  if (mode === "profile") return renderProfile(options);
  return renderSearch(options);
};
