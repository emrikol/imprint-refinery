import { css, html, nothing, type TemplateResult } from "lit";
import type { WorkspaceView } from "../workspace/events";

export interface WorkspaceHeaderOptions {
  heading?: string;
  view?: WorkspaceView;
  navigation?: boolean;
  inert?: boolean;
  onViewChange?: (view: WorkspaceView) => void;
}

export const workspaceHeaderStyles = css`
  .irf-header {
    min-height: 64px;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--imprint-line);
    container-type: inline-size;
  }
  .irf-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin-right: auto;
  }
  .irf-brand ha-icon { flex: 0 0 auto; color: var(--imprint-accent); }
  .irf-brand h1 {
    min-width: 0;
    margin: 0;
    font-size: 20px;
    overflow-wrap: anywhere;
  }
  .irf-header ha-tab-group {
    min-width: 0;
    max-width: 100%;
    color: var(--imprint-muted);
    --ha-tab-track-color: transparent;
  }
  .irf-header ha-tab-group-tab { min-height: 44px; font-weight: 700; }
  @container (max-width: 760px) {
    .irf-header {
      align-items: stretch;
      flex-direction: column;
      padding: 14px 0;
    }
    .irf-brand { min-height: 38px; }
    .irf-header ha-tab-group { width: 100%; }
    .irf-header ha-tab-group-tab { font-size: 13px; }
  }
`;

export const renderWorkspaceHeader = ({
  heading = "Imprint Refinery",
  view = "appliances",
  navigation = true,
  inert = false,
  onViewChange,
}: WorkspaceHeaderOptions = {}): TemplateResult => html`
  <header class="irf-header" ?inert=${inert}>
    <div class="irf-brand">
      <ha-icon icon="mdi:remote" aria-hidden="true"></ha-icon>
      <h1>${heading}</h1>
    </div>
    ${navigation
      ? html`<ha-tab-group aria-label="Imprint Refinery workspace" tab-only>
          ${([
            ["appliances", "Appliances"],
            ["remote_profiles", "Remote profiles"],
            ["infrared_hardware", "Infrared hardware"],
          ] as const).map(([target, label]) => html`
            <ha-tab-group-tab
              .active=${view === target}
              panel=${target}
              @click=${() => onViewChange?.(target)}
            >${label}</ha-tab-group-tab>
          `)}
        </ha-tab-group>`
      : nothing}
  </header>
`;
