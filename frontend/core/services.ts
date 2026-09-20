import type { Dict, HomeAssistant } from "../types";

const EMITTER_SERVICES = new Set([
  "capture_signal",
  "cancel_capture",
  "send_signal",
  "send_command",
  "get_library",
  "catalog_guided_test",
]);

export class ImprintServices {
  constructor(
    public hass: HomeAssistant,
    public emitterId = "",
  ) {}

  async call(service: string, data: Dict = {}): Promise<any> {
    const serviceData =
      this.emitterId && EMITTER_SERVICES.has(service)
        ? { emitter_id: this.emitterId, ...data }
        : data;
    const result = await this.hass.callWS({
      type: "imprint_refinery/execute",
      action: service,
      data: serviceData,
    });
    return result?.response ?? result ?? {};
  }
}
