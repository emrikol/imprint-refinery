import { css, html, type CSSResult, type TemplateResult } from "lit";
import type { InfraredHardwareEntity } from "../../types";
import { renderStatus } from "../shared/status";

export interface HardwareRowView {
  item: InfraredHardwareEntity;
  icon: string;
}

export const hardwareRowStyles: CSSResult = css`
  .hardware-row {
    position: relative;
    min-width: 0;
  }
  .hardware-row + .hardware-row {
    border-top: 1px solid var(--imprint-line);
  }
  .hardware-row-primary {
    position: relative;
    display: grid;
    grid-template-columns:
      minmax(240px, 1.35fr)
      minmax(100px, auto)
      minmax(130px, .6fr)
      minmax(180px, .8fr);
    gap: 18px;
    align-items: center;
    min-height: 72px;
    padding: 12px 64px 12px 16px;
    color: inherit;
    text-decoration: none;
    outline: none;
    overflow: hidden;
    --ha-ripple-hover-color: transparent;
  }
  .hardware-row-primary:hover {
    background: var(--ha-color-fill-neutral-quiet-resting);
  }
  .hardware-row-primary:focus-visible {
    box-shadow: inset 0 0 0 2px var(--ha-color-focus, var(--primary-color));
  }
  .hardware-row-primary > ha-ripple {
    position: absolute;
    inset: 0;
  }
  .hardware-identity {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .hardware-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    border-radius: 12px;
    color: var(--imprint-accent);
    background: var(--imprint-accent-soft);
  }
  .hardware-icon ha-icon { --mdc-icon-size: 24px; }
  .hardware-identity-copy { min-width: 0; }
  .hardware-identity strong,
  .hardware-identity small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hardware-identity strong { font-size: 15px; }
  .hardware-identity small {
    margin-top: 2px;
    color: var(--imprint-muted);
    font-size: 12px;
  }
  .hardware-detail { min-width: 0; }
  .hardware-detail-label,
  .hardware-detail-value {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hardware-detail-label {
    margin-bottom: 3px;
    color: var(--imprint-muted);
    font-size: 11px;
  }
  .hardware-detail-value {
    font-size: 13px;
    font-weight: 600;
  }
  .hardware-menu {
    position: absolute;
    z-index: 1;
    top: 50%;
    inset-inline-end: 10px;
    transform: translateY(-50%);
  }
  .hardware-menu a {
    color: inherit;
    text-decoration: none;
  }
  .hardware-row-chevron {
    position: absolute;
    top: 50%;
    inset-inline-end: 20px;
    transform: translateY(-50%);
    color: var(--imprint-muted);
    pointer-events: none;
  }

  @container (max-width: 900px) {
    .hardware-row-primary {
      grid-template-columns: minmax(220px, 1fr) auto minmax(150px, .7fr);
    }
    .hardware-area { display: none; }
  }
  @container (max-width: 620px) {
    .hardware-row-primary {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px 14px;
      min-height: 84px;
      padding-block: 10px;
    }
    .hardware-activity {
      grid-column: 1 / -1;
      padding-inline-start: 52px;
    }
    .hardware-detail-label { display: none; }
  }
  @container (max-width: 420px) {
    .hardware-row-primary {
      grid-template-columns: minmax(0, 1fr);
      padding-inline-end: 56px;
    }
    .hardware-status { padding-inline-start: 52px; }
    .hardware-activity { display: none; }
  }
`;

const renderLastActivity = (
  value?: string | null,
): string | TemplateResult => {
  if (!value) return "No activity recorded";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return html`<time datetime=${value}>${new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp))}</time>`;
};

export function renderHardwareRow({
  item,
  icon,
}: HardwareRowView): TemplateResult {
  const entityUrl = item.entity_url || `/config/entities/entity/${item.ref}`;
  return html`<article
    class="hardware hardware-row"
    data-hardware-ref=${item.ref}
    role="listitem"
  >
    <a
      class="hardware-row-primary"
      href=${entityUrl}
      aria-label=${`Open ${item.name} entity`}
    >
      <ha-ripple></ha-ripple>
      <div class="hardware-identity">
        <span class="hardware-icon" aria-hidden="true">
          <ha-icon icon=${icon}></ha-icon>
        </span>
        <div class="hardware-identity-copy">
          <strong>${item.name}</strong>
          <small>${item.entity_id}</small>
        </div>
      </div>
      <div class="hardware-status">
        ${renderStatus({
          state: item.available ? "ready" : "unavailable",
          label: item.available ? "Available" : "Unavailable",
          context: "Hardware",
        })}
      </div>
      <div class="hardware-detail hardware-area">
        <span class="hardware-detail-label">Area</span>
        <span class="hardware-detail-value">${item.area_name || "No Area"}</span>
      </div>
      <div class="hardware-detail hardware-activity">
        <span class="hardware-detail-label">Last activity</span>
        <span class="hardware-detail-value">${renderLastActivity(item.last_activity)}</span>
      </div>
    </a>
    ${item.device_url
      ? html`<div class="hardware-menu">
          <ha-dropdown
            placement="bottom-end"
            @click=${(event: Event) => event.stopPropagation()}
          >
            <ha-icon-button slot="trigger" .label=${`Actions for ${item.name}`}>
              <ha-icon icon="mdi:dots-vertical"></ha-icon>
            </ha-icon-button>
            <a href=${item.device_url}>
              <ha-dropdown-item>
                <ha-icon slot="icon" icon="mdi:devices"></ha-icon>
                Open device
              </ha-dropdown-item>
            </a>
          </ha-dropdown>
        </div>`
      : html`<ha-icon
          class="hardware-row-chevron"
          icon="mdi:chevron-right"
          aria-hidden="true"
        ></ha-icon>`}
  </article>`;
}
