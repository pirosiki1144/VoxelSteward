import type { Logger } from "../infrastructure/logger.js";
import { PlayerDetectionPolicy } from "../domain/player-detection-policy.js";
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
  readonly #playerPolicy: PlayerDetectionPolicy;
  readonly #state: BotState = {};
  readonly #players = new Map<string, PlayerEvent>();
  readonly #removeListeners: (() => void)[] = [];
  #timer: NodeJS.Timeout | undefined;
  #spawned = false;
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
    this.#playerPolicy = new PlayerDetectionPolicy(config.mode);
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
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#unbindEvents();

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
    this.#bind("authenticated", (playerName) => {
      this.#state.playerName = playerName;
      this.#logger.log("info", {
        event: "minecraft.authenticated",
        playerName,
      });
    });
    this.#bind("join", () => {
      this.#logger.log("info", { event: "minecraft.login_completed" });
    });
    this.#bind("spawn", () => {
      this.#spawned = true;
      this.#logger.log("info", {
        event: "minecraft.spawn_completed",
        state: this.#printableState(),
        otherPlayers: [...this.#players.values()]
          .map((player) => player.name)
          .filter((name) => name !== this.#state.playerName),
      });
      for (const player of this.#players.values()) {
        this.#handleOtherPlayer(player);
        if (this.#stopping) break;
      }
    });
    this.#bind("state", (state) => {
      Object.assign(this.#state, state);
      this.#logger.log("info", {
        event: "minecraft.state_received",
        state: this.#printableState(),
      });
    });
    this.#bind("playerJoined", (player) => {
      if (this.#players.has(player.id)) return;
      this.#players.set(player.id, player);
      if (this.#spawned) this.#handleOtherPlayer(player);
    });
    this.#bind("playerLeft", (player) => {
      const name = player.name ?? this.#players.get(player.id)?.name;
      this.#players.delete(player.id);
      if (name === this.#state.playerName) return;
      this.#logger.log("info", {
        event: "minecraft.other_player_left",
        playerName: name ?? "取得不可",
        detectedAt: player.detectedAt,
      });
    });
    this.#bind("connectionError", (failure) => {
      this.requestStop("connection_error", failure.error);
    });
    this.#bind("close", () => {
      this.requestStop("connection_closed");
    });
  }

  #bind<EventName extends keyof import("./types.js").ConnectionEvents>(
    event: EventName,
    listener: import("./types.js").ConnectionEvents[EventName],
  ): void {
    this.#connection.on(event, listener);
    this.#removeListeners.push(() => this.#connection.off(event, listener));
  }

  #unbindEvents(): void {
    for (const remove of this.#removeListeners.splice(0)) remove();
  }

  #handleOtherPlayer(player: PlayerEvent): void {
    const decision = this.#playerPolicy.decide(player, this.#state.playerName);
    if (decision === "ignore_self") return;

    this.#logger.log(decision === "stop" ? "warn" : "info", {
      event: "minecraft.other_player_joined",
      playerName: player.name ?? "取得不可",
      detectedAt: player.detectedAt,
    });
    if (decision === "continue") {
      this.#logger.log("info", {
        event: "minecraft.other_player_allowed",
        playerName: player.name ?? "取得不可",
        action: "connection_continued",
      });
      return;
    }
    this.requestStop("other_player_detected");
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
