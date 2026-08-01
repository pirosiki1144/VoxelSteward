import { MovementError } from "../../domain/movement/index.js";
import type {
  MinecraftDimension,
  MovementPosition,
  MovementStep,
} from "../../domain/movement/index.js";
import type { MovementPort } from "../../ports/movement-port.js";
import {
  assertSupportedMovementProtocolVersion,
  createPlayerAuthInputFrame,
  type PlayerAuthInputFrameDraft,
  type PlayerAuthInputPayload,
} from "./player-auth-input-frame.js";
import { BedrockAuthoritativeFrameOwnership } from "./bedrock-authoritative-frame-ownership.js";

export type BedrockMovementObservation =
  | { readonly kind: "position"; readonly position: MovementPosition }
  | {
      readonly kind: "correction";
      readonly tick: bigint;
      readonly position: MovementPosition;
    };

export interface BedrockMovementTransport {
  readonly version: string;
  queuePlayerAuthInput(payload: PlayerAuthInputPayload): void;
  subscribeObservation(
    listener: (observation: BedrockMovementObservation) => void,
  ): () => void;
  subscribeDisconnect(listener: () => void): () => void;
}

export interface BedrockMovementClient {
  queue(name: string, params: object): void;
  on(event: string, listener: (packet?: unknown) => void): void;
  off(event: string, listener: (packet?: unknown) => void): void;
}

export interface BedrockClientMovementTransportOptions {
  readonly client: BedrockMovementClient;
  readonly version: string;
  readonly getOwnRuntimeId: () => string | undefined;
  readonly getDimension: () => MinecraftDimension | undefined;
}

export type MovementFrameProvider = (
  step: MovementStep,
) => PlayerAuthInputFrameDraft;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;

const entityId = (value: unknown): string | undefined =>
  typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : undefined;

const tickFrom = (value: unknown): bigint | undefined => {
  if (typeof value === "bigint") return value >= 0n ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return undefined;
};

const positionFrom = (
  value: unknown,
  dimension: MinecraftDimension | undefined,
): MovementPosition | undefined => {
  const item = record(value);
  if (
    item === undefined ||
    dimension === undefined ||
    typeof item.x !== "number" ||
    typeof item.y !== "number" ||
    typeof item.z !== "number" ||
    !Number.isFinite(item.x) ||
    !Number.isFinite(item.y) ||
    !Number.isFinite(item.z)
  ) {
    return undefined;
  }
  return Object.freeze({ x: item.x, y: item.y, z: item.z, dimension });
};

export class BedrockClientMovementTransport implements BedrockMovementTransport {
  readonly version: string;
  readonly #options: BedrockClientMovementTransportOptions;

  constructor(options: BedrockClientMovementTransportOptions) {
    this.version = assertSupportedMovementProtocolVersion(options.version);
    this.#options = options;
  }

  queuePlayerAuthInput(payload: PlayerAuthInputPayload): void {
    this.#options.client.queue("player_auth_input", payload);
  }

  subscribeObservation(
    listener: (observation: BedrockMovementObservation) => void,
  ): () => void {
    const onMove = (raw?: unknown): void => {
      const packet = record(raw);
      const ownRuntimeId = this.#options.getOwnRuntimeId();
      if (
        packet === undefined ||
        ownRuntimeId === undefined ||
        entityId(packet.runtime_id) !== ownRuntimeId
      ) {
        return;
      }
      const position = positionFrom(
        packet.position,
        this.#options.getDimension(),
      );
      if (position !== undefined) {
        listener({ kind: "position", position });
      }
    };
    const onCorrection = (raw?: unknown): void => {
      const packet = record(raw);
      if (packet === undefined || packet.prediction_type !== "player") return;
      const tick = tickFrom(packet.tick);
      const position = positionFrom(
        packet.position,
        this.#options.getDimension(),
      );
      if (tick !== undefined && position !== undefined) {
        listener({ kind: "correction", tick, position });
      }
    };
    let moveRegistered = false;
    let correctionRegistered = false;
    try {
      this.#options.client.on("move_player", onMove);
      moveRegistered = true;
      this.#options.client.on("correct_player_move_prediction", onCorrection);
      correctionRegistered = true;
    } catch {
      if (correctionRegistered) {
        try {
          this.#options.client.off(
            "correct_player_move_prediction",
            onCorrection,
          );
        } catch {
          // Best-effort cleanup continues with the other registration.
        }
      }
      if (moveRegistered) {
        try {
          this.#options.client.off("move_player", onMove);
        } catch {
          // Registration failure remains finite even if cleanup also fails.
        }
      }
      throw new MovementError("MOVEMENT_DISCONNECTED");
    }
    return () => {
      try {
        this.#options.client.off("move_player", onMove);
      } catch {
        // Cleanup of one listener must not prevent cleanup of the other.
      }
      try {
        this.#options.client.off(
          "correct_player_move_prediction",
          onCorrection,
        );
      } catch {
        // Cleanup is best effort; no error crosses the MovementPort boundary.
      }
    };
  }

  subscribeDisconnect(listener: () => void): () => void {
    const onClose = (): void => listener();
    this.#options.client.on("close", onClose);
    return () => this.#options.client.off("close", onClose);
  }
}

