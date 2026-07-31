import type { MinecraftDimension } from "../../domain/movement/index.js";
import {
  WorldObservationStore,
  type ObservationClock,
  type ObservedHeldItem,
  type WorldObservationListener,
} from "../../domain/world-observation/index.js";
import type { WorldObservationPort } from "../../ports/world-observation-port.js";

export const SUPPORTED_OBSERVATION_PROTOCOL_VERSION = "1.26.30";
export const BEDROCK_1_26_30_AIR_RUNTIME_ID = 13094;

export interface BedrockObservationClient {
  on(event: string, listener: (packet?: unknown) => void): void;
  off(event: string, listener: (packet?: unknown) => void): void;
}

export interface BedrockWorldObservationPortOptions {
  readonly client: BedrockObservationClient;
  readonly version: string;
  readonly clock?: ObservationClock;
  readonly maxBlocks?: number;
  readonly onSubscriberError?: (error: unknown) => void;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const entityId = (value: unknown): string | undefined =>
  typeof value === "bigint" ||
  (typeof value === "number" && Number.isSafeInteger(value))
    ? String(value)
    : undefined;

const dimensionFrom = (value: unknown): MinecraftDimension | undefined => {
  if (value === 0 || value === "overworld") return "overworld";
  if (value === 1 || value === "nether") return "nether";
  if (value === 2 || value === "end") return "end";
  return undefined;
};

const safeInteger = (value: unknown, minimum = 0): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : undefined;

const heldItemFrom = (value: unknown): ObservedHeldItem => {
  const item = record(value);
  if (item === undefined) return Object.freeze({ status: "inconsistent" });
  const networkId = safeInteger(item.network_id);
  if (networkId === 0) return Object.freeze({ status: "empty" });
  const count = safeInteger(item.count, 1);
  const blockRuntimeId = safeInteger(item.block_runtime_id);
  if (
    networkId === undefined ||
    count === undefined ||
    blockRuntimeId === undefined
  ) {
    return Object.freeze({ status: "inconsistent" });
  }
  let stackNetworkId: number | "unsupported" = "unsupported";
  if (item.has_stack_id === true) {
    const stack = record(item.stack_id);
    const id = safeInteger(stack?.id);
    if (id === undefined) return Object.freeze({ status: "inconsistent" });
    stackNetworkId = id;
  } else if (item.has_stack_id !== false) {
    return Object.freeze({ status: "inconsistent" });
  }
  return Object.freeze({
    status: "known",
    networkId,
    count,
    blockRuntimeId,
    stackNetworkId,
  });
};

export class BedrockWorldObservationPort implements WorldObservationPort {
  readonly #client: BedrockObservationClient;
  readonly #store: WorldObservationStore;
  readonly #listeners = new Map<string, (packet?: unknown) => void>();
  #ownRuntimeId: string | undefined;
  #dimension: MinecraftDimension | undefined;
  #sequence = 0;
  #closed = false;

