import { css, html, nothing, type TemplateResult } from "lit";

export type NoticeTone = "info" | "warning" | "danger" | "success";
export type NoticeRole = "note" | "status" | "alert";

export interface WorkspaceNoticeOptions {
  content: unknown;
  icon?: string;
  tone?: NoticeTone;
  role?: NoticeRole;
  actions?: TemplateResult | typeof nothing;
  className?: string;
}

export const workspaceNoticeStyles = css`
  .irf-notice {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    min-width: 0;
    padding: 10px;
    border-radius: 9px;
    background: var(--imprint-accent-soft);
    color: var(--imprint-muted);
  }
  .irf-notice.warning { background: var(--imprint-warning-soft, var(--imprint-accent-soft)); }
  .irf-notice.danger { background: var(--imprint-danger-soft, var(--imprint-accent-soft)); }
  .irf-notice.success { background: var(--imprint-success-soft, var(--imprint-accent-soft)); }
  .irf-notice > ha-icon { flex: 0 0 auto; color: currentColor; }
  .irf-notice-copy { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .irf-notice-actions { flex: 0 1 auto; min-width: max-content; }
  ha-alert.irf-alert { display: block; }
`;

export const renderWorkspaceNotice = ({
  content,
  icon = "mdi:information-outline",
  tone = "info",
  role = "note",
  actions = nothing,
  className = "",
}: WorkspaceNoticeOptions): TemplateResult => {
  if (role === "alert") {
    const alertType = tone === "danger" ? "error" : tone;
    return html`<ha-alert
      class=${`irf-alert ${className}`.trim()}
      .alertType=${alertType}
    >
      <ha-icon slot="icon" icon=${icon}></ha-icon>
      ${content}
      ${actions === nothing ? nothing : html`<span slot="action">${actions}</span>`}
    </ha-alert>`;
  }
  return html`<div
    class=${`irf-notice ${tone} ${className}`.trim()}
    role=${role}
    aria-live=${role === "status" ? "polite" : nothing}
  >
    <ha-icon icon=${icon} aria-hidden="true"></ha-icon>
    <span class="irf-notice-copy">${content}</span>
    ${actions === nothing
      ? nothing
      : html`<span class="irf-notice-actions">${actions}</span>`}
  </div>`;
};