const validDimension = (value: string): value is MinecraftDimension =>
  value === "overworld" || value === "nether" || value === "end";

const validateObservation = (
  observation: BedrockMovementObservation,
): MovementPosition => {
  const { position } = observation;
  if (
    (observation.kind === "correction" && observation.tick < 0n) ||
    !validDimension(position.dimension) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z)
  ) {
    throw new MovementError("MOVEMENT_OBSERVATION_INVALID");
  }
  return Object.freeze({ ...position });
};

export class BedrockMovementPort implements MovementPort {
  readonly #transport: BedrockMovementTransport;
  readonly #frameProvider: MovementFrameProvider;
  readonly #frameOwnership: BedrockAuthoritativeFrameOwnership;
  #lastSentTick: bigint | undefined;
  #active: AbortController | undefined;
  #closed = false;

  constructor(
    transport: BedrockMovementTransport,
    frameProvider: MovementFrameProvider,
    frameOwnership = new BedrockAuthoritativeFrameOwnership(),
  ) {
    assertSupportedMovementProtocolVersion(transport.version);
    this.#transport = transport;
    this.#frameProvider = frameProvider;
    this.#frameOwnership = frameOwnership;
  }

  async move(
    step: MovementStep,
    signal: AbortSignal,
  ): Promise<MovementPosition> {
    if (this.#closed) throw new MovementError("MOVEMENT_ADAPTER_CLOSED");
    if (this.#active !== undefined) {
      throw new MovementError("MOVEMENT_ALREADY_ACTIVE");
    }
    if (signal.aborted) throw new MovementError("MOVEMENT_ADAPTER_CLOSED");

    const payload = createPlayerAuthInputFrame(
      this.#transport.version,
      this.#frameProvider(step),
    );
    if (
      this.#lastSentTick !== undefined &&
      payload.tick <= this.#lastSentTick
    ) {
      throw new MovementError("INVALID_MOVEMENT_FRAME");
    }
    let frameLease;
    try {
      frameLease = this.#frameOwnership.acquireMovement(payload.tick);
    } catch {
      throw new MovementError("INVALID_MOVEMENT_FRAME");
    }

    const controller = new AbortController();
    this.#active = controller;
    const abort = (): void => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await new Promise<MovementPosition>((resolve, reject) => {
        let settled = false;
        let sent = false;
        let unsubscribeObservation = (): void => undefined;
        let unsubscribeDisconnect = (): void => undefined;
        const finish = (
          outcome:
            | { readonly position: MovementPosition }
            | { readonly error: MovementError },
        ): void => {
          if (settled) return;
          settled = true;
          controller.signal.removeEventListener("abort", onAbort);
          try {
            unsubscribeObservation();
          } catch {
            // Continue cleanup and settle the movement promise.
          }
          try {
            unsubscribeDisconnect();
          } catch {
            // Continue settling with the original outcome.
          }
          if ("position" in outcome) resolve(outcome.position);
          else reject(outcome.error);
        };
        const onAbort = (): void =>
          finish({ error: new MovementError("MOVEMENT_ADAPTER_CLOSED") });
        try {
          unsubscribeObservation = this.#transport.subscribeObservation(
            (observation) => {
              if (!sent) return;
              if (observation.kind === "correction") {
                if (observation.tick < payload.tick) return;
                finish({
                  error: new MovementError("MOVEMENT_CORRECTED"),
                });
                return;
              }
              try {
                const position = validateObservation(observation);
                if (position.dimension !== step.target.dimension) {
                  finish({
                    error: new MovementError("MOVEMENT_OBSERVATION_INVALID"),
                  });
                  return;
                }
                finish({ position });
              } catch {
                finish({
                  error: new MovementError("MOVEMENT_OBSERVATION_INVALID"),
                });
              }
            },
          );
          unsubscribeDisconnect = this.#transport.subscribeDisconnect(() =>
            finish({ error: new MovementError("MOVEMENT_DISCONNECTED") }),
          );
          controller.signal.addEventListener("abort", onAbort, { once: true });
          if (controller.signal.aborted || this.#closed) {
            onAbort();
            return;
          }
          sent = true;
          // Consume the tick before crossing the synchronous transport boundary.
          // If queue throws or re-enters stop(), this frame must never be reused.
          frameLease.commit();
          this.#lastSentTick = payload.tick;
          this.#transport.queuePlayerAuthInput(payload);
        } catch {
          frameLease.release();
          finish({ error: new MovementError("MOVEMENT_DISCONNECTED") });
        }
      });
    } finally {
      signal.removeEventListener("abort", abort);
      controller.abort();
      frameLease.release();
      if (this.#active === controller) this.#active = undefined;
    }
  }

  stop(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#active?.abort();
    this.#frameOwnership.close();
  }
}
