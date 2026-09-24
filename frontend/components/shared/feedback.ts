import { css, html, nothing, type TemplateResult } from "lit";

export interface FeedbackOptions {
  message: string;
  detail?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
}

export const feedbackStyles = css`
  .irf-feedback { display: block; min-width: 0; }
  .irf-feedback ha-expansion-panel {
    display: block;
    margin-top: 6px;
    color: var(--imprint-muted);
  }
  .irf-feedback code {
    display: block;
    margin-top: 5px;
    overflow-wrap: anywhere;
  }
`;

const renderDetails = ({
  detail = "",
  message,
}: FeedbackOptions): TemplateResult | typeof nothing =>
  detail && detail !== message
    ? html`<ha-expansion-panel header="Technical details">
        <code>${detail}</code>
      </ha-expansion-panel>`
    : nothing;

export const renderFeedback = (options: FeedbackOptions): TemplateResult | typeof nothing => {
  const { message, dismissible = false, onDismiss } = options;
  if (!message) return nothing;
  const details = renderDetails(options);
  return html`<ha-alert
    class="irf-feedback"
    .title=${message}
    .alertType=${"error"}
    .dismissable=${dismissible}
    @alert-dismissed-clicked=${onDismiss}
  >
    ${details}
  </ha-alert>`;
};
