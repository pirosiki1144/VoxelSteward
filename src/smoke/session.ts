import type { Logger } from "../infrastructure/logger.js";
import type {
  BotState,
  PlayerEvent,
  ReadonlyMinecraftConnection,
  SmokeConfig,
  SmokeResult,
  StopReason,
} from "./types.js";

export class SmokeSession {
  readonly #connection: ReadonlyMinecraftConnection;
  readonly #config: SmokeConfig;
  readonly #logger: Logger;
  readonly #state: BotState = {};
  readonly #players = new Map<string, string | undefined>();
  #timer?: NodeJS.Timeout;
  #stopping = false;
  #resolve?: (result: SmokeResult) => void;

  constructor(
    connection: ReadonlyMinecraftConnection,
    config: SmokeConfig,
    logger: Logger,
  ) {
    this.#connection = connection;
    this.#config = config;
    this.#logger = logger;
  }

  run(): Promise<SmokeResult> {
    this.#bindEvents();
    this.#timer = setTimeout(() => {
      this.requestStop("timeout");
    }, this.#config.timeoutSeconds * 1000);

    this.#logger.log("info", {
      event: "smoke.started",
      timeoutSeconds: this.#config.timeoutSeconds,
      versionSelection: this.#config.version ?? "auto",
    });

    return new Promise<SmokeResult>((resolve) => {
      this.#resolve = resolve;
    });
  }

  requestStop(reason: StopReason, error?: Error): void {
    if (this.#stopping) return;
    this.#stopping = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);

    const exitCode = reason === "connection_error" ? 1 : 0;
    this.#logger.log(exitCode === 0 ? "info" : "error", {
      event: "smoke.stopping",
      reason,
      error: error?.message,
    });

    try {
      this.#connection.disconnect(reason);
    } catch (disconnectError) {
      this.#logger.log("error", {
        event: "minecraft.disconnect_failed",
        error:
          disconnectError instanceof Error
            ? disconnectError.message
            : "unknown disconnect error",
      });
    } finally {
      this.#logger.log(exitCode === 0 ? "info" : "error", {
        event: "smoke.finished",
        reason,
        outcome: exitCode === 0 ? "normal" : "abnormal",
        exitCode,
      });
      this.#resolve?.({ reason, exitCode });
    }
  }

  #bindEvents(): void {
    this.#connection.on("authenticated", (playerName) => {
      this.#state.playerName = playerName;
      this.#logger.log("info", {
        event: "minecraft.authenticated",
        playerName,
      });
    });
    this.#connection.on("join", () => {
      this.#logger.log("info", { event: "minecraft.login_completed" });
    });
    this.#connection.on("spawn", () => {
      this.#logger.log("info", {
        event: "minecraft.spawn_completed",
        state: this.#printableState(),
        otherPlayers: [...this.#players.values()].filter(
          (name) => name !== this.#state.playerName,
        ),
      });
    });
    this.#connection.on("state", (state) => {
      Object.assign(this.#state, state);
      this.#logger.log("info", {
        event: "minecraft.state_received",
        state: this.#printableState(),
      });
    });
    this.#connection.on("playerJoined", (player) => {
      this.#players.set(player.id, player.name);
      if (this.#isSelf(player)) return;

      this.#logger.log(this.#config.mode === "debug" ? "debug" : "warn", {
        event: "minecraft.other_player_joined",
        playerName: player.name ?? "取得不可",
        detectedAt: player.detectedAt,
      });
      this.requestStop("other_player_detected");
    });
    this.#connection.on("playerLeft", (player) => {
      const name = player.name ?? this.#players.get(player.id);
      this.#players.delete(player.id);
      if (name === this.#state.playerName) return;
      this.#logger.log("info", {
        event: "minecraft.player_left",
        playerName: name ?? "取得不可",
        detectedAt: player.detectedAt,
      });
    });
    this.#connection.on("error", (error) => {
      this.requestStop("connection_error", error);
    });
    this.#connection.on("close", () => {
      this.requestStop("connection_closed");
    });
  }

  #isSelf(player: PlayerEvent): boolean {
    return player.name !== undefined && player.name === this.#state.playerName;
  }

  #printableState(): Record<string, unknown> {
    return {
      playerName: this.#state.playerName ?? "取得待ち",
      dimension: this.#state.dimension ?? "取得待ち",
      position: this.#state.position ?? "取得待ち",
      health: this.#state.health ?? "取得待ち",
      hunger: this.#state.hunger ?? "取得待ち",
    };
  }
}
