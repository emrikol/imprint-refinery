import { css, html, nothing, type TemplateResult } from "lit";
import { hasHaComponent } from "../../core/ha-components";

export interface WorkspaceEmptyOptions {
  icon?: string;
  heading?: string;
  description?: string;
  compact?: boolean;
  actions?: TemplateResult | typeof nothing;
  className?: string;
}

export const workspaceEmptyStyles = css`
  .irf-empty {
    min-height: 180px;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    text-align: center;
    color: var(--imprint-muted);
    padding: 28px;
    border: 1px dashed var(--imprint-line);
    border-radius: var(--imprint-radius);
  }
  .irf-empty.compact { min-height: 0; padding: 18px; }
  .irf-empty-copy {
    display: grid;
    gap: 10px;
    justify-items: center;
    max-width: 520px;
    min-width: 0;
  }
  .irf-empty ha-icon { color: var(--imprint-accent); --mdc-icon-size: 36px; }
  .irf-empty h3,
  .irf-empty p { margin: 0; overflow-wrap: anywhere; }
  ha-empty-state.irf-empty-state {
    min-height: 180px;
    border: 1px dashed var(--imprint-line);
    border-radius: var(--imprint-radius);
  }
`;

export const renderWorkspaceEmpty = ({
  icon = "",
  heading = "",
  description = "",
  compact = false,
  actions = nothing,
  className = "",
}: WorkspaceEmptyOptions): TemplateResult => {
  if (!compact && hasHaComponent("ha-empty-state")) {
    return html`
      <ha-empty-state
        class=${`irf-empty-state ${className}`.trim()}
        .heading=${heading || undefined}
        .description=${description || undefined}
      >${actions}</ha-empty-state>
    `;
  }
  return html`
    <section class=${`irf-empty ${compact ? "compact" : ""} ${className}`.trim()}>
      <div class="irf-empty-copy">
        ${icon ? html`<ha-icon icon=${icon} aria-hidden="true"></ha-icon>` : nothing}
        ${heading ? html`<h3>${heading}</h3>` : nothing}
        ${description ? html`<p>${description}</p>` : nothing}
        ${actions}
      </div>
    </section>
  `;
};
