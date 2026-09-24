import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { applianceTypeLabel } from "../../core/appliance-types";
import { haControlChecked, haDropdownValue } from "../../core/ha-controls";
import type { RemoteProfileData } from "../../types";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceNotice } from "../shared/workspace-notice";
import { renderCommandCard } from "./command-card";
import type { RemoteProfileAction } from "./events";

export interface RemoteProfileCardView {
  profileId: string;
  profile: RemoteProfileData;
  selected: boolean;
  busy: boolean;
  testEmitterRef: string;
  selectedCommandId: string;
  selectedCommandIds: readonly string[] | null;
  onAction: (action: RemoteProfileAction) => void;
}

export const remoteProfileCardStyles: CSSResult = css`
  .remote-profile-card {
    padding: 16px;
    display: grid;
    gap: 14px;
    min-width: 0;
    container-type: inline-size;
  }
  .remote-profile-card.route-target {
    outline: 2px solid var(--imprint-accent);
    outline-offset: 2px;
    scroll-margin-top: 24px;
  }
  .remote-profile-card .profile-head {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    justify-content: space-between;
  }
  .remote-profile-card h3 { font-size: 20px; margin: 0 0 5px; }
  .remote-profile-card .profile-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    color: var(--imprint-muted);
  }
  .remote-profile-card .profile-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .remote-profile-card .commands {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(176px, 1fr));
    gap: 10px;
  }
  .remote-profile-card .command-selection-bar {
    min-width: 0;
    padding: 10px 12px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
    border: 1px solid var(--imprint-line);
    border-radius: 12px;
    background: var(--imprint-surface-2);
  }
  .remote-profile-card .command-selection-count {
    margin-inline-end: auto;
    font-weight: 700;
  }
  @container (max-width: 760px) {
    .remote-profile-card .profile-head { flex-direction: column; }
    .remote-profile-card .profile-actions { justify-content: flex-start; }
    .remote-profile-card .commands {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @container (max-width: 420px) {
    .remote-profile-card .commands { grid-template-columns: 1fr; }
  }
`;

