import type { LabPreview } from "../../types";
import {
  formatTimingSelection,
  makePreview,
  parseTimingClipboard,
  pasteParityError,
  selectionRange,
  type ClipboardFormat,
  type SignalLabState,
} from "../../core/signal-lab";
import { copyText } from "../../core/utils";

interface PasteContext {
  start: number;
  end: number;
  timings: number[];
  carrierFrequency?: number;
}

export interface SignalLabClipboardHost {
  action(action: string, detail?: Record<string, unknown>): void;
  preview(preview: LabPreview): void;
  notify(message: string): void;
  setError(message: string): void;
}

/** Owns browser clipboard access and the paste-preview transaction. */
export class SignalLabClipboardController {
  private pasteContext: PasteContext | null = null;

  constructor(private readonly host: SignalLabClipboardHost) {}

  async copyCode(
    value: string,
    success = "Encoded code copied.",
  ): Promise<void> {
    try {
      await copyText(value);
      this.host.notify(success);
    } catch {
      this.host.setError(
        "Clipboard access is unavailable. Select the visible code and copy it manually.",
      );
    }
  }

  async copySelection(
    lab: SignalLabState,
    cut: boolean,
    format: ClipboardFormat = "signed",
  ): Promise<void> {
    const [start, end] = selectionRange(
      lab.timings.length,
      lab.selectionStart,
      lab.selectionEnd,
    );
    const timings = lab.timings.slice(start, end + 1);
    if (format === "pronto") {
      this.host.action("copy", {
        format: "pronto",
        timings,
        start,
        carrierFrequency: lab.carrierFrequency,
        cut,
      });
      return;
    }
    const value = formatTimingSelection(
      timings,
      start,
      lab.carrierFrequency,
      format,
    );
    try {
      await copyText(value);
      this.host.notify(
        cut
          ? "Copied selection and removed it from the draft."
          : "Selection copied.",
      );
      this.host.action("copy", {
        format,
        timings,
        start,
        carrierFrequency: lab.carrierFrequency,
        text: value,
        cut,
        handled: true,
      });
      if (cut) this.host.action("delete-selection", { start, end });
    } catch {
      this.host.setError(
        "Clipboard access is unavailable. Use the copy action from a secure Home Assistant page.",
      );
    }
  }

  async pasteSelection(lab: SignalLabState): Promise<void> {
    if (!navigator.clipboard?.readText || !window.isSecureContext) {
      this.host.setError(
        "Clipboard reading is unavailable here. Paste through Import instead.",
      );
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseTimingClipboard(text);
      const [start, end] = selectionRange(
        lab.timings.length,
        lab.selectionStart,
        lab.selectionEnd,
      );
      if (!parsed.timings) {
        this.host.action("paste-request", {
          text,
          format: parsed.format,
          start,
          end,
          carrierFrequency: lab.carrierFrequency,
        });
        return;
      }
      const parity = pasteParityError(
        start,
        end - start + 1,
        parsed.timings.length,
      );
      if (parity) {
        this.host.setError(parity);
        return;
      }
      const next = [...lab.timings];
      next.splice(start, end - start + 1, ...parsed.timings);
      this.pasteContext = {
        start,
        end,
        timings: parsed.timings,
        carrierFrequency: parsed.carrierFrequency,
      };
      this.host.preview(
        makePreview(
          "Paste timing data",
          lab.timings,
          next,
          lab.sourceAnalysis,
          "Review mark/space alignment before applying.",
          parsed.timings,
        ),
      );
    } catch (error) {
      this.host.setError(
        error instanceof Error
          ? error.message
          : "The clipboard timing data could not be read.",
      );
    }
  }

  async copyWholeSignal(lab: SignalLabState): Promise<void> {
    const text = formatTimingSelection(
      lab.timings,
      0,
      lab.carrierFrequency,
      "json",
    );
    try {
      await copyText(text);
      this.host.notify("Complete custom signal copied as JSON.");
      this.host.action("copy", {
        format: "json",
        timings: [...lab.timings],
        carrierFrequency: lab.carrierFrequency,
        text,
        handled: true,
      });
    } catch {
      this.host.setError(
        "Clipboard access is unavailable. Use the copy action from a secure Home Assistant page.",
      );
    }
  }

  applyPastePreview(preview: LabPreview): boolean {
    if (!this.pasteContext) return false;
    this.host.action("paste-apply", {
      ...this.pasteContext,
      timings: preview.timings,
    });
    this.pasteContext = null;
    return true;
  }

  cancelPreview(): void {
    this.pasteContext = null;
  }
}
