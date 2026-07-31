import type { MinecraftDimension } from "../movement/index.js";

export type ObservationAvailability =
  "disconnected" | "pre_spawn" | "ready" | "dimension_transition";

export interface ObservedBlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dimension: MinecraftDimension;
}

export interface ObservedBlock {
  readonly position: ObservedBlockPosition;
  readonly runtimeId: number;
  readonly air: boolean | "unknown";
  readonly observedAt: string;
  readonly source: "server_update_block";
}

export type ObservedHeldItem =
  | { readonly status: "unknown" }
  | { readonly status: "empty" }
  | {
      readonly status: "known";
      readonly networkId: number;
      readonly count: number;
      readonly blockRuntimeId: number;
      readonly stackNetworkId: number | "unsupported";
    }
  | { readonly status: "inconsistent" };

export interface InventoryObservation {
  readonly selectedSlot: number | "unknown";
  readonly heldItem: ObservedHeldItem;
  readonly fullInventory: "unsupported";
}

export interface WorldObservationSnapshot {
  readonly revision: number;
  readonly updatedAt: string;
  readonly lastSequence: number;
  readonly availability: ObservationAvailability;
  readonly dimension?: MinecraftDimension;
  readonly inventory: InventoryObservation;
  readonly blocks: readonly ObservedBlock[];
}

export type WorldObservationCause =
  | "connection_started"
  | "spawn_completed"
  | "dimension_changing"
  | "held_item_observed"
  | "block_observed"
  | "disconnected";

export interface WorldObservationEvent {
  readonly revision: number;
  readonly occurredAt: string;
  readonly cause: WorldObservationCause;
  readonly before: WorldObservationSnapshot;
  readonly after: WorldObservationSnapshot;
}

export type WorldObservationListener = (
  event: WorldObservationEvent,
) => void | Promise<void>;

export interface ObservationClock {
  now(): Date;
}

export type WorldObservationCommand =
  | {
      readonly type: "connection_started";
      readonly sequence: number;
      readonly dimension: MinecraftDimension;
    }
  | {
      readonly type: "spawn_completed";
      readonly sequence: number;
      readonly dimension: MinecraftDimension;
    }
  | {
      readonly type: "dimension_changing";
      readonly sequence: number;
      readonly dimension?: MinecraftDimension;
    }
  | {
      readonly type: "held_item_observed";
      readonly sequence: number;
      readonly selectedSlot: number;
      readonly heldItem: ObservedHeldItem;
    }
  | {
      readonly type: "block_observed";
      readonly sequence: number;
      readonly position: ObservedBlockPosition;
      readonly runtimeId: number;
      readonly air: boolean | "unknown";
    }
  | { readonly type: "disconnected"; readonly sequence: number };

export type ObservationSubscriberErrorReporter = (error: unknown) => void;
