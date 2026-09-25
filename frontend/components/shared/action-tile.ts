import { css, html, type TemplateResult } from "lit";

export interface ActionTileOptions {
  icon: string;
  title: string;
  description: string;
  disabled?: boolean;
  onActivate: () => void;
}

export const actionTileStyles = css`
  ha-card.imprint-action-tile {
    height: 100%;
    min-width: 0;
    overflow: hidden;
  }
  .imprint-action-tile-trigger {
    position: relative;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: start;
    align-items: start;
    gap: 12px;
    width: 100%;
    min-width: 0;
    min-height: 96px;
    height: 100%;
    padding: 16px;
    color: inherit;
    cursor: pointer;
    outline: none;
    text-align: start;
    --ha-ripple-hover-color: transparent;
  }
  .imprint-action-tile-trigger:hover {
    background: var(--ha-color-fill-neutral-quiet-resting);
  }
  .imprint-action-tile-trigger:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ha-color-focus, var(--primary-color));
  }
  .imprint-action-tile-trigger[aria-disabled="true"] {
    cursor: not-allowed;
    opacity: 0.52;
  }
  .imprint-action-tile-trigger > ha-ripple {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .imprint-action-tile-icon {
    color: var(--imprint-accent);
    font-size: 25px;
  }
  .imprint-action-tile-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .imprint-action-tile-copy strong,
  .imprint-action-tile-copy span {
    display: block;
    overflow-wrap: anywhere;
  }
  .imprint-action-tile-copy strong { line-height: 1.3; }
  .imprint-action-tile-copy span {
    color: var(--imprint-muted);
    line-height: 1.4;
  }
`;

export function renderActionTile({
  icon,
  title,
  description,
  disabled = false,
  onActivate,
}: ActionTileOptions): TemplateResult {
  const activate = (): void => {
    if (!disabled) onActivate();
  };
  const handleKeydown = (event: KeyboardEvent): void => {
    if (disabled || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onActivate();
  };
  return html`
    <ha-card class="imprint-action-tile" outlined>
      <div
        class="imprint-action-tile-trigger"
        role="button"
        tabindex=${disabled ? "-1" : "0"}
        aria-disabled=${disabled ? "true" : "false"}
        @click=${activate}
        @keydown=${handleKeydown}
      >
        <ha-ripple></ha-ripple>
        <ha-icon
          class="imprint-action-tile-icon"
          icon=${icon}
          aria-hidden="true"
        ></ha-icon>
        <span class="imprint-action-tile-copy">
          <strong>${title}</strong>
          <span>${description}</span>
        </span>
      </div>
    </ha-card>
  `;
}
