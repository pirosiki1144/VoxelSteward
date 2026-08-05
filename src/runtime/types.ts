import type {
  ReadonlyMinecraftConnection,
  SmokeConfig,
} from "../smoke/types.js";

export type RuntimeStopReason =
  | "other_player_detected"
  | "signal_sigint"
  | "signal_sigterm"
  | "stop_requested"
  | "schedule_window_ended"
  | "reconnect_exhausted"
  | "connection_error"
  | "internal_error";

export interface RuntimeConfig extends Omit<
  SmokeConfig,
  "mode" | "timeoutSeconds"
> {
  mode: "normal";
  maxRetries: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
}

export interface RuntimeResult {
  reason: RuntimeStopReason;
  exitCode: 0 | 1;
}

export type ConnectionFactory = () => ReadonlyMinecraftConnection;

export type Wait = (delayMs: number, signal: AbortSignal) => Promise<void>;
