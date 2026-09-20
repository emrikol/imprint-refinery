import { LitElement, css, html, nothing } from "lit";
import { property, state } from "lit/decorators.js";
import type {
  ApplianceData,
  CommandData,
  InspectorState,
  LocationData,
  RegistryData,
} from "../../types";
import {
  applianceDisplayName,
  copyText,
  emit,
  humanizeToken,
  locationDisplayName,
} from "../../core/utils";
import { safeCustomElement } from "../../core/registration";
import { featureStyles } from "../../styles";
import {
  feedbackFor,
  itemKey,
  type SendFeedback,
  type SendFeedbackCollection,
} from "./model";
import "../primitives";

interface ApplianceEntry {
  locId: string;
  applianceId: string;
  location: LocationData;
  appliance: ApplianceData;
  commands: Array<{ cmdId: string; command: CommandData }>;
}

const HOME_ASSISTANT_ROLES = [
  "power_toggle",
  "power_on",
  "power_off",
  "play",
  "pause",
  "play_pause_toggle",
  "stop",
  "next",
  "previous",
  "fast_forward",
  "rewind",
  "volume_up",
  "volume_down",
  "mute",
  "unmute",
  "mute_toggle",
  "source",
];

const LIBRARY_VIEW_KEY = "imprint-refinery.library-view.v1";

interface LibraryViewState {
  search?: string;
  applianceFilter?: string;
  locationFilter?: string;
  selectionGroup?: string;
  selectedCommandIds?: string[];
  selectionTarget?: string;
  scrollY?: number;
}

@safeCustomElement("imprint-library-browser")
export class ImprintLibraryBrowser extends LitElement {
  @property({ attribute: false }) registry: RegistryData = { locations: {} };
  @property({ attribute: false }) inspector: InspectorState | null = null;
  @property({ attribute: false }) sendFeedback?: SendFeedbackCollection;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canTransmit = false;
  @property({ type: Boolean }) hasEmitter = false;
  @property() selectedLocation = "";
  @property() selectedAppliance = "";
  @state() private search = "";
  @state() private applianceFilter = "all";
  @state() private locationFilter = "all";
  @state() private localFeedback: Record<string, SendFeedback> = {};
  @state() private localSendFeedback: Record<string, SendFeedback> = {};
  @state() private editor: Record<string, any> | null = null;
  @state() private nativeIconPickerAvailable = Boolean(
    customElements.get("ha-icon-picker"),
  );
  @state() private selectionGroup = "";
  @state() private selectedCommandIds: string[] = [];
  @state() private selectionTarget = "";
  private feedbackTimers = new Map<string, number>();
  private sendFeedbackTimers = new Map<string, number>();
  private viewRestored = false;

