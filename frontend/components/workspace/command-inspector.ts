import {
  css,
  html,
  nothing,
  type CSSResult,
  type TemplateResult,
} from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { Dict, LabCodeRepresentation, RegistryData } from "../../types";
import { buildHomeAssistantUse } from "../../core/home-assistant-use";
import { haSelectedValue } from "../../core/ha-controls";
import { slugify } from "../../core/utils";
import "../signal-lab/waveform";
import { renderFactGrid } from "../shared/metric-grid";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import {
  renderCodeRepresentationView,
  signalCodeViewStyles,
} from "../signal-lab/code-view";
import type { InspectorAction, InspectorTab } from "./events";

export interface CommandInspectorView {
  registry: RegistryData;
  profileId: string;
  commandId: string;
  applianceId: string;
  history: Dict | null;
  tab: InspectorTab;
  compact: boolean;
  busy: boolean;
  testEmitterRef: string;
  codeFormat: string;
  codeRepresentation?: LabCodeRepresentation;
  selectedRevision: number;
  revisionLabel: string;
  onAction: (action: InspectorAction) => void;
}

export const commandInspectorStyles: CSSResult[] = [signalCodeViewStyles, css`
  .command-inspector-dialog {
    --dialog-content-padding: 0;
    --ha-dialog-width-lg: min(790px, 100vw);
    --ha-dialog-max-height: 100dvh;
  }
  .command-inspector {
    position: sticky;
    top: 12px;
    width: 100%;
    max-width: 100%;
    max-height: calc(100dvh - 24px);
    overflow-x: hidden;
    overflow-y: auto;
    min-width: 0;
    container-type: inline-size;
  }
  .command-inspector.compact {
    position: static;
    max-height: none;
    border: 0;
    border-radius: 0;
    background: var(--imprint-surface);
    overflow: visible;
  }
  .command-inspector > *,
  .command-inspector .inspector-body > *,
  .command-inspector .inspector-section > *,
  .command-inspector .inspector-use > * {
    min-width: 0;
    max-width: 100%;
  }
  .command-inspector > .inspector-head {
    min-height: 72px;
    padding: 14px 54px 14px 16px;
    border-bottom: 1px solid var(--imprint-line);
    display: flex;
    align-items: center;
    gap: 12px;
    position: relative;
  }
  .command-inspector > .inspector-head > ha-icon {
    color: var(--imprint-accent);
    --mdc-icon-size: 28px;
  }
  .command-inspector > .inspector-head > div { min-width: 0; }
  .command-inspector > .inspector-head h2 {
    margin: 0 0 2px;
    overflow-wrap: anywhere;
  }
  .command-inspector .inspector-close {
    position: absolute;
    right: 10px;
    top: 13px;
  }
  .command-inspector .inspector-tabs {
    width: 100%;
    max-width: 100%;
    color: var(--imprint-muted);
  }
  .command-inspector .inspector-tabs ha-tab-group-tab {
    box-sizing: border-box;
    flex: 0 0 25%;
    width: 25%;
    max-width: 25%;
    min-width: 0;
    min-height: 44px;
    font-weight: 650;
    text-align: center;
  }
  .command-inspector .inspector-tabs ha-tab-group-tab::part(base) {
    box-sizing: border-box;
    width: 100%;
    justify-content: center;
    padding-inline: 8px;
  }
  .command-inspector .inspector-body {
    padding: 15px;
    display: grid;
    gap: 14px;
    min-width: 0;
  }
  .command-inspector .inspector-section {
    display: grid;
    gap: 13px;
    min-width: 0;
  }
  .command-inspector .command-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .command-inspector .inspector-section h3,
  .command-inspector .inspector-section p { margin: 0; }
  .command-inspector .inspector-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 8px;
  }
  .command-inspector .inspector-actions ha-button {
    width: 100%;
    min-width: 0;
  }
  .command-inspector .primary-action { width: 100%; }
  .command-inspector .inspector-use {
    display: grid;
    gap: 10px;
    padding-top: 13px;
    border-top: 1px solid var(--imprint-line);
  }
  .command-inspector .inspector-use ha-select {
    min-width: 0;
    max-width: 100%;
  }
  .command-inspector .inspector-use .actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .command-inspector .inspector-use .actions > * {
    width: 100%;
    min-width: 0;
    white-space: normal;
  }
  .command-inspector .inspector-use pre { max-height: 180px; }
  .command-inspector pre {
    margin: 0;
    padding: 12px;
    max-height: 220px;
    overflow: auto;
    border-radius: 9px;
    background: var(--imprint-surface-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .command-inspector .history { display: grid; gap: 8px; }
  .command-inspector .history-layout { display: grid; grid-template-columns: minmax(150px, .7fr) minmax(0, 1.3fr); gap: 12px; align-items: start; }
  .command-inspector .history-list { display: grid; gap: 6px; }
  .command-inspector .history-list ha-button { width: 100%; }
  .command-inspector .history-detail { display: grid; gap: 12px; min-width: 0; }
  .command-inspector .history-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 7px; }
  .command-inspector .history-actions > * { width: 100%; }
  .command-inspector .history-row {
    display: grid;
    gap: 3px;
    padding: 10px;
    border-radius: 9px;
    background: var(--imprint-surface-2);
  }
  @container (max-width: 420px) {
    .command-inspector .inspector-tabs ha-tab-group-tab { font-size: 13px; }
    .command-inspector .inspector-tabs ha-tab-group-tab::part(base) { padding-inline: 4px; }
    .command-inspector .history-layout { grid-template-columns: 1fr; }
  }
`];

