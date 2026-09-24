import { html, type TemplateResult } from "lit";

export const renderTimingNudgeButtons = (
  index: number,
  onNudge: (index: number, amount: number) => void,
): TemplateResult => html`
  ${([-10, -1, 1, 10] as const).map((amount) => html`
    <ha-button
      appearance="outlined"
      variant="neutral"
      @click=${() => onNudge(index, amount)}
    >${amount > 0 ? "+" : "−"}${Math.abs(amount)}</ha-button>
  `)}
`;