  constructor(options: BedrockWorldObservationPortOptions) {
    if (options.version !== SUPPORTED_OBSERVATION_PROTOCOL_VERSION) {
      throw new Error("Unsupported Bedrock observation protocol version");
    }
    this.#client = options.client;
    this.#store = new WorldObservationStore({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.maxBlocks === undefined
        ? {}
        : { maxBlocks: options.maxBlocks }),
      ...(options.onSubscriberError === undefined
        ? {}
        : { onSubscriberError: options.onSubscriberError }),
    });
    try {
      this.#bind();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  getSnapshot() {
    return this.#store.getSnapshot();
  }

  getBlock(position: Parameters<WorldObservationPort["getBlock"]>[0]) {
    return this.#store.getBlock(position);
  }

  subscribe(listener: WorldObservationListener): () => void {
    return this.#store.subscribe(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#store.getSnapshot().availability !== "disconnected") {
      this.#store.dispatch({
        type: "disconnected",
        sequence: this.#nextSequence(),
      });
    }
    this.#detachClientListeners();
    this.#store.close();
  }

  #detachClientListeners(): void {
    for (const [event, listener] of this.#listeners) {
      try {
        this.#client.off(event, listener);
      } catch {
        // Continue cleanup of the remaining read-only listeners.
      }
    }
    this.#listeners.clear();
  }

  #listen(event: string, listener: (packet?: unknown) => void): void {
    this.#listeners.set(event, listener);
    this.#client.on(event, listener);
  }

  #nextSequence(): number {
    this.#sequence += 1;
    return this.#sequence;
  }

  #bind(): void {
    this.#listen("start_game", (raw) => {
      const packet = record(raw);
      const dimension = dimensionFrom(packet?.dimension);
      const ownRuntimeId = entityId(packet?.runtime_entity_id);
      if (dimension === undefined || ownRuntimeId === undefined) return;
      this.#dimension = dimension;
      this.#ownRuntimeId = ownRuntimeId;
      this.#store.dispatch({
        type: "connection_started",
        sequence: this.#nextSequence(),
        dimension,
      });
    });
    this.#listen("spawn", () => {
      if (
        this.#dimension === undefined ||
        this.#store.getSnapshot().availability !== "pre_spawn"
      )
        return;
      this.#store.dispatch({
        type: "spawn_completed",
        sequence: this.#nextSequence(),
        dimension: this.#dimension,
      });
    });
    this.#listen("change_dimension", (raw) => {
      const dimension = dimensionFrom(record(raw)?.dimension);
      this.#dimension = dimension;
      this.#store.dispatch({
        type: "dimension_changing",
        sequence: this.#nextSequence(),
        ...(dimension === undefined ? {} : { dimension }),
      });
    });
    this.#listen("update_block", (raw) => {
      const packet = record(raw);
      const position = record(packet?.position);
      const runtimeId = safeInteger(packet?.block_runtime_id);
      const layer = safeInteger(packet?.layer);
      const x = safeInteger(position?.x, Number.MIN_SAFE_INTEGER);
      const y = safeInteger(position?.y, Number.MIN_SAFE_INTEGER);
      const z = safeInteger(position?.z, Number.MIN_SAFE_INTEGER);
      if (
        this.#dimension === undefined ||
        runtimeId === undefined ||
        layer !== 0 ||
        x === undefined ||
        y === undefined ||
        z === undefined
      ) {
        return;
      }
      try {
        this.#store.dispatch({
          type: "block_observed",
          sequence: this.#nextSequence(),
          position: { x, y, z, dimension: this.#dimension },
          runtimeId,
          air: runtimeId === BEDROCK_1_26_30_AIR_RUNTIME_ID,
        });
      } catch {
        // Packets received outside a spawned session are not observations.
      }
    });
    this.#listen("mob_equipment", (raw) => {
      const packet = record(raw);
      if (entityId(packet?.runtime_entity_id) !== this.#ownRuntimeId) return;
      const selectedSlot = safeInteger(packet?.selected_slot);
      if (selectedSlot === undefined) return;
      try {
        this.#store.dispatch({
          type: "held_item_observed",
          sequence: this.#nextSequence(),
          selectedSlot,
          heldItem: heldItemFrom(packet?.item),
        });
      } catch {
        // Pre-spawn and dimension-transition equipment is fail-closed.
      }
    });
    this.#listen("close", () => {
      if (this.#closed) return;
      this.#ownRuntimeId = undefined;
      this.#dimension = undefined;
      try {
        this.#store.dispatch({
          type: "disconnected",
          sequence: this.#nextSequence(),
        });
      } catch {
        // An idempotently closed observation port needs no further transition.
      }
      // Keep the store alive long enough for the queued disconnected event.
      // Runtime cleanup will close subscriptions explicitly.
      this.#detachClientListeners();
    });
  }
}
