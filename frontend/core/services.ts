import type { Dict, HomeAssistant } from "../types";

export class ImprintServices {
  constructor(public hass: HomeAssistant) {}

  async call(service: string, data: Dict = {}): Promise<any> {
    const result = await this.hass.callWS({
      type: "imprint_refinery/execute",
      action: service,
      data,
    });
    return result?.response ?? result ?? {};
  }
}
