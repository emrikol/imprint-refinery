import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ClipboardFormat } from "../../core/signal-lab";

/** Owns transient Advanced timing tools fields without adding a DOM boundary. */
export class SignalLabToolsController implements ReactiveController {
  scale = 100;
  quantum = 50;
  gap = 20_000;
  copyFormat: ClipboardFormat = "signed";

  constructor(private readonly host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {}

  setScale(value: number): void {
    this.scale = value;
    this.host.requestUpdate();
  }

  setQuantum(value: number): void {
    this.quantum = value;
    this.host.requestUpdate();
  }

  setGap(value: number): void {
    this.gap = value;
    this.host.requestUpdate();
  }

  setCopyFormat(value: ClipboardFormat): void {
    this.copyFormat = value;
    this.host.requestUpdate();
  }
}
