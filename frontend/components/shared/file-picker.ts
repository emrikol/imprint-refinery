import { css, html, type CSSResult, type TemplateResult } from "lit";

export const filePickerStyles: CSSResult = css`
  .imprint-file-picker {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .imprint-file-picker input {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    opacity: 0;
    pointer-events: none;
  }
`;

export interface FilePickerOptions {
  accept: string;
  buttonLabel: string;
  emptyLabel: string;
  selectedName?: string;
  className?: string;
  disabled?: boolean;
  onFile: (file: File) => Promise<void> | void;
  onError: (message: string) => void;
  errorMessage: string;
}

/** Browser-native file input wrapped in Home Assistant presentation controls. */
export const renderFilePicker = ({
  accept,
  buttonLabel,
  emptyLabel,
  selectedName = "",
  className = "",
  disabled = false,
  onFile,
  onError,
  errorMessage,
}: FilePickerOptions): TemplateResult => {
  const chooseFile = (event: Event): void => {
    const control = event.currentTarget as HTMLElement;
    control
      .closest(".imprint-file-picker")
      ?.querySelector<HTMLInputElement>("input")
      ?.click();
  };
  const readFile = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await onFile(file);
    } catch {
      onError(errorMessage);
    } finally {
      input.value = "";
    }
  };
  return html`<div class=${`imprint-file-picker ${className}`.trim()}>
    <input
      type="file"
      accept=${accept}
      .disabled=${disabled}
      tabindex="-1"
      aria-hidden="true"
      @change=${readFile}
    >
    <ha-button
      variant="neutral"
      appearance="outlined"
      .disabled=${disabled}
      @click=${chooseFile}
    ><ha-icon slot="start" icon="mdi:file-upload-outline"></ha-icon>${buttonLabel}</ha-button>
    <span class="muted">${selectedName || emptyLabel}</span>
  </div>`;
};