export function renderCommandInspector({
  registry,
  profileId,
  commandId,
  applianceId,
  history,
  tab,
  compact,
  busy,
  testEmitterRef,
  codeFormat,
  codeRepresentation,
  selectedRevision,
  revisionLabel,
  onAction,
}: CommandInspectorView): TemplateResult | typeof nothing {
  const profile = registry.remote_profiles?.[profileId];
  const command = profile?.commands?.[commandId];
  if (!profile || !command) return nothing;
  const dependentIds = profile.dependent_appliance_ids || [];
  const appliance = registry.appliances?.[applianceId];
  const use = appliance
    ? buildHomeAssistantUse(applianceId, commandId, appliance, command)
    : null;
  const revisions = (history?.revisions || []) as Dict[];
  const currentRevision = Number(history?.current_revision || command.current_revision || 0);
  const activeRevision = Number(selectedRevision || currentRevision || revisions.at(-1)?.revision || 0);
  const activeRecord = revisions.find((revision) => Number(revision.revision) === activeRevision);
  const activeSnapshot = (activeRecord?.snapshot || {}) as Dict;
  const timings = command.signal?.timings || [];
  const duration = command.analysis?.total_duration_us ||
    timings.reduce((total, value) => total + value, 0);
  const tabPrefix = `command-${slugify(profileId)}-${slugify(commandId)}`;
  const panelId = `${tabPrefix}-${tab}-panel`;
  const selectedTabId = `${tabPrefix}-${tab}-tab`;
  const content = html`
    <aside
      class=${`command-inspector panel ${compact ? "compact" : ""}`}
      data-command-inspector
      role=${compact ? "document" : "complementary"}
      aria-label="Command details"
    >
      ${compact
        ? nothing
        : html`<header class="inspector-head">
            <ha-icon icon=${command.icon || "mdi:remote"}></ha-icon>
            <div>
              <h2 id=${`${tabPrefix}-heading`}>${command.name || commandId}</h2>
              <span class="muted">${profile.name || profileId}</span>
            </div>
            <ha-icon-button
              class="close inspector-close"
              data-command-inspector-close
              .label=${"Close command details"}
              @click=${() => onAction({ type: "close" })}
            ><ha-icon icon="mdi:close"></ha-icon></ha-icon-button>
          </header>`}
      <div class="body inspector-body">
        <ha-tab-group
          class="tabs inspector-tabs"
          aria-label="Command detail sections"
          tab-only
        >
          ${(["overview", "signal", "code", "history"] as InspectorTab[]).map(
            (nextTab) => html`<ha-tab-group-tab
              id=${`${tabPrefix}-${nextTab}-tab`}
              panel=${nextTab}
              .active=${tab === nextTab}
              @click=${() => onAction({ type: "tab-change", tab: nextTab })}
            >${nextTab[0].toUpperCase() + nextTab.slice(1)}</ha-tab-group-tab>`,
          )}
        </ha-tab-group>
        ${tab === "overview"
          ? html`<section
              id=${panelId}
              class="section inspector-section"
              role="tabpanel"
              aria-labelledby=${selectedTabId}
              tabindex="0"
            >
              ${dependentIds.length > 1
                ? renderWorkspaceNotice({
                    role: "note",
                    icon: "mdi:account-multiple-outline",
                    content: html`Shared by ${dependentIds.length} appliances. Changes apply to all of them.`,
                  })
                : nothing}
              ${renderFactGrid({
                className: "command-metrics",
                facts: [
                  {
                    label: "Protocol",
                    value: String(command.analysis?.protocol || "Raw timing"),
                  },
                  {
                    label: "Carrier",
                    value: command.signal?.carrier_frequency
                      ? `${(command.signal.carrier_frequency / 1000).toFixed(1)} kHz`
                      : "Unknown",
                  },
                  {
                    label: "Duration",
                    value: duration ? `${(duration / 1000).toFixed(2)} ms` : "Unknown",
                  },
                  {
                    label: "Revisions",
                    value: String(command.revision_count || revisions.length || 1),
                  },
                ],
              })}
              <ha-button
                class="primary-action"
                appearance="accent"
                variant="brand"
                .disabled=${busy || !testEmitterRef}
                @click=${() => onAction({ type: "test-command", profileId, commandId })}
              ><ha-icon slot="start" icon="mdi:send"></ha-icon>Test once</ha-button>
              <ha-button
                class="primary-action"
                appearance="outlined"
                variant="neutral"
                .disabled=${!timings.length}
                @click=${() => onAction({ type: "open-signal-lab", profileId, commandId })}
              ><ha-icon slot="start" icon="mdi:tune-vertical-variant"></ha-icon>Open in Signal Lab</ha-button>
              <div class="action-grid inspector-actions">
                <ha-button appearance="outlined" variant="neutral" @click=${() => onAction({ type: "edit-command", profileId, commandId })}>Edit</ha-button>
                <ha-button appearance="outlined" variant="neutral" @click=${() => onAction({ type: "duplicate-command", profileId, commandId })}>Duplicate</ha-button>
                <ha-button appearance="outlined" variant="neutral" @click=${() => onAction({ type: "relearn-command", profileId, commandId })}>Relearn</ha-button>
                <ha-button appearance="outlined" variant="danger" @click=${() => onAction({ type: "delete-command", profileId, commandId })}>Delete</ha-button>
              </div>
              <section class="ha-use inspector-use">
                <h3>Use in Home Assistant</h3>
                ${dependentIds.length
                  ? html`<ha-select
                      .label=${"Appliance for this action"}
                      .helper=${"Choose which appliance entity should send this command. The remote profile can be shared."}
                      .value=${applianceId}
                      .options=${dependentIds.map((id) => ({
                        value: id,
                        label: registry.appliances?.[id]?.name || id,
                      }))}
                      @selected=${(event: Event) =>
                        onAction({
                          type: "appliance-change",
                          applianceId: haSelectedValue(event),
                        })}
                    ></ha-select>`
                  : html`<p class="muted">Assign this profile to an appliance to create a standard Home Assistant action.</p>`}
                ${use?.yaml
                  ? html`<div class="actions">
                      <ha-button
                        appearance="outlined"
                        variant="neutral"
                        @click=${() => onAction({ type: "copy-action", value: use.yaml })}
                      ><ha-icon slot="start" icon="mdi:content-copy"></ha-icon>Copy action</ha-button>
                      ${use.deviceUrl
                        ? html`<ha-button
                            appearance="outlined"
                            variant="neutral"
                            .href=${use.deviceUrl}
                          ><ha-icon slot="start" icon="mdi:open-in-new"></ha-icon>Open HA device</ha-button>`
                        : nothing}
                      ${use.entityId
                        ? html`<ha-button
                            appearance="outlined"
                            variant="neutral"
                            @click=${() => onAction({ type: "copy-entity-id", value: use.entityId })}
                          ><ha-icon slot="start" icon="mdi:identifier"></ha-icon>Copy entity ID</ha-button>`
                        : nothing}
                    </div>
                    <ha-expansion-panel header="Ready-to-use Home Assistant action">
                      <pre><code>${use.yaml}</code></pre>
                    </ha-expansion-panel>`
                  : nothing}
              </section>
            </section>`
          : tab === "signal"
            ? html`<section
                id=${panelId}
                class="section inspector-section"
                role="tabpanel"
                aria-labelledby=${selectedTabId}
                tabindex="0"
              >
                ${timings.length
                  ? html`<imprint-signal-waveform
                      .readOnly=${true}
                      .timings=${timings}
                      .label=${`${command.name} timing waveform`}
                    ></imprint-signal-waveform>`
                  : renderWorkspaceEmpty({
                      compact: true,
                      description: "No editable timings are stored for this command.",
                    })}
                ${renderFactGrid({
                  className: "command-metrics",
                  facts: [
                    {
                      label: "Pulses",
                      value: String(command.analysis?.pulse_count || timings.length || "Unknown"),
                    },
                    {
                      label: "Frames",
                      value: String(command.analysis?.frame_count || "Unknown"),
                    },
                  ],
                })}
                <ha-button
                  class="primary-action"
                  appearance="accent"
                  variant="brand"
                  .disabled=${!timings.length}
                  @click=${() => onAction({ type: "open-signal-lab", profileId, commandId })}
                ><ha-icon slot="start" icon="mdi:tune-vertical-variant"></ha-icon>Open in Signal Lab</ha-button>
                ${renderWorkspaceNotice({
                  role: "note",
                  icon: "mdi:lock-outline",
                  content: html`Signal Lab works on a copy. The saved revision stays protected.`,
                })}
              </section>`
            : tab === "code"
              ? html`<section
                  id=${panelId}
                  class="section inspector-section"
                  role="tabpanel"
                  aria-labelledby=${selectedTabId}
                  tabindex="0"
                >
                  ${renderCodeRepresentationView({
                    format: codeFormat,
                    representation: codeRepresentation,
                    description: "Choose a representation to view or copy. Conversion does not change the saved command or transmit it.",
                    subject: "saved command",
                    filenameBase: `${profile.name || profileId}-${command.name || commandId}`,
                    request: (action, detail = {}) => {
                      if (action === "code-format") {
                        onAction({
                          type: "code-format-change",
                          profileId,
                          commandId,
                          format: String(detail.format || command.format || "raw_signed"),
                        });
                      } else if (action === "copy-code") {
                        onAction({ type: "copy-code", value: String(detail.value || "") });
                      } else if (action === "retry-code") {
                        onAction({
                          type: "retry-code-format",
                          profileId,
                          commandId,
                          format: codeFormat,
                        });
                      }
                    },
                  })}
                </section>`
              : html`<section
                  id=${panelId}
                  class="section inspector-section"
                  role="tabpanel"
                  aria-labelledby=${selectedTabId}
                  tabindex="0"
                >
                  ${history === null
                    ? html`<div class="loading" role="status" aria-live="polite"><ha-spinner></ha-spinner><span>Loading revision history…</span></div>`
                    : revisions.length && activeRecord
                      ? html`<div class="history-layout">
                          <div class="history-list" aria-label="Command revisions">
                            ${repeat(
                              [...revisions].reverse(),
                              (revision) => Number(revision.revision),
                              (revision) => html`<ha-button
                                appearance=${Number(revision.revision) === activeRevision ? "accent" : "outlined"}
                                variant=${Number(revision.revision) === activeRevision ? "brand" : "neutral"}
                                @click=${() => onAction({
                                  type: "revision-select",
                                  revision: Number(revision.revision),
                                  label: String(revision.label || ""),
                                })}
                              >Revision ${revision.revision}${Number(revision.revision) === currentRevision ? " · Current" : ""}</ha-button>`,
                            )}
                          </div>
                          <div class="history-detail">
                            <div>
                              <strong>Revision ${activeRevision}${activeRevision === currentRevision ? " · Current" : ""}</strong>
                              <p class="muted">${String(activeRecord.action || "Saved").replaceAll("_", " ")}${activeRecord.created_at ? ` · ${new Date(String(activeRecord.created_at)).toLocaleString()}` : ""}</p>
                            </div>
                            ${Array.isArray((activeSnapshot.signal as Dict | undefined)?.timings)
                              ? html`<imprint-signal-waveform .readOnly=${true} .timings=${(activeSnapshot.signal as Dict).timings as number[]} .label=${`Revision ${activeRevision} timing waveform`}></imprint-signal-waveform>`
                              : nothing}
                            <ha-input
                              .label=${"Revision label"}
                              maxlength="80"
                              .value=${revisionLabel}
                              @input=${(event: Event) => onAction({ type: "revision-label-change", value: (event.currentTarget as HTMLInputElement).value })}
                            ></ha-input>
                            <ha-button appearance="outlined" variant="neutral" .disabled=${busy || revisionLabel.trim() === String(activeRecord.label || "").trim()} @click=${() => onAction({ type: "save-revision-label", profileId, commandId, revision: activeRevision, label: revisionLabel })}>Save label</ha-button>
                            <div class="history-actions">
                              <ha-button appearance="outlined" variant="neutral" .disabled=${activeRevision === currentRevision || !Array.isArray((activeSnapshot.signal as Dict | undefined)?.timings)} @click=${() => onAction({ type: "compare-revision", profileId, commandId, revision: activeRevision, snapshot: activeSnapshot })}>Compare</ha-button>
                              <ha-button appearance="outlined" variant="neutral" .disabled=${busy || !testEmitterRef || !activeSnapshot.code} @click=${() => onAction({ type: "test-revision", profileId, commandId, revision: activeRevision, snapshot: activeSnapshot })}>Test once</ha-button>
                              <ha-button appearance="outlined" variant="neutral" .disabled=${!activeSnapshot.code} @click=${() => onAction({ type: "copy-revision-code", value: String(activeSnapshot.code || "") })}>Copy code</ha-button>
                              <ha-button appearance="outlined" variant="neutral" @click=${() => onAction({ type: "export-revision", profileId, commandId, revision: activeRevision, record: activeRecord })}>Export JSON</ha-button>
                              <ha-button appearance="outlined" variant="neutral" .disabled=${activeRevision === currentRevision} @click=${() => onAction({ type: "restore-revision", profileId, commandId, revision: activeRevision, snapshot: activeSnapshot })}>Restore</ha-button>
                            </div>
                          </div>
                        </div>`
                      : renderWorkspaceEmpty({ compact: true, description: "No revision history is available." })}
                </section>`}
      </div>
    </aside>
  `;
  return compact
    ? html`<ha-dialog
        class="command-inspector-dialog"
        data-command-inspector
        .open=${true}
        .headerTitle=${command.name || commandId}
        .headerSubtitle=${profile.name || profileId}
        width="large"
        @closed=${() => onAction({ type: "close" })}
      >${content}</ha-dialog>`
    : content;
}
