import {
  css,
  html,
  nothing,
  type CSSResult,
  type TemplateResult,
} from "lit";
import { repeat } from "lit/directives/repeat.js";
import {
  haControlValue,
  haDropdownValue,
  haSelectedValue,
  type HaSelectOption,
} from "../../core/ha-controls";
import type {
  CommandSelectionState,
  InfraredHardwareEntity,
  RemoteProfileData,
} from "../../types";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceHeading } from "../shared/workspace-heading";
import type { RemoteProfileAction } from "./events";
import { renderRemoteProfileCard } from "./remote-profile-card";

export interface RemoteProfileWorkspaceView {
  profiles: Array<[string, RemoteProfileData]>;
  emitters: InfraredHardwareEntity[];
  selectedProfileId: string;
  selectedCommandProfileId: string;
  selectedCommandId: string;
  commandSelection: CommandSelectionState | null;
  search: string;
  testEmitterRef: string;
  busy: boolean;
  inspectorOpen: boolean;
  compactInspector: boolean;
  inspector: TemplateResult | typeof nothing;
  onAction: (action: RemoteProfileAction) => void;
}

export const remoteProfileWorkspaceStyles: CSSResult = css`
  .remote-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
    align-items: start;
    min-width: 0;
    container-type: inline-size;
  }
  .remote-workspace.has-inspector {
    grid-template-columns: minmax(0, 1fr) minmax(340px, 390px);
  }
  .remote-workspace .remote-main {
    display: grid;
    gap: 18px;
    min-width: 0;
  }
  .remote-workspace .profile-heading { --imprint-heading-measure: 460px; }
  .remote-workspace .library-controls {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(190px, 250px);
    gap: 12px;
    align-items: start;
  }
  .remote-workspace .library-controls > * {
    min-width: 0;
    max-width: 100%;
  }
  .remote-workspace .search { min-width: min(360px, 100%); }
  .remote-workspace .profile-stack { display: grid; gap: 16px; }
  .remote-workspace .library-tools {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }
  .remote-workspace > [data-command-inspector] { min-width: 0; }
  @container (max-width: 1200px) {
    .remote-workspace.has-inspector { grid-template-columns: 1fr; }
  }
  @container (max-width: 760px) {
    .remote-workspace .library-controls { grid-template-columns: 1fr; }
  }
`;

export function renderRemoteProfileWorkspace({
  profiles,
  emitters,
  selectedProfileId,
  selectedCommandProfileId,
  selectedCommandId,
  commandSelection,
  search,
  testEmitterRef,
  busy,
  inspectorOpen,
  compactInspector,
  inspector,
  onAction,
}: RemoteProfileWorkspaceView): TemplateResult {
  const emitterOptions: HaSelectOption[] = [
    { value: "", label: "Choose for this session" },
    ...emitters.map((item) => ({
      value: item.ref,
      label: `${item.name}${item.available ? "" : " — unavailable"}`,
      disabled: !item.available,
    })),
  ];
  const handleLibraryMenu = (event: Event): void => {
    const action = haDropdownValue(event);
    if (action === "import") onAction({ type: "import-signals" });
    if (action === "backup") onAction({ type: "backup" });
  };

  return html`<div
    class=${`workspace remote-workspace ${inspectorOpen ? "has-inspector" : ""}`}
    data-workspace="remote_profiles"
  >
    <main class="remote-main" ?inert=${compactInspector && inspectorOpen}>
      <div class="profile-heading">
        ${renderWorkspaceHeading({
          heading: "Remote profiles",
          description:
            "Reusable IR command sets. Assign one profile to several appliances without copying its commands.",
        })}
      </div>
      <div class="controls library-controls">
        <ha-input-search
          class="search"
          label="Search profiles and commands"
          placeholder="Search remote profiles and commands"
          .value=${search}
          @input=${(event: Event) =>
            onAction({ type: "search-change", value: haControlValue(event) })}
        ></ha-input-search>
        <ha-select
          label="Test with IR emitter"
          .value=${testEmitterRef}
          .options=${emitterOptions}
          @selected=${(event: Event) =>
            onAction({
              type: "test-emitter-change",
              emitterRef: haSelectedValue(event),
            })}
        ></ha-select>
      </div>
      ${!profiles.length
        ? renderWorkspaceEmpty({
            icon: "mdi:remote-off",
            heading: "No remote profiles",
            description:
              "Create a profile, import codes, or learn a button. An emitter is not required until you test or use an appliance.",
            actions: html`<ha-button
              appearance="accent"
              @click=${() => onAction({ type: "add-profile" })}
            >Add remote profile</ha-button>`,
          })
        : html`<div class="stack profile-stack">
            ${repeat(
              profiles,
              ([id]) => id,
              ([id, profile]) =>
                renderRemoteProfileCard({
                  profileId: id,
                  profile,
                  selected: selectedProfileId === id,
                  selectedCommandId:
                    selectedCommandProfileId === id ? selectedCommandId : "",
                  selectedCommandIds:
                    commandSelection?.remoteProfileId === id
                      ? commandSelection.commandIds
                      : null,
                  busy,
                  testEmitterRef,
                  onAction,
                }),
            )}
          </div>`}
      <footer class="library-tools">
        <ha-button
          appearance="outlined"
          variant="neutral"
          @click=${() => onAction({ type: "add-profile" })}
        ><ha-icon slot="start" icon="mdi:plus"></ha-icon>Add remote profile</ha-button>
        <ha-button
          appearance="outlined"
          variant="neutral"
          @click=${() => onAction({ type: "create-custom-signal" })}
        ><ha-icon slot="start" icon="mdi:square-wave"></ha-icon>Create custom signal</ha-button>
        <ha-button
          appearance="outlined"
          variant="neutral"
          @click=${() => onAction({ type: "find-codes" })}
        ><ha-icon slot="start" icon="mdi:magnify"></ha-icon>Find codes</ha-button>
        <ha-dropdown placement="top-end" @wa-select=${handleLibraryMenu}>
          <ha-button slot="trigger" appearance="outlined" variant="neutral">
            <ha-icon slot="start" icon="mdi:bookshelf"></ha-icon>
            Library
            <ha-icon slot="end" icon="mdi:chevron-down"></ha-icon>
          </ha-button>
          <ha-dropdown-item value="import">
            <ha-icon slot="icon" icon="mdi:import"></ha-icon>Import signals
          </ha-dropdown-item>
          <ha-dropdown-item value="backup">
            <ha-icon slot="icon" icon="mdi:backup-restore"></ha-icon>Backup &amp; restore
          </ha-dropdown-item>
        </ha-dropdown>
      </footer>
    </main>
    ${inspector}
  </div>`;
}