export function renderRemoteProfileCard({
  profileId,
  profile,
  selected,
  busy,
  testEmitterRef,
  selectedCommandId,
  selectedCommandIds,
  onAction,
}: RemoteProfileCardView): TemplateResult {
  const commands = Object.entries(profile.commands || {});
  const commandIds = commands.map(([commandId]) => commandId);
  const selectionMode = selectedCommandIds !== null;
  const selectedSet = new Set(selectedCommandIds || []);
  const allSelected = Boolean(commandIds.length) &&
    commandIds.every((commandId) => selectedSet.has(commandId));
  const usedBy = profile.dependent_appliance_ids || [];
  const name = profile.name || profileId;
  const handleMenu = (event: Event): void => {
    const action = haDropdownValue(event);
    if (action === "import") onAction({ type: "import-signals", profileId });
    if (action === "export") onAction({ type: "backup", profileId });
    if (action === "edit") onAction({ type: "edit-profile", profileId });
    if (action === "duplicate") onAction({ type: "duplicate-profile", profileId });
    if (action === "delete") onAction({ type: "delete-profile", profileId });
  };

  return html`
    <article
      class=${`profile remote-profile-card panel ${selected ? "route-target" : ""}`}
      data-profile-id=${profileId}
      tabindex="-1"
    >
      <header class="profile-head">
        <div>
          <h3>${name}</h3>
          <div class="meta profile-meta">
            <span class="badge">${applianceTypeLabel(profile.appliance_type)}</span>
            <span>
              ${usedBy.length
                ? `Used by ${usedBy.length} appliance${usedBy.length === 1 ? "" : "s"}`
                : "Not assigned to an appliance"}
            </span>
          </div>
        </div>
        <div class="profile-actions">
          ${selectionMode
            ? html`<ha-button
                appearance="outlined"
                variant="neutral"
                @click=${() => onAction({ type: "cancel-command-selection", profileId })}
              >Done</ha-button>`
            : html`
              <ha-button
                appearance="outlined"
                variant="neutral"
                @click=${() => onAction({ type: "learn-command", profileId })}
              ><ha-icon slot="start" icon="mdi:access-point"></ha-icon>Learn command</ha-button>
              ${commands.length ? html`<ha-button
                appearance="outlined"
                variant="neutral"
                @click=${() => onAction({ type: "start-command-selection", profileId })}
              ><ha-icon slot="start" icon="mdi:checkbox-multiple-marked-outline"></ha-icon>Select</ha-button>` : nothing}
          <ha-button
            appearance="outlined"
            variant="neutral"
            @click=${() => onAction({ type: "create-appliance", profileId })}
          >Create appliance from this remote profile</ha-button>
              <ha-button
                appearance="outlined"
                variant="neutral"
                @click=${() => onAction({ type: "manage-appliances" })}
              >Manage appliances</ha-button>
              <ha-dropdown placement="bottom-end" @wa-select=${handleMenu}>
            <ha-icon-button slot="trigger" .label=${`Actions for ${name}`}>
              <ha-icon icon="mdi:dots-vertical"></ha-icon>
            </ha-icon-button>
            <ha-dropdown-item value="import">
              <ha-icon slot="icon" icon="mdi:import"></ha-icon>Import commands
            </ha-dropdown-item>
            <ha-dropdown-item value="export">
              <ha-icon slot="icon" icon="mdi:download-outline"></ha-icon>Export profile
            </ha-dropdown-item>
            <ha-dropdown-item value="edit">
              <ha-icon slot="icon" icon="mdi:pencil"></ha-icon>Edit profile
            </ha-dropdown-item>
            <ha-dropdown-item value="duplicate">
              <ha-icon slot="icon" icon="mdi:content-copy"></ha-icon>Duplicate profile
            </ha-dropdown-item>
            <ha-dropdown-item value="delete" variant="danger">
              <ha-icon slot="icon" icon="mdi:delete-outline"></ha-icon>Delete profile
            </ha-dropdown-item>
              </ha-dropdown>
            `}
        </div>
      </header>
      ${usedBy.length > 1
        ? renderWorkspaceNotice({
            icon: "mdi:account-multiple-outline",
            content: html`Changes here affect ${usedBy.length} appliances. Duplicate this profile first when you need an appliance-specific variation.`,
          })
        : nothing}
      ${selectionMode
        ? html`<div class="command-selection-bar" role="toolbar" aria-label=${`Organize commands in ${name}`}>
            <span class="command-selection-count" role="status" aria-live="polite">
              ${selectedSet.size} selected
            </span>
            <ha-checkbox
              .checked=${allSelected}
              @change=${(event: Event) =>
                onAction({
                  type: "select-all-commands",
                  profileId,
                  commandIds,
                  selected: haControlChecked(event),
                })}
            >Select all</ha-checkbox>
            <ha-button
              appearance="accent"
              variant="brand"
              .disabled=${!selectedSet.size}
              @click=${() =>
                onAction({
                  type: "move-selected-commands",
                  profileId,
                  commandIds: [...selectedSet],
                })}
            ><ha-icon slot="start" icon="mdi:folder-move-outline"></ha-icon>Move to another profile</ha-button>
          </div>`
        : nothing}
      ${commands.length
        ? html`<div class="commands">
            ${repeat(
              commands,
              ([commandId]) => commandId,
              ([commandId, command]) =>
                renderCommandCard({
                  profileId,
                  commandId,
                  command,
                  selected: selectedCommandId === commandId,
                  selectionMode,
                  checked: selectedSet.has(commandId),
                  busy,
                  testEmitterRef,
                  onAction,
                }),
            )}
          </div>`
        : renderWorkspaceEmpty({
            compact: true,
            description:
              "No commands yet. Learn from a receiver or create a custom signal.",
            actions: html`<div class="actions">
              <ha-button
                appearance="accent"
                @click=${() => onAction({ type: "learn-command", profileId })}
              >Learn command</ha-button>
              <ha-button
                appearance="outlined"
                variant="neutral"
                @click=${() => onAction({ type: "create-custom-signal", profileId })}
              >Create custom signal</ha-button>
            </div>`,
          })}
    </article>
  `;
}
