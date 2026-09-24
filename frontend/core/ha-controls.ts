export interface HaSelectOption {
  value: string | number;
  label?: string;
  secondary?: string;
  disabled?: boolean;
}

interface HaValueControl extends EventTarget {
  value?: string | number | null;
  checked?: boolean;
}

/** Read the current value from Home Assistant input and textarea controls. */
export const haControlValue = (event: Event): string =>
  String((event.currentTarget as HaValueControl | null)?.value ?? "");

/** Read the value emitted by Home Assistant's `ha-select` component. */
export const haSelectedValue = (event: Event): string =>
  String(
    (event as CustomEvent<{ value?: string | number }>).detail?.value ?? "",
  );

/** Read the selected item's value from Home Assistant's `ha-dropdown`. */
export const haDropdownValue = (event: Event): string =>
  String(
    (event as CustomEvent<{ item?: { value?: string | number } }>).detail?.item
      ?.value ?? "",
  );

/** Read the checked state from Home Assistant toggle controls. */
export const haControlChecked = (event: Event): boolean =>
  Boolean((event.currentTarget as HaValueControl | null)?.checked);
