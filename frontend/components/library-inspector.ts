import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type { InspectorState, RegistryData } from "../types";
import { featureStyles } from "../styles";
import { safeCustomElement } from "../core/registration";
import { deepActiveElement, trapTabKey } from "../core/utils";
import {
  emitterAvailability,
  type SendFeedbackCollection,
} from "./library/model";
import "./library/library-browser";
import "./library/inspector-panel";

@safeCustomElement("imprint-library-inspector")
export class ImprintLibraryInspector extends LitElement {
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ attribute: false }) inspector: InspectorState | null = null;
  @property({ attribute: false }) sendFeedback?: SendFeedbackCollection;
  @property({ type: Boolean }) busy = false;
  @property() selectedLocation = "";
  @property() selectedAppliance = "";
  @property() selectedEmitter = "";
  @property() status = "idle";
  @property({ type: Boolean }) statusBusy = false;
  @state() private compact = false;
  private resizeObserver?: ResizeObserver;

  static styles = [
    featureStyles,
    css`
    :host { display: block; container-type: inline-size; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 424px; gap: 18px; align-items: start; }
    .library, .inspector { min-width: 0; }
    .library { display: grid; gap: 14px; overflow: visible; }
    .inspector { position: sticky; top: 12px; max-height: calc(100dvh - 86px); overflow: auto; }
    .layout:not(.has-inspector) { grid-template-columns: 1fr; }
    .layout:not(.has-inspector) .inspector { display: none; }
    .inspector-close { display: inline-flex; position: absolute; right: 10px; top: 10px; z-index: 3; }
    .inspector { position: sticky; }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; gap: 0; }
      .inspector { min-height: 280px; }
      .layout.has-inspector .inspector { position: fixed; inset: 0; z-index: 18; max-height: 100dvh; overflow: auto; border-radius: 0; background: var(--imprint-surface); overscroll-behavior: contain; }
      .inspector-close { position: sticky; inset: 10px auto auto calc(100% - 54px); margin: 10px 0 -54px; }
    }
    @container (max-width: 900px) {
      .layout { grid-template-columns: 1fr; gap: 0; }
      .inspector { min-height: 280px; }
      .layout.has-inspector .inspector { position: fixed; inset: 0; z-index: 18; max-height: 100dvh; overflow: auto; border-radius: 0; background: var(--imprint-surface); overscroll-behavior: contain; }
      .inspector-close { position: sticky; inset: 10px auto auto calc(100% - 54px); margin: 10px 0 -54px; }
    }
  `,
  ];

  focusCommand(locId: string, applianceId: string, cmdId: string) {
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<any>("imprint-library-browser")
        ?.focusCommand(locId, applianceId, cmdId),
    );
  }

  focusLearnTrigger() {
    void this.updateComplete.then(async () => {
      const picker = this.renderRoot.querySelector<any>(
        "imprint-emitter-picker",
      );
      await picker?.updateComplete;
      picker?.renderRoot?.querySelector("button")?.focus();
    });
  }

  protected firstUpdated() {
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.compact =
        entry.contentRect.width <= 900 ||
        matchMedia("(max-width: 900px)").matches;
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    const opened =
      changed.has("inspector") && this.inspector && !changed.get("inspector");
    const becameCompact =
      changed.has("compact") && this.compact && this.inspector;
    if ((opened || becameCompact) && this.compact) {
      requestAnimationFrame(() =>
        this.renderRoot
          .querySelector<HTMLButtonElement>(".inspector-close")
          ?.focus(),
      );
    }
  }

  private closeInspector() {
    this.dispatchEvent(
      new CustomEvent("inspector-close", { bubbles: true, composed: true }),
    );
  }

  private handleInspectorKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.closeInspector();
      return;
    }
    if (!this.compact) return;
    const inspector = this.renderRoot.querySelector<HTMLElement>(".inspector");
    const focusable = inspector ? this.deepFocusable(inspector) : [];
    trapTabKey(event, focusable, deepActiveElement());
  }

  private deepFocusable(root: ParentNode): HTMLElement[] {
    const selector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    const found: HTMLElement[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      if (element.matches(selector) && element.offsetParent !== null)
        found.push(element);
      if (element.shadowRoot)
        found.push(...this.deepFocusable(element.shadowRoot));
    }
    return found;
  }

  render() {
    const availability = emitterAvailability(
      this.registry,
      this.selectedEmitter,
    );
    const canCapture = Boolean(
      (this.registry.emitters || []).find(
        (emitter) =>
          emitter.key === this.selectedEmitter && emitter.can_capture,
      ),
    );
    const modalInspector = Boolean(this.inspector && this.compact);
    return html`<div class="layout ${this.inspector ? "has-inspector" : ""}">
      <section class="library" ?inert=${modalInspector} aria-hidden=${modalInspector ? "true" : nothing}><imprint-emitter-picker .emitters=${this.registry.emitters || []} .selected=${this.selectedEmitter} .state=${this.status} .busy=${this.statusBusy} .showLearn=${canCapture}></imprint-emitter-picker><imprint-library-browser .registry=${this.registry} .inspector=${this.inspector} .sendFeedback=${this.sendFeedback} .busy=${this.busy} .canTransmit=${availability.available} .hasEmitter=${availability.hasEmitter} .selectedLocation=${this.selectedLocation} .selectedAppliance=${this.selectedAppliance}></imprint-library-browser></section>
      <aside class="inspector panel" role=${modalInspector ? "dialog" : "complementary"} aria-modal=${modalInspector ? "true" : nothing} aria-label="Command details" @keydown=${this.handleInspectorKeydown}>${this.inspector ? html`<button class="btn icon inspector-close" title="Close command details" aria-label="Close command details" @click=${() => this.closeInspector()}><ha-icon icon="mdi:close"></ha-icon></button>` : ""}<imprint-command-inspector .registry=${this.registry} .inspector=${this.inspector} .sendFeedback=${this.sendFeedback} .busy=${this.busy} .canTransmit=${availability.available} .selectedEmitter=${this.selectedEmitter}></imprint-command-inspector></aside>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-library-inspector": ImprintLibraryInspector;
  }
}
