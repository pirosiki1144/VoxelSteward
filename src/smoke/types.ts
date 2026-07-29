export type BotMode = "normal" | "debug";

export type StopReason =
  | "timeout"
  | "other_player_detected"
  | "signal_sigint"
  | "signal_sigterm"
  | "connection_closed"
  | "connection_error";

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface BotState {
  playerName?: string;
  dimension?: string;
  position?: Position;
  health?: number;
  hunger?: number;
}

export interface PlayerEvent {
  id: string;
  name?: string;
  detectedAt: string;
}

export interface ConnectionEvents {
  authenticated: (playerName: string) => void;
  join: () => void;
  spawn: () => void;
  state: (state: Partial<BotState>) => void;
  playerJoined: (player: PlayerEvent) => void;
  playerLeft: (player: PlayerEvent) => void;
  error: (error: Error) => void;
  close: () => void;
}

export interface ReadonlyMinecraftConnection {
  on<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this;
  disconnect(reason: string): void;
}

export interface SmokeConfig {
  host: string;
  port: number;
  version?: "1.26.30";
  accountId: string;
  mode: BotMode;
  timeoutSeconds: number;
  authProfilesFolder: string;
  logLevel: "debug" | "info" | "warn" | "error";
}

export interface SmokeResult {
  reason: StopReason;
  exitCode: 0 | 1;
}
