export type BotMode = "normal" | "debug";
export type {
  MinecraftVersion,
  MinecraftVersionSource,
} from "./minecraft-version.js";

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

export interface ConnectionFailure {
  error: Error;
  retryable: boolean;
}

export interface ConnectionEvents {
  authenticated: (playerName: string) => void;
  join: () => void;
  spawn: () => void;
  state: (state: Partial<BotState>) => void;
  playerJoined: (player: PlayerEvent) => void;
  playerLeft: (player: PlayerEvent) => void;
  connectionError: (failure: ConnectionFailure) => void;
  close: () => void;
}

export interface ReadonlyMinecraftConnection {
  on<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this;
  off<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this;
  disconnect(reason: string): void;
}

export interface SmokeConfig {
  host: string;
  port: number;
  version?: import("./minecraft-version.js").MinecraftVersion;
  versionSource: import("./minecraft-version.js").MinecraftVersionSource;
  configuredVersion?: import("./minecraft-version.js").MinecraftVersion;
  accountId: string;
  mode: BotMode;
  timeoutSeconds: number;
  authProfilesFolder: string;
  logLevel: "debug" | "info" | "warn" | "error";
  connectionTimeoutMs: number;
}

export type MinecraftConnectionConfig = Pick<
  SmokeConfig,
  | "host"
  | "port"
  | "version"
  | "accountId"
  | "authProfilesFolder"
  | "connectionTimeoutMs"
>;

export interface SmokeResult {
  reason: StopReason;
  exitCode: 0 | 1;
}
