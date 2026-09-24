import { css, html, nothing, type TemplateResult } from "lit";

export interface DialogShellOptions {
  heading: string;
  description?: string;
  error?: string;
  busy?: boolean;
  open?: boolean;
  className?: string;
  workflow: string;
  content: TemplateResult;
  footer?: TemplateResult | typeof nothing;
  onClose: () => void;
}

export interface DialogFooterAction {
  label: string;
  onClick: (event: Event) => void;
  variant?: "neutral" | "brand" | "danger";
  appearance?: "outlined" | "accent";
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}

interface HaDialogElement extends HTMLElement {
  open: boolean;
  preventScrimClose: boolean;
}

/** Ask the owning Home Assistant dialog to close so state clears from `closed`. */
export const requestDialogClose = (event: Event): void => {
  const dialog = event
    .composedPath()
    .find(
      (item): item is HaDialogElement =>
        item instanceof HTMLElement && item.localName === "ha-dialog",
  );
  if (!dialog || dialog.preventScrimClose) return;
  dialog.open = false;
};

export const dialogStyles = css`
  ha-dialog.irf-dialog {
    --ha-dialog-width-md: var(--irf-dialog-width, 620px);
    --dialog-content-padding: 0;
  }

  .irf-dialog-body {
    display: grid;
    gap: 16px;
    min-width: 0;
    max-width: 100%;
    overflow-x: hidden;
    padding: 0 20px 20px;
    box-sizing: border-box;
  }

  .irf-dialog-body > *,
  .irf-dialog-body input,
  .irf-dialog-body select,
  .irf-dialog-body textarea {
    min-width: 0;
    max-width: 100%;
  }
  .irf-dialog-body[aria-busy="true"] { cursor: progress; }

  .irf-dialog-error { display: block; }

  .irf-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    min-width: 0;
  }

  @media (max-width: 520px) {
    .irf-dialog-body { padding: 0 16px 16px; }
  }
`;

/** Render a Home Assistant-owned modal without duplicating focus or Escape logic. */
export const renderDialogShell = ({
  heading,
  description = "",
  error = "",
  busy = false,
  open = true,
  className = "",
  workflow,
  content,
  footer = nothing,
  onClose,
}: DialogShellOptions): TemplateResult => {
  const handleClosed = (event: Event): void => {
    if (busy) {
      (event.currentTarget as HaDialogElement).open = true;
      return;
    }
    onClose();
  };

  return html`
    <ha-dialog
      class=${`irf-dialog ${className}`.trim()}
      data-workflow=${workflow}
      .open=${open}
      .headerTitle=${heading}
      .headerSubtitle=${description || undefined}
      .preventScrimClose=${busy}
      width="medium"
      @closed=${handleClosed}
    >
      <div class="irf-dialog-body" aria-busy=${busy ? "true" : "false"}>
        ${error
          ? html`<ha-alert
              class="irf-dialog-error"
              alert-type="error"
              .alertType=${"error"}
            >${error}</ha-alert>`
          : nothing}
        ${content}
      </div>
      ${footer === nothing
        ? nothing
        : html`<div slot="footer" class="irf-dialog-actions">${footer}</div>`}
    </ha-dialog>
  `;
};

export const renderDialogFooter = (
  actions: readonly DialogFooterAction[],
): TemplateResult => html`${actions.map((action) => html`
  <ha-button
    .variant=${action.variant || "neutral"}
    .appearance=${action.appearance || "outlined"}
    .disabled=${Boolean(action.disabled)}
    .loading=${Boolean(action.loading)}
    @click=${action.onClick}
  >
    ${action.icon
      ? html`<ha-icon slot="start" icon=${action.icon}></ha-icon>`
      : nothing}
    ${action.label}
  </ha-button>
`)}`;