  static styles = [
    featureStyles,
    css`
    :host { display: grid; gap: 16px; min-width: 0; container-type: inline-size; overflow: visible; }
    .head { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 14px; align-items: center; min-width: 0; }
    .title-actions, .filters, .group-head, .group-actions, .create-actions { display: flex; align-items: center; gap: 8px; }
    .search, .search input { position: relative; min-width: 0; width: 100%; }
    .search ha-icon { position: absolute; left: 11px; top: 11px; color: var(--imprint-muted); pointer-events: none; }
    .search input { padding-left: 39px; }
    .filters { flex-wrap: wrap; justify-content: flex-end; min-width: 0; max-width: 100%; }
    .chip { min-height: 44px; border: 1px solid var(--imprint-line); border-radius: 999px; padding: 8px 15px; background: transparent; color: inherit; }
    .chip.active { border-color: var(--imprint-accent); background: var(--imprint-accent-soft); color: var(--imprint-accent); font-weight: 700; }
    .location-filter { min-height: 44px; width: auto; max-width: 190px; border: 1px solid var(--imprint-line); border-radius: 999px; padding: 8px 30px 8px 13px; background: var(--imprint-surface); color: inherit; }
    .status { margin-top: 2px; }
    .groups { display: grid; gap: 20px; padding-top: 4px; overflow: visible; }
    .group { min-width: 0; overflow: visible; }
    .group-head { justify-content: space-between; margin-bottom: 9px; }
    .group-head h2 { margin: 0; font-size: 18px; }
    .location-label { color: var(--imprint-muted); display: inline-flex; align-items: center; gap: 4px; }
    .selection-trigger { min-height: 44px; padding-inline: 11px; }
    .selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 9px; padding: 8px; border: 1px solid var(--imprint-line); border-radius: 10px; background: var(--imprint-surface-2); }
    .select-all { min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding-inline: 5px; font-weight: 650; cursor: pointer; }
    .select-all input, .command-choice input { width: 20px; height: 20px; margin: 0; accent-color: var(--imprint-accent); }
    .selection-count { min-width: 92px; color: var(--imprint-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .selection-target { flex: 1 1 220px; min-width: 180px; min-height: 44px; border: 1px solid var(--imprint-line); border-radius: 9px; padding: 8px 32px 8px 11px; background: var(--imprint-surface); color: inherit; }
    .commands { display: grid; grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 9px; overflow: visible; }
    .command { position: relative; min-width: 0; min-height: 116px; display: grid; grid-template: minmax(0,1fr) auto / minmax(0,1fr) auto; align-items: end; gap: 4px; padding: 9px; border: 1px solid var(--imprint-line); border-radius: 11px; background: var(--imprint-surface); }
    .command.selected { border-color: var(--imprint-accent); box-shadow: inset 0 0 0 1px var(--imprint-accent); background: var(--imprint-accent-soft); }
    .command.selection-mode { display: block; padding: 0; }
    .command.multi-selected { border-color: var(--imprint-accent); box-shadow: inset 0 0 0 1px var(--imprint-accent); background: var(--imprint-accent-soft); }
    .command-choice { min-height: 114px; width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); align-content: start; align-items: start; gap: 11px; padding: 12px; border-radius: 10px; cursor: pointer; }
    .command-choice:hover { background: var(--imprint-accent-soft); }
    .command-choice > ha-icon { grid-column: 2; grid-row: 1; color: var(--imprint-accent); font-size: 24px; }
    .command-choice > input { grid-column: 1; grid-row: 1 / span 2; margin-top: 2px; }
    .command-choice > .command-copy { grid-column: 2; grid-row: 2; }
    .command-open { grid-column: 1 / -1; align-self: stretch; min-width: 0; display: grid; align-content: start; gap: 8px; padding: 2px; border: 0; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
    .command-open:hover { background: var(--imprint-accent-soft); }
    .command-open > ha-icon { color: var(--imprint-accent); font-size: 24px; }
    .command-copy { min-width: 0; display: grid; gap: 2px; }
    .command-copy strong { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; line-height: 1.25; }
    .command-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .command-copy small { color: var(--imprint-muted); }
    .command .btn.icon { box-sizing: border-box; width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
    .send { width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: 50%; padding: 0; transition: color 140ms ease-out, background-color 140ms ease-out, border-color 140ms ease-out; }
    .btn.send.pending { color: var(--imprint-accent); }
    .btn.send.success, .btn.send.success:hover { color: var(--text-primary-color, #fff); background: var(--imprint-success); border-color: var(--imprint-success); }
    .btn.send.error, .btn.send.error:hover { color: var(--text-primary-color, #fff); background: var(--imprint-danger); border-color: var(--imprint-danger); }
    summary.action-success { color: var(--imprint-success); border-color: var(--imprint-success); }
    summary.action-error { color: var(--imprint-danger); border-color: var(--imprint-danger); }
    details.menu { position: relative; }
    details.menu[open], .command:has(details.menu[open]) { z-index: 12; }
    details.menu > summary { list-style: none; }
    details.menu > summary::-webkit-details-marker { display: none; }
    .menu-popover { box-sizing: border-box; position: absolute; z-index: 5; right: 0; top: calc(100% + 4px); width: 210px; display: grid; padding: 6px; border-radius: 12px; background: var(--imprint-surface); border: 1px solid var(--imprint-line); box-shadow: 0 8px 24px rgba(0,0,0,.18); }
    .command .menu-popover {
      position: fixed; left: var(--menu-left, 12px); top: var(--menu-top, 12px); right: auto; bottom: auto; width: min(240px, calc(100vw - 24px));
      max-height: calc(100dvh - 32px); overflow: auto;
    }
    .menu-popover button { min-height: 44px; border: 0; border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; gap: 9px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
    .menu-popover button:hover { background: var(--imprint-surface-2); }
    .menu-popover .danger { color: var(--error-color, #b42318); }
    .create-actions { flex-wrap: wrap; }
    .create-actions .link { min-height: 44px; border: 0; background: transparent; color: var(--imprint-accent); padding-inline: 7px; }
    .library-menu { margin-inline-start: auto; }
    .library-menu .menu-popover { width: 220px; }
    .empty-group { grid-column: 1 / -1; color: var(--imprint-muted); padding: 8px; }
    .empty-library { min-height: 240px; border: 1px dashed var(--imprint-line); border-radius: var(--imprint-radius); }
    .dialog-form { display: grid; gap: 12px; margin-top: 14px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .icon-editor { display: grid; gap: 12px; }
    .icon-preview { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px; border: 1px solid var(--imprint-line); border-radius: 11px; background: var(--imprint-surface-2); }
    .icon-preview > ha-icon { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; color: var(--imprint-accent); background: var(--imprint-accent-soft); font-size: 27px; }
    .icon-preview-copy { min-width: 0; display: grid; gap: 2px; }
    .icon-preview-copy small { overflow: hidden; color: var(--imprint-muted); text-overflow: ellipsis; white-space: nowrap; }
    ha-icon-picker { display: block; width: 100%; }
    .icon-search-help { margin: -4px 0 0; color: var(--imprint-muted); font-size: 13px; line-height: 1.45; }
    @container (max-width: 720px) {
      .head { grid-template-columns: 1fr; gap: 12px; }
      .filters { justify-content: flex-start; }
    }
    @media (max-width: 900px) {
      .head { grid-template-columns: 1fr; gap: 12px; }
      .filters { justify-content: flex-start; }
    }
    @media (max-width: 520px) {
      .commands { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .chip { padding-inline: 12px; }
      .selection-trigger span { display: none; }
      .selection-count { order: 3; flex: 1 1 auto; }
      .selection-target { order: 4; flex-basis: 100%; }
      .selection-move { order: 5; flex: 1 1 auto; }
      .selection-cancel { order: 6; }
      .menu-popover { position: fixed; inset: auto 10px 10px; width: auto; max-height: 70vh; overflow: auto; }
    }
    @media (prefers-reduced-motion: reduce) { .send { transition: none; } }
  `,
  ];

  private viewportFrame?: number;
  private readonly repositionCommandMenus = () => {
    window.cancelAnimationFrame(this.viewportFrame || 0);
    this.viewportFrame = window.requestAnimationFrame(() =>
      this.renderRoot
        .querySelectorAll<HTMLDetailsElement>("details.command-menu[open]")
        .forEach((details) => this.positionOpenCommandMenu(details)),
    );
  };

  connectedCallback() {
    super.connectedCallback();
    this.restoreViewState();
    window.addEventListener("resize", this.repositionCommandMenus);
    window.addEventListener("scroll", this.repositionCommandMenus, true);
    window.addEventListener("pagehide", this.saveViewState);
    if (!this.nativeIconPickerAvailable) {
      void customElements.whenDefined("ha-icon-picker").then(() => {
        if (this.isConnected) this.nativeIconPickerAvailable = true;
      });
    }
  }

  disconnectedCallback() {
    this.saveViewState();
    super.disconnectedCallback();
    window.removeEventListener("resize", this.repositionCommandMenus);
    window.removeEventListener("scroll", this.repositionCommandMenus, true);
    window.removeEventListener("pagehide", this.saveViewState);
    window.cancelAnimationFrame(this.viewportFrame || 0);
    this.feedbackTimers.forEach((timer) => window.clearTimeout(timer));
    this.feedbackTimers.clear();
    this.sendFeedbackTimers.forEach((timer) => window.clearTimeout(timer));
    this.sendFeedbackTimers.clear();
  }

