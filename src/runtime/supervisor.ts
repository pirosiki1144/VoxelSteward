import { PlayerDetectionPolicy } from "../domain/player-detection-policy.js";
import {
  createStateStore,
  type SanitizedErrorCode,
  type StateCommand,
  type StateSnapshot,
  type StateStore,
} from "../domain/state/index.js";
import type { Logger } from "../infrastructure/logger.js";
import type {
  ConnectionEvents,
  PlayerEvent,
  ReadonlyMinecraftConnection,
} from "../smoke/types.js";
import type {
  ConnectionFactory,
  RuntimeConfig,
  RuntimeResult,
  RuntimeStopReason,
  Wait,
} from "./types.js";

const defaultWait: Wait = (delayMs, signal) =>
  new Promise<void>((resolve) => {
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

type AttemptOutcome =
  | { kind: "stopped" }
  | { kind: "retryable"; error?: Error }
  | { kind: "fatal"; error: Error };

export class RuntimeSupervisor {
  readonly #config: RuntimeConfig;
  readonly #createConnection: ConnectionFactory;
  readonly #logger: Logger;
  readonly #wait: Wait;
  readonly #stateStore: StateStore;
  readonly #policy = new PlayerDetectionPolicy("normal");
  readonly #abortController = new AbortController();
  #connection: ReadonlyMinecraftConnection | undefined;
  #stopCurrentAttempt: (() => void) | undefined;
  #stopReason?: RuntimeStopReason;
  #finished = false;
  #stoppingLogged = false;

  constructor(
    config: RuntimeConfig,
    createConnection: ConnectionFactory,
    logger: Logger,
    wait: Wait = defaultWait,
    stateStore: StateStore = createStateStore(),
  ) {
    this.#config = config;
    this.#createConnection = createConnection;
    this.#logger = logger;
    this.#wait = wait;
    this.#stateStore = stateStore;
  }

  getStateSnapshot(): StateSnapshot {
    return this.#stateStore.getSnapshot();
  }

  async run(): Promise<RuntimeResult> {
    this.#logger.log("info", {
      event: "runtime.starting",
      maxAttempts: this.#config.maxRetries + 1,
    });

    let retry = 0;
    try {
      while (this.#stopReason === undefined) {
        const attempt = retry + 1;
        this.#logger.log(retry === 0 ? "info" : "warn", {
          event: "minecraft.connecting",
          attempt,
          maxAttempts: this.#config.maxRetries + 1,
        });
        if (retry > 0) {
          this.#logger.log("warn", {
            event: "reconnect.attempt_started",
            attempt,
            maxAttempts: this.#config.maxRetries + 1,
          });
        }
        this.#dispatchState({
          type: "runtime.transition",
          to: "connecting",
        });
        this.#dispatchState({
          type: "minecraft.connection.transition",
          to: "connecting",
        });
        const outcome = await this.#runAttempt();
        if (outcome.kind === "stopped") break;
        this.#markMinecraftDisconnected();
        if (outcome.kind === "fatal") {
          this.#logger.log("error", {
            event: "runtime.error",
            reason: "connection_error",
            error: outcome.error.message,
          });
          this.#stopReason = "connection_error";
          this.#recordFailure(
            "connection_error",
            "Minecraft connection failed",
          );
          break;
        }
        if (retry >= this.#config.maxRetries) {
          this.#logger.log("error", {
            event: "reconnect.exhausted",
            attempt,
            maxAttempts: this.#config.maxRetries + 1,
          });
          this.#stopReason = "reconnect_exhausted";
          this.#recordFailure(
            "reconnect_exhausted",
            "Reconnect attempts exhausted",
          );
          break;
        }
        const delayMs = Math.min(
          this.#config.reconnectInitialDelayMs * 2 ** retry,
          this.#config.reconnectMaxDelayMs,
        );
        retry += 1;
        this.#logger.log("warn", {
          event: "reconnect.scheduled",
          attempt: retry + 1,
          maxAttempts: this.#config.maxRetries + 1,
          delayMs,
        });
        this.#dispatchState({
          type: "runtime.transition",
          to: "reconnecting",
        });
        await this.#wait(delayMs, this.#abortController.signal);
      }
    } catch (error) {
      this.#logger.log("error", {
        event: "runtime.error",
        reason: "internal_error",
        error: error instanceof Error ? error.message : "unknown runtime error",
      });
      this.#stopReason = "internal_error";
      this.#recordFailure("internal_error", "Unexpected runtime error");
    } finally {
      this.#logStopping(this.#stopReason ?? "internal_error");
      this.#disconnect(this.#stopReason ?? "internal_error");
      this.#markMinecraftDisconnected();
    }

    return this.#finish(this.#stopReason ?? "internal_error");
  }

  requestStop(
    reason: Extract<
      RuntimeStopReason,
      "signal_sigint" | "signal_sigterm" | "stop_requested"
    >,
  ): void {
    if (this.#stopReason !== undefined) return;
    this.#stopReason = reason;
    this.#dispatchState({
      type: "runtime.stop_reason.record",
      reason,
    });
    this.#dispatchState({ type: "runtime.transition", to: "stopping" });
    this.#logStopping(reason);
    this.#abortController.abort();
    this.#stopCurrentAttempt?.();
    this.#disconnect(reason);
  }

  async #runAttempt(): Promise<AttemptOutcome> {
    let connection: ReadonlyMinecraftConnection;
    try {
      connection = this.#createConnection();
    } catch (error) {
      return {
        kind: "fatal",
        error:
          error instanceof Error
            ? error
            : new Error("connection creation failed"),
      };
    }
    this.#connection = connection;

    return new Promise<AttemptOutcome>((resolve) => {
      const players = new Map<string, PlayerEvent>();
      const removeListeners: (() => void)[] = [];
      let playerName: string | undefined;
      let spawned = false;
      let settled = false;
      let disconnectRequested = false;

      const cleanup = (): void => {
        clearTimeout(connectTimer);
        for (const remove of removeListeners.splice(0)) remove();
        if (this.#connection === connection) this.#connection = undefined;
        if (this.#stopCurrentAttempt !== undefined) {
          this.#stopCurrentAttempt = undefined;
        }
      };
      const settle = (outcome: AttemptOutcome, reason: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!disconnectRequested) {
          disconnectRequested = true;
          connection.disconnect(reason);
        }
        resolve(outcome);
      };
      const bind = <EventName extends keyof ConnectionEvents>(
        event: EventName,
        listener: ConnectionEvents[EventName],
      ): void => {
        connection.on(event, listener);
        removeListeners.push(() => connection.off(event, listener));
      };
      const detect = (player: PlayerEvent): void => {
        if (this.#policy.decide(player, playerName) === "ignore_self") return;
        this.#logger.log("warn", {
          event: "minecraft.other_player_detected",
          playerName: player.name ?? "取得不可",
          detectedAt: player.detectedAt,
        });
        this.#stopReason = "other_player_detected";
        this.#dispatchState({ type: "safety.other_player_detected" });
        this.#logStopping(this.#stopReason);
        settle({ kind: "stopped" }, this.#stopReason);
      };

      const connectTimer = setTimeout(() => {
        settle(
          { kind: "retryable", error: new Error("connection timed out") },
          "connection_timeout",
        );
      }, this.#config.connectionTimeoutMs);
      this.#stopCurrentAttempt = () => {
        settle({ kind: "stopped" }, this.#stopReason ?? "stop_requested");
      };

      bind("authenticated", (name) => {
        playerName = name;
      });
      bind("join", () => {
        this.#logger.log("info", { event: "minecraft.connected" });
        this.#dispatchState({
          type: "minecraft.connection.transition",
          to: "connected",
        });
      });
      bind("spawn", () => {
        spawned = true;
        clearTimeout(connectTimer);
        this.#logger.log("info", { event: "minecraft.spawn_completed" });
        this.#dispatchState({
          type: "minecraft.spawn.update",
          completed: true,
        });
        this.#dispatchState({ type: "runtime.transition", to: "ready" });
        this.#logger.log("info", { event: "runtime.started" });
        for (const player of players.values()) {
          detect(player);
          if (settled) break;
        }
      });
      bind("state", (state) => {
        const { position, health, hunger } = state;
        if (
          position === undefined &&
          health === undefined &&
          hunger === undefined
        ) {
          return;
        }
        const updated = this.#dispatchState({
          type: "minecraft.telemetry.update",
          telemetry: {
            ...(position === undefined ? {} : { position }),
            ...(health === undefined ? {} : { health }),
            ...(hunger === undefined ? {} : { hunger }),
          },
        });
        if (!updated) {
          this.#dispatchState({ type: "minecraft.telemetry.invalidate" });
        }
      });
      bind("playerJoined", (player) => {
        if (players.has(player.id)) return;
        players.set(player.id, player);
        if (spawned) detect(player);
      });
      bind("playerLeft", (player) => {
        players.delete(player.id);
      });
      bind("connectionError", (failure) => {
        settle(
          failure.retryable
            ? { kind: "retryable", error: failure.error }
            : { kind: "fatal", error: failure.error },
          "connection_error",
        );
      });
      bind("close", () => {
        if (this.#stopReason !== undefined) {
          settle({ kind: "stopped" }, this.#stopReason);
          return;
        }
        settle({ kind: "retryable" }, "connection_closed");
      });
    });
  }

  #disconnect(reason: string): void {
    const connection = this.#connection;
    this.#connection = undefined;
    connection?.disconnect(reason);
  }

  #finish(reason: RuntimeStopReason): RuntimeResult {
    if (this.#finished) {
      return { reason, exitCode: this.#exitCode(reason) };
    }
    this.#finished = true;
    const exitCode = this.#exitCode(reason);
    if (exitCode === 0) {
      this.#dispatchState({ type: "runtime.transition", to: "stopped" });
    } else if (this.#stateStore.getSnapshot().runtime !== "failed") {
      this.#dispatchState({ type: "runtime.transition", to: "failed" });
    }
    this.#logger.log(exitCode === 0 ? "info" : "error", {
      event: "runtime.finished",
      reason,
      outcome: exitCode === 0 ? "normal" : "abnormal",
      exitCode,
    });
    return { reason, exitCode };
  }

  #logStopping(reason: RuntimeStopReason): void {
    if (this.#stoppingLogged) return;
    this.#stoppingLogged = true;
    this.#logger.log("info", { event: "runtime.stopping", reason });
  }

  #exitCode(reason: RuntimeStopReason): 0 | 1 {
    return reason === "other_player_detected" ||
      reason === "signal_sigint" ||
      reason === "signal_sigterm" ||
      reason === "stop_requested"
      ? 0
      : 1;
  }

  #markMinecraftDisconnected(): void {
    if (
      this.#stateStore.getSnapshot().minecraft.connection === "disconnected"
    ) {
      return;
    }
    this.#dispatchState({
      type: "minecraft.connection.transition",
      to: "disconnected",
    });
  }

  #recordFailure(code: SanitizedErrorCode, message: string): void {
    this.#dispatchState({
      type: "runtime.stop_reason.record",
      reason: this.#stopReason ?? code,
    });
    this.#dispatchState({
      type: "runtime.error.record",
      error: { code, message },
    });
    this.#dispatchState({ type: "runtime.transition", to: "failed" });
  }

  #dispatchState(command: StateCommand): boolean {
    try {
      this.#stateStore.dispatch(command);
      return true;
    } catch {
      this.#logger.log("error", {
        event: "runtime.state_update_failed",
        command: command.type,
      });
      return false;
    }
  }
}
