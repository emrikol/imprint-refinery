import { emit } from "./utils";

export interface HomeAssistantToastOptions {
  id?: string;
  announceMessage?: string;
  duration?: number;
  dismissable?: boolean;
}

const DEFAULT_TOAST_ID = "imprint-refinery-transient";

/**
 * Ask Home Assistant's notification manager to show its global toast.
 * The host owns rendering, timing, stacking, and accessible announcements.
 */
export const showHomeAssistantToast = (
  target: EventTarget,
  message: string,
  options: HomeAssistantToastOptions = {},
): void => {
  emit(target, "hass-notification", {
    ...options,
    id: options.id || DEFAULT_TOAST_ID,
    message,
  });
};
