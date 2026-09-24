import { css, html, type TemplateResult } from "lit";
import { hasHaComponent } from "../../core/ha-components";

export interface TextareaOptions {
  label: string;
  value: string;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
  spellcheck?: boolean;
  onInput?: (event: Event) => void;
}

export const textareaFallbackStyles = css`
  .irf-textarea-fallback {
    display: grid;
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    color: var(--imprint-muted);
    font-size: 13px;
  }
  .irf-textarea-fallback textarea {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: 130px;
    max-height: 320px;
    padding: 9px 11px;
    resize: vertical;
    border: 1px solid var(--imprint-line);
    border-radius: 9px;
    background: var(--imprint-surface);
    color: var(--imprint-text);
    font: inherit;
  }
  .irf-textarea-fallback textarea:focus-visible {
    outline: 2px solid var(--imprint-accent);
    outline-offset: 1px;
  }
`;

export const renderTextarea = ({
  label,
  value,
  className = "",
  placeholder = "",
  readOnly = false,
  spellcheck = true,
  onInput,
}: TextareaOptions): TemplateResult => hasHaComponent("ha-textarea")
  ? html`<ha-textarea
      class=${className}
      .label=${label}
      .value=${value}
      .readonly=${readOnly}
      .spellcheck=${spellcheck}
      placeholder=${placeholder}
      resize="vertical"
      @input=${onInput}
    ></ha-textarea>`
  : html`<label class=${`irf-textarea-fallback ${className}`.trim()}>
      <span>${label}</span>
      <textarea
        .value=${value}
        placeholder=${placeholder}
        ?readonly=${readOnly}
        spellcheck=${spellcheck ? "true" : "false"}
        @input=${onInput}
      ></textarea>
    </label>`;
