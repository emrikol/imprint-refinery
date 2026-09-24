import { css, html, type TemplateResult } from "lit";

export interface FactItem {
  label: string;
  value: unknown;
}

export interface FactGridOptions {
  facts: readonly FactItem[];
  layout?: "rows" | "cards";
  className?: string;
}

export const factGridStyles = css`
  .imprint-fact-grid {
    display: grid;
    gap: 9px;
    min-width: 0;
    margin: 0;
  }
  .imprint-fact-grid.cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .imprint-fact-grid.rows { grid-template-columns: 1fr; }
  .imprint-fact {
    display: grid;
    min-width: 0;
    margin: 0;
  }
  .imprint-fact-grid.cards .imprint-fact {
    gap: 3px;
    padding: 10px;
    border-radius: 10px;
    background: var(--imprint-surface-2);
  }
  .imprint-fact-grid.rows .imprint-fact {
    grid-template-columns: 118px minmax(0, 1fr);
    gap: 10px;
  }
  .imprint-fact dt { color: var(--imprint-muted); }
  .imprint-fact-grid.cards dt { font-size: 12px; }
  .imprint-fact dd {
    min-width: 0;
    margin: 0;
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  @container (max-width: 420px) {
    .imprint-fact-grid.cards { grid-template-columns: 1fr; }
  }
`;

export const renderFactGrid = ({
  facts,
  layout = "cards",
  className = "",
}: FactGridOptions): TemplateResult => html`
  <dl class=${`imprint-fact-grid ${layout} ${className}`.trim()}>
    ${facts.map(({ label, value }) => html`
      <div class="imprint-fact">
        <dt>${label}</dt>
        <dd>${value}</dd>
      </div>
    `)}
  </dl>
`;
