import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import { applianceTypeIcon } from "../../core/appliance-types";
import { haDropdownValue } from "../../core/ha-controls";
import type { ApplianceData, InfraredHardwareEntity } from "../../types";
import { renderFactGrid } from "../shared/metric-grid";
import { renderStatus } from "../shared/status";
import type { ApplianceAction } from "./events";

export interface ApplianceCardView {
  applianceId: string;
  appliance: ApplianceData;
  emitter?: InfraredHardwareEntity;
  profileName: string;
  profileType: string;
  selected: boolean;
  onAction: (action: ApplianceAction) => void;
}

export const applianceCardStyles: CSSResult = css`
  ha-card.appliance-card {
    position: relative;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    --ha-card-background: color-mix(
      in srgb,
      var(--card-background-color) 96%,
      var(--imprint-accent)
    );
    --ha-card-border-color: color-mix(
      in srgb,
      var(--imprint-accent) 18%,
      var(--divider-color)
    );
  }
  .appliance-card .card-primary {
    position: relative;
    display: grid;
    gap: 14px;
    height: 100%;
    min-width: 0;
    padding: 17px 56px 17px 17px;
    box-sizing: border-box;
    color: inherit;
    cursor: pointer;
    outline: none;
    --ha-ripple-hover-color: transparent;
  }
  .appliance-card .card-primary:hover {
    background: var(--ha-color-fill-neutral-quiet-resting);
  }
  .appliance-card .card-primary:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ha-color-focus, var(--primary-color));
  }
  ha-card.appliance-card.route-target {
    outline: 2px solid var(--imprint-accent);
    outline-offset: 2px;
    scroll-margin-top: 24px;
  }
  .appliance-card h3 { font-size: 19px; margin: 0; }
  .appliance-card .appliance-heading {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .appliance-card .appliance-icon {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
  }
  .appliance-card .appliance-icon ha-icon { --mdc-icon-size: 25px; }
  .appliance-card .appliance-heading-copy { min-width: 0; }
  .appliance-card .appliance-status {
    display: flex;
    margin-top: 5px;
  }
  .appliance-card .appliance-menu {
    position: absolute;
    z-index: 1;
    top: 8px;
    inset-inline-end: 8px;
  }
  .appliance-card .appliance-menu a {
    color: inherit;
    text-decoration: none;
  }
`;

export function renderApplianceCard({
  applianceId,
  appliance,
  emitter,
  profileName,
  profileType,
  selected,
  onAction,
}: ApplianceCardView): TemplateResult {
  const status = appliance.route_status || "unassigned";
  const name = appliance.name || applianceId;
  const statusLabel =
    status === "ready"
      ? "Ready"
      : status === "unassigned"
        ? "Setup required"
        : status === "missing"
          ? "Emitter removed"
          : "Emitter unavailable";
  const entityId = appliance.home_assistant?.entity_id || "";
  const entityAvailable = Boolean(appliance.home_assistant?.available);
  const handleMenu = (event: Event): void => {
    const action = haDropdownValue(event);
    if (action === "open-profile" && appliance.remote_profile_id) {
      onAction({
        type: "open-profile",
        profileId: appliance.remote_profile_id,
      });
    }
    if (action === "delete") {
      onAction({ type: "delete-appliance", applianceId });
    }
  };
  const openEditor = (): void =>
    onAction({ type: "edit-appliance", applianceId });
  const handlePrimaryKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openEditor();
  };
  const displayStatus =
    status !== "ready"
      ? renderStatus({
          state: status,
          label: statusLabel,
          context: "Appliance route",
        })
      : !entityId
        ? renderStatus({
            state: "unassigned",
            label: "Entity not projected",
            context: "Home Assistant entity",
          })
        : !entityAvailable
          ? renderStatus({
              state: "unavailable",
              label: "Entity unavailable",
              context: "Home Assistant entity",
            })
          : renderStatus({
              state: "ready",
              label: "Ready",
              context: "Appliance",
            });
  return html`
    <ha-card
      outlined
      class=${`appliance appliance-card ${selected ? "route-target" : ""}`}
      data-appliance-id=${applianceId}
      tabindex="-1"
    >
      <div
        class="card-primary"
        role="button"
        tabindex="0"
        aria-label=${`Edit ${name}`}
        @click=${openEditor}
        @keydown=${handlePrimaryKeydown}
      >
        <ha-ripple></ha-ripple>
        <div class="appliance-heading">
          <span class="appliance-icon" aria-hidden="true">
            <ha-icon icon=${applianceTypeIcon(profileType)}></ha-icon>
          </span>
          <div class="appliance-heading-copy">
            <h3>${name}</h3>
            <div class="appliance-status">${displayStatus}</div>
          </div>
        </div>
        ${renderFactGrid({
          layout: "rows",
          facts: [
            { label: "Area", value: appliance.area?.name || "No Area" },
            { label: "Remote profile", value: profileName },
            {
              label: "IR emitter",
              value:
                emitter?.name ||
                (appliance.infrared_emitter_ref
                  ? "Missing IR emitter"
                  : "Choose an IR emitter"),
            },
          ],
        })}
      </div>
      <div class="appliance-menu">
        <ha-dropdown
          placement="bottom-end"
          @click=${(event: Event) => event.stopPropagation()}
          @wa-select=${handleMenu}
        >
          <ha-icon-button slot="trigger" .label=${`Actions for ${name}`}>
            <ha-icon icon="mdi:dots-vertical"></ha-icon>
          </ha-icon-button>
          ${
            appliance.remote_profile_id
              ? html`<ha-dropdown-item value="open-profile">
                <ha-icon slot="icon" icon="mdi:remote"></ha-icon>
                Open remote profile
              </ha-dropdown-item>`
              : nothing
          }
          ${
            appliance.home_assistant?.device_url
              ? html`<a href=${appliance.home_assistant.device_url}>
                <ha-dropdown-item>
                  <ha-icon slot="icon" icon="mdi:open-in-new"></ha-icon>
                  Open HA device
                </ha-dropdown-item>
              </a>`
              : nothing
          }
          <ha-dropdown-item value="delete" variant="danger">
            <ha-icon slot="icon" icon="mdi:delete-outline"></ha-icon>
            Delete appliance
          </ha-dropdown-item>
        </ha-dropdown>
      </div>
    </ha-card>
  `;
}
