import { css, html, type CSSResult, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  ApplianceData,
  InfraredHardwareEntity,
  RemoteProfileData,
} from "../../types";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceHeading } from "../shared/workspace-heading";
import { renderApplianceCard, type ApplianceCardView } from "./appliance-card";
import type { ApplianceAction } from "./events";

export interface AppliancesWorkspaceView {
  appliances: Array<[string, ApplianceData]>;
  profiles: Record<string, RemoteProfileData>;
  emitters: InfraredHardwareEntity[];
  selectedApplianceId: string;
  onAction: (action: ApplianceAction) => void;
}

export const appliancesWorkspaceStyles: CSSResult = css`
  .appliances-workspace {
    display: grid;
    gap: 18px;
    min-width: 0;
    container-type: inline-size;
  }
  .appliances-workspace .appliance-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(260px, 1fr));
    gap: 14px;
  }
  @container (max-width: 1100px) {
    .appliances-workspace .appliance-cards {
      grid-template-columns: repeat(2, minmax(250px, 1fr));
    }
  }
  @container (max-width: 760px) {
    .appliances-workspace .appliance-cards { grid-template-columns: 1fr; }
  }
`;

export function renderAppliancesWorkspace({
  appliances,
  profiles,
  emitters,
  selectedApplianceId,
  onAction,
}: AppliancesWorkspaceView): TemplateResult {
  const emitter = (ref?: string | null): InfraredHardwareEntity | undefined =>
    emitters.find((item) => item.ref === ref);
  const profileName = (profileId?: string | null): string => {
    if (!profileId) return "Choose a remote profile";
    return profiles[profileId]?.name || "Missing remote profile";
  };
  const card = (id: string, appliance: ApplianceData): ApplianceCardView => ({
    applianceId: id,
    appliance,
    emitter: emitter(appliance.infrared_emitter_ref),
    profileName: profileName(appliance.remote_profile_id),
    profileType: appliance.remote_profile_id
      ? profiles[appliance.remote_profile_id]?.appliance_type || "generic"
      : "generic",
    selected: selectedApplianceId === id,
    onAction,
  });

  return html`
    <section
      class="appliances-workspace"
      data-workspace="appliances"
    >
      ${renderWorkspaceHeading({
        heading: "Appliances",
        description:
          "Actual equipment in your home. Each appliance chooses a Home Assistant Area, one remote profile, and one preferred IR emitter.",
        actions: html`<ha-button
          appearance="accent"
          @click=${() => onAction({ type: "add-appliance" })}
        ><ha-icon slot="start" icon="mdi:plus"></ha-icon>Add appliance</ha-button>`,
      })}
      ${
        !appliances.length
          ? renderWorkspaceEmpty({
              icon: "mdi:television-remote",
              heading: "No appliances",
              description:
                "Create an appliance to connect a reusable remote profile to a real target and emitter.",
              actions: html`<ha-button
              appearance="accent"
              @click=${() => onAction({ type: "add-appliance" })}
            >Add appliance</ha-button>`,
            })
          : html`<div class="cards appliance-cards">
            ${repeat(
              appliances,
              ([id]) => id,
              ([id, appliance]) => renderApplianceCard(card(id, appliance)),
            )}
          </div>`
      }
    </section>
  `;
}
