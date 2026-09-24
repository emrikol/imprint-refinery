export interface SignalLabRequestDetail extends Record<string, unknown> {
  action: string;
}

export type SignalLabRequest = (
  action: string,
  detail?: Record<string, unknown>,
) => void;
