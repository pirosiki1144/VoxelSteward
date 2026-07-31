import { describe, expect, it, vi } from "vitest";

import {
  WorldObservationError,
  WorldObservationStore,
  type ObservationClock,
} from "../src/domain/world-observation/index.js";

const clock = (iso = "2026-08-01T00:00:00.000Z"): ObservationClock => ({
  now: () => new Date(iso),
});

const readyStore = (maxBlocks = 128): WorldObservationStore => {
  const store = new WorldObservationStore({ clock: clock(), maxBlocks });
  store.dispatch({
    type: "connection_started",
    sequence: 1,
    dimension: "overworld",
  });
  store.dispatch({
    type: "spawn_completed",
    sequence: 2,
    dimension: "overworld",
  });
  return store;
};

describe("WorldObservationStore", () => {
  it("starts disconnected with an immutable unknown inventory", () => {
    const snapshot = new WorldObservationStore({
      clock: clock(),
    }).getSnapshot();
    expect(snapshot).toEqual({
      revision: 0,
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastSequence: -1,
      availability: "disconnected",
      inventory: {
        selectedSlot: "unknown",
        heldItem: { status: "unknown" },
        fullInventory: "unsupported",
      },
      blocks: [],
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.inventory)).toBe(true);
    expect(Object.isFrozen(snapshot.inventory.heldItem)).toBe(true);
    expect(Object.isFrozen(snapshot.blocks)).toBe(true);
  });

  it("records UTC revisions and immutable before/after events", () => {
    const store = new WorldObservationStore({ clock: clock() });
    const event = store.dispatch({
      type: "connection_started",
      sequence: 4,
      dimension: "overworld",
    });
    expect(event?.revision).toBe(1);
    expect(event?.occurredAt).toBe("2026-08-01T00:00:00.000Z");
    expect(event?.before.revision).toBe(0);
    expect(event?.after.revision).toBe(1);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.before)).toBe(true);
    expect(Object.isFrozen(event?.after.inventory)).toBe(true);
  });

  it("suppresses equal and out-of-order updates without increasing revision", () => {
    const store = readyStore();
    const first = store.dispatch({
      type: "held_item_observed",
      sequence: 5,
      selectedSlot: 2,
      heldItem: { status: "empty" },
    });
    const equal = store.dispatch({
      type: "held_item_observed",
      sequence: 6,
      selectedSlot: 2,
      heldItem: { status: "empty" },
    });
    const old = store.dispatch({
      type: "held_item_observed",
      sequence: 4,
      selectedSlot: 3,
      heldItem: { status: "inconsistent" },
    });
    expect(first?.revision).toBe(3);
    expect(equal).toBeUndefined();
    expect(old).toBeUndefined();
    expect(store.getSnapshot().revision).toBe(3);
    expect(store.getSnapshot().inventory.selectedSlot).toBe(2);
  });

  it("supports known, empty, unsupported-stack and inconsistent held item states", () => {
    const store = readyStore();
    store.dispatch({
      type: "held_item_observed",
      sequence: 3,
      selectedSlot: 0,
      heldItem: {
        status: "known",
        networkId: 12,
        count: 1,
        blockRuntimeId: 44,
        stackNetworkId: "unsupported",
      },
    });
    expect(store.getSnapshot().inventory).toEqual({
      selectedSlot: 0,
      heldItem: {
        status: "known",
        networkId: 12,
        count: 1,
        blockRuntimeId: 44,
        stackNetworkId: "unsupported",
      },
      fullInventory: "unsupported",
    });
    store.dispatch({
      type: "held_item_observed",
      sequence: 4,
      selectedSlot: 1,
      heldItem: { status: "inconsistent" },
    });
    expect(store.getSnapshot().inventory.heldItem.status).toBe("inconsistent");
  });

  it("records server blocks and exposes only ready same-dimension observations", () => {
    const store = readyStore();
    store.dispatch({
      type: "block_observed",
      sequence: 3,
      position: { x: 1, y: 71, z: 2, dimension: "overworld" },
      runtimeId: 13094,
      air: true,
    });
    expect(
      store.getBlock({ x: 1, y: 71, z: 2, dimension: "overworld" }),
    ).toMatchObject({
      runtimeId: 13094,
      air: true,
      source: "server_update_block",
    });
    expect(
      store.getBlock({ x: 1, y: 71, z: 2, dimension: "nether" }),
    ).toBeUndefined();
  });

  it("evicts oldest blocks at the configured bound", () => {
    const store = readyStore(2);
    for (let index = 0; index < 3; index += 1) {
      store.dispatch({
        type: "block_observed",
        sequence: 3 + index,
        position: { x: index, y: 71, z: 0, dimension: "overworld" },
        runtimeId: index,
        air: index === 0,
      });
    }
    expect(store.getSnapshot().blocks).toHaveLength(2);
    expect(
      store.getBlock({ x: 0, y: 71, z: 0, dimension: "overworld" }),
    ).toBeUndefined();
    expect(
      store.getBlock({ x: 2, y: 71, z: 0, dimension: "overworld" }),
    ).toBeDefined();
  });

  it("invalidates blocks and inventory during dimension transition and disconnect", () => {
    const store = readyStore();
    store.dispatch({
      type: "block_observed",
      sequence: 3,
      position: { x: 0, y: 71, z: 0, dimension: "overworld" },
      runtimeId: 4,
      air: false,
    });
    store.dispatch({
      type: "dimension_changing",
      sequence: 4,
      dimension: "nether",
    });
    expect(store.getSnapshot()).toMatchObject({
      availability: "dimension_transition",
      dimension: "nether",
      blocks: [],
      inventory: { selectedSlot: "unknown" },
    });
    expect(() =>
      store.dispatch({
        type: "block_observed",
        sequence: 5,
        position: { x: 0, y: 71, z: 0, dimension: "nether" },
        runtimeId: 4,
        air: false,
      }),
    ).toThrowError(WorldObservationError);
    store.dispatch({ type: "disconnected", sequence: 6 });
    expect(store.getSnapshot().availability).toBe("disconnected");
    expect(store.getSnapshot().dimension).toBeUndefined();
  });

  it("rejects pre-spawn observations and invalid slots atomically", () => {
    const store = new WorldObservationStore({ clock: clock() });
    store.dispatch({
      type: "connection_started",
      sequence: 1,
      dimension: "overworld",
    });
    const before = store.getSnapshot();
    expect(() =>
      store.dispatch({
        type: "held_item_observed",
        sequence: 2,
        selectedSlot: 9,
        heldItem: { status: "empty" },
      }),
    ).toThrowError(WorldObservationError);
    expect(store.getSnapshot()).toBe(before);
    store.dispatch({
      type: "spawn_completed",
      sequence: 2,
      dimension: "overworld",
    });
    expect(store.getSnapshot().availability).toBe("ready");
  });

  it("projects held items through an allow-list and rejects invalid values atomically", () => {
    const store = readyStore();
    const before = store.getSnapshot();
    expect(() =>
      store.dispatch({
        type: "held_item_observed",
        sequence: 3,
        selectedSlot: 0,
        heldItem: {
          status: "known",
          networkId: -1,
          count: Number.NaN,
          blockRuntimeId: 0,
          stackNetworkId: "unsupported",
          secret: "not retained",
        } as never,
      }),
    ).toThrowError(WorldObservationError);
    expect(store.getSnapshot()).toBe(before);
    const event = store.dispatch({
      type: "held_item_observed",
      sequence: 3,
      selectedSlot: 0,
      heldItem: {
        status: "known",
        networkId: 1,
        count: 1,
        blockRuntimeId: 0,
        stackNetworkId: "unsupported",
        secret: "not retained",
      } as never,
    });
    expect(event).toBeDefined();
    expect(JSON.stringify(store.getSnapshot())).not.toContain("secret");
  });

  it("rejects an invalid air marker without consuming its sequence", () => {
    const store = readyStore();
    expect(() =>
      store.dispatch({
        type: "block_observed",
        sequence: 3,
        position: { x: 0, y: 0, z: 0, dimension: "overworld" },
        runtimeId: 0,
        air: "yes",
      } as never),
    ).toThrowError(WorldObservationError);
    expect(
      store.dispatch({
        type: "block_observed",
        sequence: 3,
        position: { x: 0, y: 0, z: 0, dimension: "overworld" },
        runtimeId: 0,
        air: "unknown",
      }),
    ).toBeDefined();
  });

  it("isolates synchronous and asynchronous subscriber failures", async () => {
    const errors: unknown[] = [];
    const received = vi.fn();
    const store = new WorldObservationStore({
      clock: clock(),
      onSubscriberError: (error) => errors.push(error),
    });
    store.subscribe(() => {
      throw new Error("sync");
    });
    store.subscribe(() => Promise.reject(new Error("async")));
    store.subscribe(received);
    store.dispatch({
      type: "connection_started",
      sequence: 1,
      dimension: "overworld",
    });
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(received).toHaveBeenCalledTimes(1);
  });

  it("does not invoke unsubscribed or closed listeners", async () => {
    const listener = vi.fn();
    const store = new WorldObservationStore({ clock: clock() });
    const unsubscribe = store.subscribe(listener);
    store.dispatch({
      type: "connection_started",
      sequence: 1,
      dimension: "overworld",
    });
    unsubscribe();
    store.close();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(() => store.subscribe(listener)).toThrowError(WorldObservationError);
  });
});