  updated(changed: Map<PropertyKey, unknown>) {
    if (changed.has("registry")) {
      const appliances = this.appliances();
      const applianceKeys = new Set(
        appliances.map((entry) => `${entry.locId}\u0000${entry.applianceId}`),
      );
      const registryReady =
        Object.keys(this.registry.locations || {}).length > 0;
      if (registryReady) {
        if (
          this.applianceFilter !== "all" &&
          !applianceKeys.has(this.applianceFilter)
        )
          this.applianceFilter = "all";
        if (
          this.locationFilter !== "all" &&
          !this.registry.locations?.[this.locationFilter]
        )
          this.locationFilter = "all";
        if (this.selectionGroup && !applianceKeys.has(this.selectionGroup))
          this.stopSelection();
        else if (this.selectionGroup) {
          const selectedEntry = appliances.find(
            (entry) =>
              `${entry.locId}\u0000${entry.applianceId}` ===
              this.selectionGroup,
          );
          const commandIds = new Set(
            selectedEntry?.commands.map(({ cmdId }) => cmdId) || [],
          );
          this.selectedCommandIds = this.selectedCommandIds.filter((cmdId) =>
            commandIds.has(cmdId),
          );
        }
      }
    }
    if (
      [
        "search",
        "applianceFilter",
        "locationFilter",
        "selectionGroup",
        "selectedCommandIds",
        "selectionTarget",
      ].some((key) => changed.has(key))
    )
      this.saveViewState();
    if (changed.has("sendFeedback") && this.sendFeedback) {
      const next = { ...this.localSendFeedback };
      let dirty = false;
      for (const key of Object.keys(next)) {
        const external =
          this.sendFeedback instanceof Map
            ? this.sendFeedback.get(key)
            : this.sendFeedback[key];
        if (external && external.kind !== "pending") {
          window.clearTimeout(this.sendFeedbackTimers.get(key));
          this.sendFeedbackTimers.delete(key);
          delete next[key];
          dirty = true;
        }
      }
      if (dirty) this.localSendFeedback = next;
    }
  }

