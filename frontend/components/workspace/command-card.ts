import { css, html, type CSSResult, type TemplateResult } from "lit";
import { haControlChecked, haDropdownValue } from "../../core/ha-controls";
import type { CommandData } from "../../types";
import type { RemoteProfileAction } from "./events";

export interface CommandCardView {
  profileId: string;
  commandId: string;
  command: CommandData;
  selected: boolean;
  selectionMode: boolean;
  checked: boolean;
  busy: boolean;
  testEmitterRef: string;
  onAction: (action: RemoteProfileAction) => void;
}

export const commandCardStyles: CSSResult = css`
  .command-card {
    position: relative;
    min-width: 0;
    min-height: 104px;
    border: 1px solid var(--imprint-line);
    border-radius: 12px;
    padding: 9px;
    display: grid;
    grid-template-rows: 1fr auto;
    gap: 7px;
    background: var(--imprint-surface-2);
  }
  .command-card.selected {
    border-color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
    box-shadow: inset 0 0 0 1px var(--imprint-accent);
  }
  .command-card strong {
    min-width: 0;
    font-size: 14px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .command-card .command-open {
    position: absolute;
    inset: 0;
    width: 100%;
    min-width: 0;
    min-height: 0;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 10px 12px 54px;
    box-sizing: border-box;
    border-radius: 11px;
    color: inherit;
    cursor: pointer;
    outline: none;
    --ha-ripple-hover-color: transparent;
  }
  .command-card .command-open:hover {
    background: var(--ha-color-fill-neutral-quiet-resting);
  }
  .command-card .command-open > ha-ripple { pointer-events: none; }
  .command-card .command-open:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ha-color-focus, var(--primary-color));
  }
  .command-card .command-open ha-icon {
    flex: 0 0 auto;
    color: var(--imprint-accent);
    --mdc-icon-size: 25px;
  }
  .command-card .command-actions {
    position: relative;
    z-index: 1;
    grid-row: 2;
    align-self: end;
    display: flex;
    justify-content: space-between;
    gap: 7px;
    pointer-events: none;
  }
  .command-card .command-actions > * { pointer-events: auto; }
  .command-card .command-select {
    min-width: 0;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  .command-card .command-select ha-checkbox {
    width: 100%;
    min-width: 0;
  }
  .command-card .command-select span {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-weight: 750;
    overflow-wrap: anywhere;
  }
  .command-card .command-select ha-icon {
    flex: 0 0 auto;
    color: var(--imprint-accent);
    --mdc-icon-size: 25px;
  }
`;

export function renderCommandCard({
  profileId,
  commandId,
  command,
  selected,
  selectionMode,
  checked,
  busy,
  testEmitterRef,
  onAction,
}: CommandCardView): TemplateResult {
  const name = command.name || commandId;
  const openCommand = (): void =>
    onAction({ type: "open-command", profileId, commandId });
  const handleOpenKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCommand();
  };
  const handleMenu = (event: Event): void => {
    const action = haDropdownValue(event);
    if (action === "details") {
      onAction({ type: "open-command", profileId, commandId });
    }
    if (action === "icon") {
      onAction({ type: "choose-command-icon", profileId, commandId });
    }
  };
  return html`<div
    class=${`command command-card ${selected || checked ? "selected" : ""}`}
    data-profile-id=${profileId}
    data-command-id=${commandId}
  >
    ${
      selectionMode
        ? html`<div class="command-select">
          <ha-checkbox
            .checked=${checked}
            @change=${(event: Event) =>
              onAction({
                type: "toggle-command-selection",
                profileId,
                commandId,
                selected: haControlChecked(event),
              })}
          ><span><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon>${name}</span></ha-checkbox>
        </div>`
        : html`
          <div
            class="command-open"
            role="button"
            tabindex="0"
            aria-label=${`Open ${name}`}
            @click=${openCommand}
            @keydown=${handleOpenKeydown}
          ><ha-ripple></ha-ripple><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon><strong>${name}</strong></div>
          <div class="actions command-actions">
            <ha-icon-button
              .disabled=${busy || !command.code || !testEmitterRef}
              .label=${`Test ${name}`}
              title=${
                testEmitterRef
                  ? `Test ${name}`
                  : "Choose Test with IR emitter first"
              }
              @click=${() => onAction({ type: "test-command", profileId, commandId })}
            ><ha-icon icon="mdi:send"></ha-icon></ha-icon-button>
            <ha-dropdown placement="bottom-end" @wa-select=${handleMenu}>
              <ha-icon-button slot="trigger" .label=${`Actions for ${name}`}>
                <ha-icon icon="mdi:dots-vertical"></ha-icon>
              </ha-icon-button>
              <ha-dropdown-item value="details">
                <ha-icon slot="icon" icon="mdi:information-outline"></ha-icon>Open details
              </ha-dropdown-item>
              <ha-dropdown-item value="icon">
                <ha-icon slot="icon" icon="mdi:palette-outline"></ha-icon>Choose icon
              </ha-dropdown-item>
            </ha-dropdown>
          </div>
        `
    }
  </div>`;
}
