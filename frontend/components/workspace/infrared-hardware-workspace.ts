import { css, html, nothing, type CSSResult, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { InfraredHardwareEntity } from "../../types";
import { renderWorkspaceEmpty } from "../shared/workspace-empty-state";
import { renderWorkspaceHeading } from "../shared/workspace-heading";
import { renderHardwareRow } from "./hardware-row";

export interface InfraredHardwareWorkspaceView {
  emitters: InfraredHardwareEntity[];
  receivers: InfraredHardwareEntity[];
  compatibilityAdapterAvailable: boolean;
}

export const infraredHardwareWorkspaceStyles: CSSResult = css`
  .infrared-hardware-workspace {
    display: grid;
    gap: 18px;
    min-width: 0;
    container-type: inline-size;
  }
  .infrared-hardware-workspace .hardware-section {
    min-width: 0;
  }
  .infrared-hardware-workspace ha-card.hardware-section-card {
    display: block;
    min-width: 0;
    overflow: visible;
  }
  .infrared-hardware-workspace .hardware-section-header {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 48px;
    padding: 11px 16px;
    border-bottom: 1px solid var(--imprint-line);
  }
  .infrared-hardware-workspace .hardware-section-header h3 {
    margin: 0;
    font-size: 17px;
  }
  .infrared-hardware-workspace .hardware-section-count {
    display: inline-grid;
    place-items: center;
    min-width: 24px;
    min-height: 24px;
    padding: 0 7px;
    border-radius: 999px;
    color: var(--imprint-muted);
    background: var(--imprint-surface-2);
    font-size: 12px;
    font-weight: 700;
  }
  .infrared-hardware-workspace .hardware-empty {
    padding: 16px;
  }
`;

function renderHardwareSection(
  title: string,
  icon: string,
  items: InfraredHardwareEntity[],
  empty: string,
): TemplateResult {
  return html`<section class="hardware-section">
    <ha-card outlined class="hardware-section-card">
      <header class="hardware-section-header">
        <h3>${title}</h3>
        <span class="hardware-section-count" aria-label=${`${items.length} items`}>
          ${items.length}
        </span>
      </header>
      ${items.length
        ? html`<div class="hardware-list" role="list">
            ${repeat(
              items,
              (item) => item.ref,
              (item) => renderHardwareRow({ item, icon }),
            )}
          </div>`
        : html`<div class="hardware-empty">
            ${renderWorkspaceEmpty({ compact: true, description: empty })}
          </div>`}
    </ha-card>
  </section>`;
}

export function renderInfraredHardwareWorkspace({
  emitters,
  receivers,
  compatibilityAdapterAvailable,
}: InfraredHardwareWorkspaceView): TemplateResult {
  return html`
    <section
      class="infrared-hardware-workspace"
      data-workspace="infrared_hardware"
    >
      ${renderWorkspaceHeading({
        heading: "Infrared hardware",
        description:
          "Live Home Assistant Core infrared entities. Rename, move, enable, disable, or remove native hardware in Home Assistant.",
        actions: compatibilityAdapterAvailable
          ? html`<ha-button
              appearance="outlined"
              variant="neutral"
              href="/config/integrations/integration/imprint_refinery"
            ><ha-icon slot="start" icon="mdi:puzzle-outline"></ha-icon>Add compatibility adapter</ha-button>`
          : nothing,
      })}
      ${renderHardwareSection(
        "IR emitters",
        "mdi:access-point",
        emitters,
        "No Home Assistant IR emitter entities are available.",
      )}
      ${renderHardwareSection(
        "IR receivers",
        "mdi:remote-tv",
        receivers,
        "No Home Assistant IR receiver entities are available. Profiles can still be imported and edited.",
      )}
    </section>
  `;
}