  private restoreViewState() {
    if (this.viewRestored) return;
    this.viewRestored = true;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(LIBRARY_VIEW_KEY) || "null",
      ) as LibraryViewState | null;
      if (!saved) return;
      this.search = String(saved.search || "");
      this.applianceFilter = String(saved.applianceFilter || "all");
      this.locationFilter = String(saved.locationFilter || "all");
      this.selectionGroup = String(saved.selectionGroup || "");
      this.selectedCommandIds = Array.isArray(saved.selectedCommandIds)
        ? saved.selectedCommandIds.map(String)
        : [];
      this.selectionTarget = String(saved.selectionTarget || "");
      if (Number.isFinite(saved.scrollY))
        void this.updateComplete.then(() =>
          requestAnimationFrame(() =>
            window.scrollTo({ top: Number(saved.scrollY), behavior: "auto" }),
          ),
        );
    } catch {
      /* Browsing context persistence is optional. */
    }
  }

  private saveViewState = () => {
    if (!this.viewRestored) return;
    try {
      const state: LibraryViewState = {
        search: this.search,
        applianceFilter: this.applianceFilter,
        locationFilter: this.locationFilter,
        selectionGroup: this.selectionGroup,
        selectedCommandIds: this.selectedCommandIds,
        selectionTarget: this.selectionTarget,
        scrollY: window.scrollY,
      };
      sessionStorage.setItem(LIBRARY_VIEW_KEY, JSON.stringify(state));
    } catch {
      /* The Library still works when session storage is unavailable. */
    }
  };

  focusCommand(locId: string, applianceId: string, cmdId: string) {
    void this.updateComplete.then(() => {
      const target = this.renderRoot.querySelector<HTMLElement>(
        `[data-command="${CSS.escape(`${locId}||${applianceId}||${cmdId}`)}"]`,
      );
      target?.focus();
      target?.scrollIntoView({ block: "nearest" });
    });
  }

  private appliances(): ApplianceEntry[] {
    const entries: ApplianceEntry[] = [];
    for (const [locId, location] of Object.entries(
      this.registry.locations || {},
    )) {
      for (const [applianceId, appliance] of Object.entries(
        location.appliances || {},
      )) {
        entries.push({
          locId,
          applianceId,
          location,
          appliance,
          commands: Object.entries(appliance.commands || {}).map(
            ([cmdId, command]) => ({ cmdId, command }),
          ),
        });
      }
    }
    return entries.sort((a, b) => {
      const aSelected =
        a.locId === this.selectedLocation &&
        a.applianceId === this.selectedAppliance;
      const bSelected =
        b.locId === this.selectedLocation &&
        b.applianceId === this.selectedAppliance;
      return Number(bSelected) - Number(aSelected);
    });
  }

  private visibleAppliances(entries: ApplianceEntry[]): ApplianceEntry[] {
    const query = this.search.trim().toLocaleLowerCase();
    return entries.flatMap((entry) => {
      if (this.locationFilter !== "all" && entry.locId !== this.locationFilter)
        return [];
      if (
        this.applianceFilter !== "all" &&
        `${entry.locId}\u0000${entry.applianceId}` !== this.applianceFilter
      )
        return [];
      if (!query) return [entry];
      const groupMatches = [
        entry.appliance.name,
        entry.applianceId,
        entry.location.name,
        entry.locId,
        entry.appliance.appliance_type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
      const commands = groupMatches
        ? entry.commands
        : entry.commands.filter(({ cmdId, command }) =>
            [command.name, cmdId, command.role, command.format]
              .filter(Boolean)
              .join(" ")
              .toLocaleLowerCase()
              .includes(query),
          );
      return commands.length ? [{ ...entry, commands }] : [];
    });
  }

  private setFeedback(
    locId: string,
    applianceId: string,
    cmdId: string,
    notice: SendFeedback,
    timeout = 2400,
  ) {
    const key = itemKey(locId, applianceId, cmdId);
    window.clearTimeout(this.feedbackTimers.get(key));
    this.localFeedback = { ...this.localFeedback, [key]: notice };
    this.feedbackTimers.set(
      key,
      window.setTimeout(() => {
        const next = { ...this.localFeedback };
        delete next[key];
        this.localFeedback = next;
        this.feedbackTimers.delete(key);
      }, timeout),
    );
  }

  private notice(
    locId: string,
    applianceId: string,
    cmdId: string,
  ): SendFeedback | undefined {
    return this.localFeedback[itemKey(locId, applianceId, cmdId)];
  }

  private sendNotice(
    locId: string,
    applianceId: string,
    cmdId: string,
  ): SendFeedback | undefined {
    return (
      feedbackFor(this.sendFeedback, locId, applianceId, cmdId) ||
      this.localSendFeedback[itemKey(locId, applianceId, cmdId)]
    );
  }

  private send(locId: string, applianceId: string, cmdId: string) {
    const key = itemKey(locId, applianceId, cmdId);
    window.clearTimeout(this.sendFeedbackTimers.get(key));
    this.localSendFeedback = {
      ...this.localSendFeedback,
      [key]: { kind: "pending", message: "Sending once…" },
    };
    this.sendFeedbackTimers.set(
      key,
      window.setTimeout(() => {
        const next = { ...this.localSendFeedback };
        delete next[key];
        this.localSendFeedback = next;
        this.sendFeedbackTimers.delete(key);
      }, 8000),
    );
    emit(this, "command-send", { locId, applianceId, cmdId });
  }

  private async copyCode(
    locId: string,
    applianceId: string,
    cmdId: string,
    command: CommandData,
  ) {
    try {
      if (!command.code)
        throw new Error("This command has no stored payload to copy.");
      await copyText(command.code);
      this.setFeedback(locId, applianceId, cmdId, {
        kind: "success",
        message: "Code copied.",
      });
    } catch (error) {
      this.setFeedback(
        locId,
        applianceId,
        cmdId,
        {
          kind: "error",
          message: "Code could not be copied.",
          detail: String((error as Error).message || error),
        },
        6000,
      );
    }
  }

  private closeMenu(event: Event) {
    const details = (event.currentTarget as HTMLElement).closest("details");
    details?.removeAttribute("open");
    details?.querySelector<HTMLElement>(":scope > summary")?.focus();
  }

  private handleMenuKeydown(event: KeyboardEvent) {
    const menu = (event.currentTarget as HTMLElement).closest(
      ".menu-popover",
    ) as HTMLElement | null;
    const details = menu?.closest("details") as HTMLDetailsElement | null;
    if (!menu || !details) return;
    if (event.key === "Escape") {
      event.preventDefault();
      details.open = false;
      details.querySelector<HTMLElement>(":scope > summary")?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    ];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(event.target as HTMLButtonElement);
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[index]?.focus();
  }

  private handleMenuTriggerKeydown(event: KeyboardEvent) {
    const details = (event.currentTarget as HTMLElement).closest(
      "details",
    ) as HTMLDetailsElement | null;
    if (!details) return;
    if (event.key === "Escape" && details.open) {
      event.preventDefault();
      details.open = false;
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    details.open = true;
    this.positionOpenCommandMenu(details);
    requestAnimationFrame(() =>
      details
        .querySelector<HTMLButtonElement>(".menu-popover button:not(:disabled)")
        ?.focus(),
    );
  }

  private scheduleCommandMenu(event: Event) {
    const details = (event.currentTarget as HTMLElement).closest(
      "details",
    ) as HTMLDetailsElement | null;
    if (!details) return;
    window.requestAnimationFrame(() => {
      if (!details.open) return;
      this.renderRoot
        .querySelectorAll<HTMLDetailsElement>("details.menu[open]")
        .forEach((other) => {
          if (other !== details) other.removeAttribute("open");
        });
      this.positionOpenCommandMenu(details);
    });
  }

  private positionOpenCommandMenu(details: HTMLDetailsElement) {
    const menu = details.querySelector<HTMLElement>(":scope > .menu-popover");
    const trigger = details.querySelector<HTMLElement>(":scope > summary");
    if (!menu || !trigger) return;
    if (window.matchMedia("(max-width: 520px)").matches) {
      menu.style.removeProperty("--menu-left");
      menu.style.removeProperty("--menu-top");
      menu.style.removeProperty("max-height");
      return;
    }
    const margin = 12;
    const gap = 6;
    const triggerBox = trigger.getBoundingClientRect();
    const width = menu.getBoundingClientRect().width;
    const rightAligned = triggerBox.right - width;
    const leftAligned = triggerBox.left;
    const left =
      rightAligned >= margin
        ? rightAligned
        : Math.min(leftAligned, window.innerWidth - margin - width);
    const availableBelow = Math.max(
      0,
      window.innerHeight - margin - triggerBox.bottom - gap,
    );
    const availableAbove = Math.max(0, triggerBox.top - margin - gap);
    const openBelow =
      menu.scrollHeight <= availableBelow || availableBelow >= availableAbove;
    const availableHeight = Math.max(
      120,
      openBelow ? availableBelow : availableAbove,
    );
    const height = Math.min(menu.scrollHeight, availableHeight);
    const top = openBelow
      ? triggerBox.bottom + gap
      : triggerBox.top - gap - height;
    menu.style.setProperty("--menu-left", `${Math.round(left)}px`);
    menu.style.setProperty("--menu-top", `${Math.round(top)}px`);
    menu.style.setProperty("max-height", `${Math.round(availableHeight)}px`);
  }

  private renderCommand(
    entry: ApplianceEntry,
    cmdId: string,
    command: CommandData,
  ) {
    const ref = { locId: entry.locId, applianceId: entry.applianceId, cmdId };
    const selected =
      this.inspector?.locId === entry.locId &&
      this.inspector?.applianceId === entry.applianceId &&
      this.inspector?.cmdId === cmdId;
    if (this.selectionGroup === `${entry.locId}\u0000${entry.applianceId}`) {
      const checked = this.selectedCommandIds.includes(cmdId);
      return html`<article class="command selection-mode ${checked ? "multi-selected" : ""}">
        <label class="command-choice"><input type="checkbox" .checked=${checked} ?disabled=${this.busy} @change=${() => this.toggleCommandSelection(cmdId)}><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon><span class="command-copy"><strong>${command.name || cmdId}</strong>${command.role ? html`<small>${String(command.role).replaceAll("_", " ")}</small>` : nothing}</span></label>
      </article>`;
    }
    const sendNotice = this.sendNotice(entry.locId, entry.applianceId, cmdId);
    const sendState = sendNotice?.kind || "";
    const sendIcon =
      sendState === "success"
        ? "mdi:check"
        : sendState === "error"
          ? "mdi:alert-circle-outline"
          : sendState === "pending"
            ? "mdi:loading"
            : "mdi:send";
    const sendTitle = !this.canTransmit
      ? "IR emitter unavailable"
      : sendNotice
        ? [sendNotice.message, sendNotice.detail].filter(Boolean).join(" ")
        : "Send once";
    const actionNotice = this.notice(entry.locId, entry.applianceId, cmdId);
    const actionIcon =
      actionNotice?.kind === "success"
        ? "mdi:check"
        : actionNotice?.kind === "error"
          ? "mdi:alert-circle-outline"
          : "mdi:dots-vertical";
    const actionTitle = actionNotice
      ? [actionNotice.message, actionNotice.detail].filter(Boolean).join(" ")
      : "Command actions";
    return html`<article class="command ${selected ? "selected" : ""}">
      <button class="command-open" data-command=${`${entry.locId}||${entry.applianceId}||${cmdId}`} aria-pressed=${selected} @click=${() => emit(this, "command-open", ref)}><ha-icon icon=${command.icon || "mdi:remote"}></ha-icon><span class="command-copy"><strong>${command.name || cmdId}</strong>${command.role ? html`<small>${String(command.role).replaceAll("_", " ")}</small>` : nothing}</span></button>
      <button class="btn icon send ${sendState}" title=${sendTitle} aria-label=${`Send ${command.name || cmdId} once`} aria-busy=${sendState === "pending" ? "true" : "false"} ?disabled=${this.busy || !this.canTransmit || sendState === "pending"} @click=${() => this.send(entry.locId, entry.applianceId, cmdId)}><ha-icon icon=${sendIcon}></ha-icon></button>
      <details class="menu command-menu"><summary class="btn icon ${actionNotice ? `action-${actionNotice.kind}` : ""}" role="button" aria-label=${`Actions for ${command.name || cmdId}`} title=${actionTitle} @click=${(event: Event) => this.scheduleCommandMenu(event)} @keydown=${this.handleMenuTriggerKeydown}><ha-icon icon=${actionIcon}></ha-icon></summary><div class="menu-popover" @keydown=${this.handleMenuKeydown}>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "command-rename", ref);
        }}><ha-icon icon="mdi:pencil-outline"></ha-icon>Rename</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "command-move",
            ...ref,
            name: command.name || cmdId,
            targetKey: `${entry.locId}||${entry.applianceId}`,
          };
        }}><ha-icon icon="mdi:folder-move-outline"></ha-icon>Move</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "command-duplicate",
            ...ref,
            name: `${command.name || cmdId} copy`,
            targetKey: `${entry.locId}||${entry.applianceId}`,
          };
        }}><ha-icon icon="mdi:content-duplicate"></ha-icon>Duplicate</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "command-relearn", ref);
        }}><ha-icon icon="mdi:backup-restore"></ha-icon>Relearn</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          void this.copyCode(entry.locId, entry.applianceId, cmdId, command);
        }}><ha-icon icon="mdi:content-copy"></ha-icon>Copy code</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "command-export", ref);
        }}><ha-icon icon="mdi:file-export-outline"></ha-icon>Export command</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "command-role",
            ...ref,
            name: command.name || cmdId,
            value: command.role || "",
          };
        }}><ha-icon icon="mdi:format-list-bulleted-type"></ha-icon>Edit role</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "command-icon",
            ...ref,
            name: command.name || cmdId,
            value: command.icon || "",
          };
        }}><ha-icon icon="mdi:shape-outline"></ha-icon>Choose icon</button>
        <button class="danger" @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "command-delete", ref);
        }}><ha-icon icon="mdi:delete-outline"></ha-icon>Delete command…</button>
      </div></details>
      ${sendNotice ? html`<span class="sr-only" role=${sendState === "error" ? "alert" : "status"} aria-live=${sendState === "error" ? "assertive" : "polite"}>${sendNotice.message}${sendNotice.detail ? ` ${sendNotice.detail}` : ""}</span>` : nothing}
      ${actionNotice ? html`<span class="sr-only" role=${actionNotice.kind === "error" ? "alert" : "status"} aria-live=${actionNotice.kind === "error" ? "assertive" : "polite"}>${actionNotice.message}${actionNotice.detail ? ` ${actionNotice.detail}` : ""}</span>` : nothing}
    </article>`;
  }

  private startSelection(entry: ApplianceEntry, appliances: ApplianceEntry[]) {
    this.selectionGroup = `${entry.locId}\u0000${entry.applianceId}`;
    this.selectedCommandIds = [];
    const firstTarget = appliances.find(
      (candidate) =>
        candidate.locId !== entry.locId ||
        candidate.applianceId !== entry.applianceId,
    );
    this.selectionTarget = firstTarget
      ? `${firstTarget.locId}||${firstTarget.applianceId}`
      : "";
    this.editor = null;
  }

  private stopSelection() {
    this.selectionGroup = "";
    this.selectedCommandIds = [];
    this.selectionTarget = "";
  }

  private toggleCommandSelection(cmdId: string) {
    this.selectedCommandIds = this.selectedCommandIds.includes(cmdId)
      ? this.selectedCommandIds.filter((value) => value !== cmdId)
      : [...this.selectedCommandIds, cmdId];
  }

  private toggleAllCommands(entry: ApplianceEntry) {
    const ids = entry.commands.map(({ cmdId }) => cmdId);
    this.selectedCommandIds =
      ids.length > 0 &&
      ids.every((cmdId) => this.selectedCommandIds.includes(cmdId))
        ? []
        : ids;
  }

  private moveTarget(entry: ApplianceEntry, appliances: ApplianceEntry[]) {
    const targets = appliances.filter(
      (candidate) =>
        candidate.locId !== entry.locId ||
        candidate.applianceId !== entry.applianceId,
    );
    const targetKey = targets.some(
      (candidate) =>
        `${candidate.locId}||${candidate.applianceId}` === this.selectionTarget,
    )
      ? this.selectionTarget
      : targets[0]
        ? `${targets[0].locId}||${targets[0].applianceId}`
        : "";
    return { targets, targetKey };
  }

  private moveSelectedCommands(
    entry: ApplianceEntry,
    appliances: ApplianceEntry[],
  ) {
    if (!this.selectedCommandIds.length) return;
    const { targetKey } = this.moveTarget(entry, appliances);
    if (!targetKey) return;
    emit(this, "commands-move", {
      commands: this.selectedCommandIds.map((cmdId) => ({
        locId: entry.locId,
        applianceId: entry.applianceId,
        cmdId,
      })),
      targetKey,
      complete: () => this.stopSelection(),
    });
  }

  private renderAppliance(entry: ApplianceEntry, appliances: ApplianceEntry[]) {
    const commandCount = Object.keys(entry.appliance.commands || {}).length;
    const ref = { locId: entry.locId, applianceId: entry.applianceId };
    const applianceName = applianceDisplayName(
      entry.locId,
      entry.applianceId,
      entry.appliance.name,
    );
    const locationName = locationDisplayName(entry.locId, entry.location.name);
    const selectionActive =
      this.selectionGroup === `${entry.locId}\u0000${entry.applianceId}`;
    const { targets, targetKey } = this.moveTarget(entry, appliances);
    const allSelected =
      entry.commands.length > 0 &&
      entry.commands.every(({ cmdId }) =>
        this.selectedCommandIds.includes(cmdId),
      );
    return html`<section class="group"><header class="group-head"><div class="actions"><h2>${applianceName}</h2>${locationName ? html`<span class="location-label">/ ${locationName}</span>` : nothing}</div><div class="group-actions">
      ${commandCount && !selectionActive ? html`<button class="btn selection-trigger" title="Select commands" aria-label=${`Select commands in ${applianceName}`} @click=${() => this.startSelection(entry, appliances)}><ha-icon icon="mdi:checkbox-multiple-outline"></ha-icon><span>Select</span></button>` : nothing}
      <button class="btn icon" title="Learn a button for this appliance" aria-label=${`Learn a button for ${applianceName}`} @click=${() => emit(this, "learn-request-for", ref)}><ha-icon icon="mdi:plus"></ha-icon></button>
      <details class="menu"><summary class="btn icon" role="button" title="Appliance actions" aria-label=${`Actions for ${applianceName}`} @keydown=${this.handleMenuTriggerKeydown}><ha-icon icon="mdi:dots-vertical"></ha-icon></summary><div class="menu-popover" @keydown=${this.handleMenuKeydown}>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "appliance-actions", ref);
        }}><ha-icon icon="mdi:pencil-outline"></ha-icon>Rename appliance</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "appliance-move",
            ...ref,
            name: entry.appliance.name || entry.applianceId,
            targetLocationId: entry.locId,
          };
        }}><ha-icon icon="mdi:map-marker-right-outline"></ha-icon>Move or change location</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "appliance-import", ref);
        }}><ha-icon icon="mdi:file-import-outline"></ha-icon>Import commands</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "appliance-export", ref);
        }}><ha-icon icon="mdi:file-export-outline"></ha-icon>Export appliance</button>
        <button @click=${(event: Event) => {
          this.closeMenu(event);
          this.editor = {
            kind: "appliance-settings",
            ...ref,
            name: entry.appliance.name || entry.applianceId,
            type: entry.appliance.appliance_type || "generic",
            preferredPlatform: entry.appliance.preferred_platform || "auto",
            emitterId: entry.appliance.emitter_id || "",
          };
        }}><ha-icon icon="mdi:tune-variant"></ha-icon>Entity settings</button>
        <button class="danger" @click=${(event: Event) => {
          this.closeMenu(event);
          emit(this, "appliance-delete", {
            ...ref,
            commandCount,
            name: entry.appliance.name || entry.applianceId,
          });
        }}><ha-icon icon="mdi:delete-outline"></ha-icon>Delete appliance… (${commandCount})</button>
      </div></details>
    </div></header>
    ${
      selectionActive
        ? html`<div class="selection-bar" role="region" aria-label=${`Organize commands in ${applianceName}`}>
      <label class="select-all"><input type="checkbox" .checked=${allSelected} ?disabled=${this.busy || !entry.commands.length} @change=${() => this.toggleAllCommands(entry)}><span>Select all</span></label>
      <span class="selection-count" role="status" aria-live="polite">${this.selectedCommandIds.length} selected</span>
      ${
        targets.length
          ? html`<select class="selection-target" aria-label="Move selected commands to" .value=${targetKey} ?disabled=${this.busy} @change=${(event: Event) => (this.selectionTarget = (event.target as HTMLSelectElement).value)}>${targets.map(
              (target) => {
                const targetLocation = locationDisplayName(
                  target.locId,
                  target.location.name,
                );
                return html`<option value=${`${target.locId}||${target.applianceId}`}>${applianceDisplayName(target.locId, target.applianceId, target.appliance.name, "No appliance")}${targetLocation ? ` · ${targetLocation}` : ""}</option>`;
              },
            )}</select>`
          : html`<button class="btn selection-target" ?disabled=${this.busy} @click=${() => emit(this, "appliance-create", {})}><ha-icon icon="mdi:plus"></ha-icon>Add an appliance first</button>`
      }
      <button class="btn primary selection-move" ?disabled=${this.busy || !this.selectedCommandIds.length || !targetKey} @click=${() => this.moveSelectedCommands(entry, appliances)}><ha-icon icon="mdi:folder-move-outline"></ha-icon>Move ${this.selectedCommandIds.length || "selected"}</button>
      <button class="btn selection-cancel" ?disabled=${this.busy} @click=${() => this.stopSelection()}>Cancel</button>
    </div>`
        : nothing
    }
    <div class="commands">${entry.commands.length ? entry.commands.map(({ cmdId, command }) => this.renderCommand(entry, cmdId, command)) : html`<div class="empty-group">No commands yet. Learn a button or import commands for this appliance.</div>`}</div></section>`;
  }

  private updateEditor(field: string, value: string) {
    if (this.editor) this.editor = { ...this.editor, [field]: value };
  }

  private submitEditor(event: SubmitEvent) {
    event.preventDefault();
    const editor = this.editor;
    if (!editor) return;
    if (editor.kind === "command-move") emit(this, "command-move", editor);
    if (editor.kind === "command-duplicate")
      emit(this, "command-duplicate", editor);
    if (editor.kind === "command-role")
      emit(this, "command-edit-role", {
        ...editor,
        role: String(editor.value || "").trim(),
      });
    if (editor.kind === "command-icon")
      emit(this, "command-edit-icon", {
        ...editor,
        icon: String(editor.value || "").trim(),
      });
    if (editor.kind === "appliance-move") emit(this, "appliance-move", editor);
    if (editor.kind === "appliance-settings")
      emit(this, "appliance-entity-settings", editor);
    this.editor = null;
  }

  private renderEditor(appliances: ApplianceEntry[]) {
    const editor = this.editor;
    if (!editor) return nothing;
    const locations = Object.entries(this.registry.locations || {});
    const commandMove =
      editor.kind === "command-move" || editor.kind === "command-duplicate";
    const heading =
      editor.kind === "command-move"
        ? `Move ${editor.name}`
        : editor.kind === "command-duplicate"
          ? `Duplicate ${editor.name}`
          : editor.kind === "command-role"
            ? `Edit role for ${editor.name}`
            : editor.kind === "command-icon"
              ? `Edit icon for ${editor.name}`
              : editor.kind === "appliance-move"
                ? `Move ${editor.name}`
                : `Entity settings for ${editor.name}`;
    const noCommandTarget =
      editor.kind === "command-move" && appliances.length < 2;
    const noLocationTarget =
      editor.kind === "appliance-move" && locations.length < 2;
    return html`<imprint-dialog .heading=${heading} @dialog-close=${() => (this.editor = null)}><form class="dialog-form" @submit=${(event: SubmitEvent) => this.submitEditor(event)}>
      ${commandMove ? html`<label class="field">Destination appliance<select .value=${editor.targetKey} @change=${(event: Event) => this.updateEditor("targetKey", (event.target as HTMLSelectElement).value)}>${appliances.map((entry) => html`<option value=${`${entry.locId}||${entry.applianceId}`} ?disabled=${editor.kind === "command-move" && entry.locId === editor.locId && entry.applianceId === editor.applianceId}>${entry.appliance.name || entry.applianceId}${entry.location.name ? ` · ${entry.location.name}` : ""}</option>`)}</select></label>${editor.kind === "command-duplicate" ? html`<label class="field">New command name<input class="input" required .value=${editor.name} @input=${(event: Event) => this.updateEditor("name", (event.target as HTMLInputElement).value)}></label>` : nothing}${noCommandTarget ? html`<div class="notice warning"><ha-icon icon="mdi:information-outline"></ha-icon><span>Create another appliance before moving this command.</span></div>` : nothing}` : nothing}
      ${editor.kind === "command-role" ? html`<label class="field">Home Assistant shortcut (optional)<select .value=${editor.value} @change=${(event: Event) => this.updateEditor("value", (event.target as HTMLSelectElement).value)}><option value="">No shortcut</option>${HOME_ASSISTANT_ROLES.map((role) => html`<option value=${role}>${humanizeToken(role)}</option>`)}</select><small>Your command can have any name. Choose a standard shortcut only when Home Assistant should expose it as a familiar media or power action.</small></label>` : nothing}
      ${
        editor.kind === "command-icon"
          ? html`<div class="icon-editor">
        <div class="icon-preview" aria-live="polite"><ha-icon icon=${editor.value || "mdi:remote"}></ha-icon><div class="icon-preview-copy"><strong>Command icon</strong><small>${editor.value || "Default · mdi:remote"}</small></div><button type="button" class="btn" ?disabled=${!editor.value} @click=${() => this.updateEditor("value", "")}>Use default</button></div>
        ${this.nativeIconPickerAvailable ? html`<ha-icon-picker .value=${String(editor.value || "")} .label=${"Search Home Assistant icons"} .helper=${"Choose any icon installed in Home Assistant."} .placeholder=${"mdi:remote"} @value-changed=${(event: CustomEvent<{ value?: string }>) => this.updateEditor("value", String(event.detail?.value || ""))}></ha-icon-picker>` : html`<label class="field">Home Assistant icon<input class="input" .value=${editor.value} placeholder="mdi:power" @input=${(event: Event) => this.updateEditor("value", (event.target as HTMLInputElement).value)}><small>Enter an icon name such as mdi:power or leave it empty to use the default.</small></label>`}
        <p class="icon-search-help">Search by object or action—for example lightbulb, palette, fan, power, volume, timer, blinds, or play. Results include the full installed Material Design Icons library and supported custom icon sets.</p>
      </div>`
          : nothing
      }
      ${editor.kind === "appliance-move" ? html`<label class="field">Location<select .value=${editor.targetLocationId} @change=${(event: Event) => this.updateEditor("targetLocationId", (event.target as HTMLSelectElement).value)}>${locations.map(([locId, location]) => html`<option value=${locId} ?disabled=${locId === editor.locId}>${locationDisplayName(locId, location.name) || "No location"}</option>`)}</select></label>${noLocationTarget ? html`<div class="notice warning"><ha-icon icon="mdi:information-outline"></ha-icon><span>Add another location before moving this appliance.</span></div>` : nothing}` : nothing}
      ${editor.kind === "appliance-settings" ? html`<label class="field">Appliance type<input class="input" .value=${editor.type} @input=${(event: Event) => this.updateEditor("type", (event.target as HTMLInputElement).value)}></label><label class="field">Preferred entity domain<select .value=${editor.preferredPlatform} @change=${(event: Event) => this.updateEditor("preferredPlatform", (event.target as HTMLSelectElement).value)}><option value="auto">Automatic</option><option value="media_player">Media player</option><option value="remote">Remote</option><option value="switch">Switch</option></select></label><label class="field">Assigned emitter<select .value=${editor.emitterId} @change=${(event: Event) => this.updateEditor("emitterId", (event.target as HTMLSelectElement).value)}><option value="">Use active emitter</option>${(this.registry.emitters || []).filter((item) => item.enabled !== false).map((item) => html`<option value=${item.key}>${item.name || item.entity_id || item.key}</option>`)}</select></label>` : nothing}
      <div class="dialog-actions"><button type="button" class="btn" @click=${() => (this.editor = null)}>Cancel</button><button class="btn primary" ?disabled=${noCommandTarget || noLocationTarget || (editor.kind === "command-move" && editor.targetKey === `${editor.locId}||${editor.applianceId}`) || (editor.kind === "appliance-move" && editor.targetLocationId === editor.locId)}>${editor.kind === "command-duplicate" ? "Duplicate" : "Save"}</button></div>
    </form></imprint-dialog>`;
  }

  render() {
    const appliances = this.appliances();
    const visible = this.visibleAppliances(appliances);
    const commandCount = appliances.reduce(
      (sum, entry) => sum + entry.commands.length,
      0,
    );
    const locations = Object.entries(this.registry.locations || {});
    const filtered = Boolean(
      this.search.trim() ||
        this.applianceFilter !== "all" ||
        this.locationFilter !== "all",
    );
    return html`
      <div class="head"><h1 class="sr-only">Command library</h1><span class="sr-only" aria-live="polite">${commandCount} saved command${commandCount === 1 ? "" : "s"}</span>
      <label class="search"><span class="sr-only">Search library</span><ha-icon icon="mdi:magnify"></ha-icon><input class="input" type="search" placeholder="Search appliances and commands" .value=${this.search} @input=${(
        event: Event,
      ) => {
        this.search = (event.target as HTMLInputElement).value;
        this.saveViewState();
      }}></label>
      <div class="filters" aria-label="Filter command library"><button class="chip ${this.applianceFilter === "all" ? "active" : ""}" @click=${() => {
        this.applianceFilter = "all";
        this.saveViewState();
      }}>All</button>${appliances.map((entry) => {
        const value = `${entry.locId}\u0000${entry.applianceId}`;
        return html`<button class="chip ${this.applianceFilter === value ? "active" : ""}" @click=${() => {
          this.applianceFilter = value;
          this.saveViewState();
        }}>${applianceDisplayName(entry.locId, entry.applianceId, entry.appliance.name, "No appliance")}</button>`;
      })}${
        locations.filter(([locId, location]) =>
          locationDisplayName(locId, location.name),
        ).length > 1
          ? html`<label><span class="sr-only">Filter by location</span><select class="location-filter" .value=${this.locationFilter} @change=${(
              event: Event,
            ) => {
              this.locationFilter = (event.target as HTMLSelectElement).value;
              this.saveViewState();
            }}><option value="all" ?selected=${this.locationFilter === "all"}>Every location</option>${locations.filter(([locId, location]) => locationDisplayName(locId, location.name)).map(([locId, location]) => html`<option value=${locId} ?selected=${this.locationFilter === locId}>${locationDisplayName(locId, location.name)}</option>`)}</select></label>`
          : nothing
      }</div></div>
      ${!this.hasEmitter ? html`<div class="notice warning status" role="status"><ha-icon icon="mdi:access-point-off"></ha-icon><span>No IR emitter is configured. You can still inspect, copy, organize, import, and export saved commands.</span></div>` : !this.canTransmit ? html`<div class="notice warning status" role="status"><ha-icon icon="mdi:lan-disconnect"></ha-icon><span>The IR emitter is offline. Saved commands remain available for inspection, copying, and export.</span></div>` : nothing}
      ${
        visible.length
          ? html`<div class="groups">${visible.map((entry) => this.renderAppliance(entry, appliances))}</div>`
          : html`<div class="empty empty-library"><div><ha-icon icon=${filtered ? "mdi:magnify-close" : "mdi:remote-plus-outline"}></ha-icon><h2>${filtered ? "No matching commands" : "Your command library is empty"}</h2><p>${filtered ? "Clear a filter or try another appliance or command name." : "Learn your first button now, or create an appliance to organize commands later."}</p>${
              filtered
                ? html`<button class="btn" @click=${() => {
                    this.search = "";
                    this.applianceFilter = "all";
                    this.locationFilter = "all";
                  }}>Clear filters</button>`
                : html`<button class="btn primary" @click=${() => emit(this, "learn-request-for", {})}>Learn your first button</button>`
            }</div></div>`
      }
      <div class="create-actions"><button class="btn" @click=${() => emit(this, "appliance-create", {})}><ha-icon icon="mdi:plus"></ha-icon>Add appliance</button><button class="btn" @click=${() => emit(this, "custom-signal-open")}><ha-icon icon="mdi:waveform"></ha-icon>Create custom signal</button><button class="btn link" @click=${() => emit(this, "catalog-open")}>Find codes</button><details class="menu library-menu"><summary class="btn" role="button" title="Library tools" aria-label="Library tools" @keydown=${this.handleMenuTriggerKeydown}><ha-icon icon="mdi:bookshelf"></ha-icon>Library<ha-icon icon="mdi:chevron-down"></ha-icon></summary><div class="menu-popover" @keydown=${this.handleMenuKeydown}><button @click=${(
        event: Event,
      ) => {
        this.closeMenu(event);
        emit(this, "import-open");
      }}><ha-icon icon="mdi:backup-restore"></ha-icon>Restore library</button><button @click=${(
        event: Event,
      ) => {
        this.closeMenu(event);
        emit(this, "export-backup");
      }}><ha-icon icon="mdi:download-outline"></ha-icon>Back up library</button><button @click=${(
        event: Event,
      ) => {
        this.closeMenu(event);
        emit(this, "location-add");
      }}><ha-icon icon="mdi:map-marker-multiple-outline"></ha-icon>Locations</button></div></details></div>
      ${this.renderEditor(appliances)}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "imprint-library-browser": ImprintLibraryBrowser;
  }
}
