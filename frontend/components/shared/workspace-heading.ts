import { css, html, nothing, type TemplateResult } from "lit";

export interface WorkspaceHeadingOptions {
  heading: string;
  description?: string;
  variant?: "page" | "section";
  actions?: TemplateResult | typeof nothing;
  className?: string;
}

export const workspaceHeadingStyles = css`
  .irf-heading {
    display: flex;
    gap: 18px;
    align-items: flex-start;
    justify-content: space-between;
    min-width: 0;
    container-type: inline-size;
  }
  .irf-heading-copy {
    flex: 0 1 var(--imprint-heading-measure, 760px);
    min-width: 0;
  }
  .irf-heading h2 { margin: 0 0 5px; font-size: 28px; }
  .irf-heading h3 { margin: 0; font-size: 18px; }
  .irf-heading p {
    margin: 0;
    max-width: 760px;
    color: var(--imprint-muted);
  }
  .irf-heading-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-end;
  }
  .irf-heading.section { gap: 10px; }
  .irf-heading.section .irf-heading-copy { flex-basis: auto; }
  @container (max-width: 760px) {
    .irf-heading { flex-direction: column; }
    .irf-heading-copy { flex: initial; }
    .irf-heading-actions { justify-content: flex-start; }
  }
`;

export const renderWorkspaceHeading = ({
  heading,
  description = "",
  variant = "page",
  actions = nothing,
  className = "",
}: WorkspaceHeadingOptions): TemplateResult => html`
  <header class=${`irf-heading ${variant} ${className}`.trim()}>
    <div class="irf-heading-copy">
      ${variant === "section" ? html`<h3>${heading}</h3>` : html`<h2>${heading}</h2>`}
      ${description ? html`<p>${description}</p>` : nothing}
    </div>
    ${actions === nothing
      ? nothing
      : html`<div class="irf-heading-actions">${actions}</div>`}
  </header>
`;
