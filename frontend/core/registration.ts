import { customElement } from "lit/decorators.js";

/** Register a component once when Home Assistant reloads a cache-busted bundle. */
export const safeCustomElement = (tagName: string) =>
  customElements.get(tagName)
    ? (classOrDescriptor: any) => classOrDescriptor
    : customElement(tagName);
