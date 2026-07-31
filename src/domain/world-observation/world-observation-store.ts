import { WorldObservationError } from "./errors.js";
import type {
  ObservationClock,
  ObservationSubscriberErrorReporter,
  ObservedBlock,
  ObservedBlockPosition,
  ObservedHeldItem,
  WorldObservationCommand,
  WorldObservationEvent,
  WorldObservationListener,
  WorldObservationSnapshot,
} from "./types.js";

const systemClock: ObservationClock = { now: () => new Date() };

const freeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

const positionKey = (position: ObservedBlockPosition): string =>
  `${position.dimension}:${position.x}:${position.y}:${position.z}`;

const validSequence = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const validPosition = (position: ObservedBlockPosition): boolean =>
  [position.x, position.y, position.z].every(
    (value) => Number.isSafeInteger(value) && Number.isFinite(value),
  );

const validDimension = (value: unknown): boolean =>
  value === "overworld" || value === "nether" || value === "end";

const projectHeldItem = (value: ObservedHeldItem): ObservedHeldItem => {
  if (value.status === "unknown") return freeze({ status: "unknown" });
  if (value.status === "empty") return freeze({ status: "empty" });
  if (value.status === "inconsistent") {
    return freeze({ status: "inconsistent" });
  }
  if (
    !Number.isSafeInteger(value.networkId) ||
    value.networkId <= 0 ||
    !Number.isSafeInteger(value.count) ||
    value.count <= 0 ||
    !Number.isSafeInteger(value.blockRuntimeId) ||
    value.blockRuntimeId < 0 ||
    (value.stackNetworkId !== "unsupported" &&
      (!Number.isSafeInteger(value.stackNetworkId) || value.stackNetworkId < 0))
  ) {
    throw new WorldObservationError("INVALID_OBSERVATION");
  }
  return freeze({
    status: "known",
    networkId: value.networkId,
    count: value.count,
    blockRuntimeId: value.blockRuntimeId,
    stackNetworkId: value.stackNetworkId,
  });
};

interface Subscription {
  active: boolean;
  readonly listener: WorldObservationListener;
}

export interface WorldObservationStoreOptions {
  readonly clock?: ObservationClock;
  readonly maxBlocks?: number;
  readonly onSubscriberError?: ObservationSubscriberErrorReporter;
}

export class WorldObservationStore {
  readonly #clock: ObservationClock;
  readonly #maxBlocks: number;
  readonly #onSubscriberError: ObservationSubscriberErrorReporter;
  readonly #subscriptions = new Set<Subscription>();
  #closed = false;
  #lastAcceptedSequence = -1;
  #snapshot: WorldObservationSnapshot;

  constructor(options: WorldObservationStoreOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#maxBlocks = options.maxBlocks ?? 128;
    if (!Number.isInteger(this.#maxBlocks) || this.#maxBlocks < 1) {
      throw new WorldObservationError("INVALID_OBSERVATION");
    }
    this.#onSubscriberError = options.onSubscriberError ?? (() => undefined);
    const updatedAt = this.#utcNow();
    this.#snapshot = freeze({
      revision: 0,
      updatedAt,
      lastSequence: -1,
      availability: "disconnected",
      inventory: {
        selectedSlot: "unknown",
        heldItem: { status: "unknown" },
        fullInventory: "unsupported",
      },
      blocks: [],
    });
  }

  getSnapshot(): WorldObservationSnapshot {
    return this.#snapshot;
  }

  getBlock(position: ObservedBlockPosition): ObservedBlock | undefined {
    if (
      this.#closed ||
      this.#snapshot.availability !== "ready" ||
      this.#snapshot.dimension !== position.dimension
    ) {
      return undefined;
    }
    return this.#snapshot.blocks.find(
      (block) => positionKey(block.position) === positionKey(position),
    );
  }

  dispatch(
    command: WorldObservationCommand,
  ): WorldObservationEvent | undefined {
    if (this.#closed) throw new WorldObservationError("OBSERVATION_CLOSED");
    if (!validSequence(command.sequence)) {
      throw new WorldObservationError("INVALID_OBSERVATION");
    }
    if (command.sequence <= this.#lastAcceptedSequence) return undefined;
    const before = this.#snapshot;
    const occurredAt = this.#utcNow();
    let next: Omit<WorldObservationSnapshot, "revision" | "updatedAt">;
    switch (command.type) {
      case "connection_started":
        if (!validDimension(command.dimension)) {
          throw new WorldObservationError("INVALID_OBSERVATION");
        }
        next = {
          lastSequence: command.sequence,
          availability: "pre_spawn",
          dimension: command.dimension,
          inventory: this.#emptyInventory(),
          blocks: [],
        };
        break;
      case "spawn_completed":
        if (
          before.availability !== "pre_spawn" ||
          !validDimension(command.dimension)
        ) {
          throw new WorldObservationError("OBSERVATION_UNAVAILABLE");
        }
        next = {
          lastSequence: command.sequence,
          availability: "ready",
          dimension: command.dimension,
          inventory:
            before.dimension === command.dimension
              ? before.inventory
              : this.#emptyInventory(),
          blocks: before.dimension === command.dimension ? before.blocks : [],
        };
        break;
      case "dimension_changing":
        if (
          command.dimension !== undefined &&
          !validDimension(command.dimension)
        ) {
          throw new WorldObservationError("INVALID_OBSERVATION");
        }
        next = {
          lastSequence: command.sequence,
          availability: "dimension_transition",
          ...(command.dimension === undefined
            ? {}
            : { dimension: command.dimension }),
          inventory: this.#emptyInventory(),
          blocks: [],
        };
        break;
      case "disconnected":
        next = {
          lastSequence: command.sequence,
          availability: "disconnected",
          inventory: this.#emptyInventory(),
          blocks: [],
        };
        break;
      case "held_item_observed": {
        this.#assertReady();
        if (
          !Number.isInteger(command.selectedSlot) ||
          command.selectedSlot < 0 ||
          command.selectedSlot > 8
        ) {
          throw new WorldObservationError("INVALID_OBSERVATION");
        }
        const inventory = freeze({
          selectedSlot: command.selectedSlot,
          heldItem: projectHeldItem(command.heldItem),
          fullInventory: "unsupported" as const,
        });
        const unchanged =
          JSON.stringify(before.inventory) === JSON.stringify(inventory);
        if (unchanged) {
          this.#lastAcceptedSequence = command.sequence;
          return undefined;
        }
        next = { ...before, lastSequence: command.sequence, inventory };
        break;
      }
      case "block_observed": {
        this.#assertReady();
        if (
          !validPosition(command.position) ||
          command.position.dimension !== before.dimension ||
          !Number.isSafeInteger(command.runtimeId) ||
          command.runtimeId < 0 ||
          (command.air !== true &&
            command.air !== false &&
            command.air !== "unknown")
        ) {
          throw new WorldObservationError("INVALID_OBSERVATION");
        }
        const block = freeze({
          position: { ...command.position },
          runtimeId: command.runtimeId,
          air: command.air,
          observedAt: occurredAt,
          source: "server_update_block" as const,
        });
        const key = positionKey(command.position);
        const old = before.blocks.find(
          (candidate) => positionKey(candidate.position) === key,
        );
        if (old?.runtimeId === block.runtimeId && old.air === block.air) {
          this.#lastAcceptedSequence = command.sequence;
          return undefined;
        }
        const blocks = before.blocks.filter(
          (candidate) => positionKey(candidate.position) !== key,
        );
        blocks.push(block);
        if (blocks.length > this.#maxBlocks) blocks.shift();
        next = { ...before, lastSequence: command.sequence, blocks };
        break;
      }
    }
    this.#lastAcceptedSequence = command.sequence;
    const after = freeze({
      ...next,
      revision: before.revision + 1,
      updatedAt: occurredAt,
    });
    const event = freeze({
      revision: after.revision,
      occurredAt,
      cause: command.type,
      before,
      after,
    } satisfies WorldObservationEvent);
    this.#snapshot = after;
    this.#notify(event);
    return event;
  }

  subscribe(listener: WorldObservationListener): () => void {
    if (this.#closed) throw new WorldObservationError("OBSERVATION_CLOSED");
    const subscription: Subscription = { active: true, listener };
    this.#subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.#subscriptions.delete(subscription);
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const subscription of this.#subscriptions) subscription.active = false;
    this.#subscriptions.clear();
  }

  #emptyInventory() {
    return freeze({
      selectedSlot: "unknown" as const,
      heldItem: { status: "unknown" as const },
      fullInventory: "unsupported" as const,
    });
  }

  #assertReady(): void {
    if (this.#snapshot.availability !== "ready") {
      throw new WorldObservationError("OBSERVATION_UNAVAILABLE");
    }
  }

  #utcNow(): string {
    const now = this.#clock.now();
    if (Number.isNaN(now.getTime())) {
      throw new WorldObservationError("INVALID_OBSERVATION");
    }
    return now.toISOString();
  }

  #notify(event: WorldObservationEvent): void {
    for (const subscription of [...this.#subscriptions]) {
      queueMicrotask(() => {
        if (!subscription.active || this.#closed) return;
        try {
          Promise.resolve(subscription.listener(event)).catch(
            (error: unknown) => this.#reportSubscriberError(error),
          );
        } catch (error) {
          this.#reportSubscriberError(error);
        }
      });
    }
  }

  #reportSubscriberError(error: unknown): void {
    try {
      this.#onSubscriberError(error);
    } catch {
      // Observation reporting must never affect connection safety.
    }
  }
}
