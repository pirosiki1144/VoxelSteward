import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import {
  BEDROCK_1_26_30_AIR_RUNTIME_ID,
  BedrockWorldObservationPort,
} from "../src/adapters/minecraft/bedrock-world-observation-port.js";

class FakeClient extends EventEmitter {
  override on(event: string, listener: (packet?: unknown) => void): this {
    return super.on(event, listener);
  }

  override off(event: string, listener: (packet?: unknown) => void): this {
    return super.off(event, listener);
  }
}

const spawn = (client: FakeClient): void => {
  client.emit("start_game", { runtime_entity_id: 7n, dimension: 0 });
  client.emit("spawn");
};

describe("BedrockWorldObservationPort", () => {
  it("accepts only the fixed protocol version", () => {
    expect(
      () =>
        new BedrockWorldObservationPort({
          client: new FakeClient(),
          version: "1.26.20",
        }),
    ).toThrow("Unsupported Bedrock observation protocol version");
  });

  it("maps air and non-air update_block packets without preserving raw fields", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    client.emit("update_block", {
      position: { x: 1, y: 71, z: -2 },
      block_runtime_id: BEDROCK_1_26_30_AIR_RUNTIME_ID,
      flags: { network: true },
      layer: 0,
      secret: "must-not-survive",
    });
    client.emit("update_block", {
      position: { x: 2, y: 71, z: -2 },
      block_runtime_id: 44,
      layer: 0,
    });
    expect(
      port
        .getSnapshot()
        .blocks.map(({ runtimeId, air }) => ({ runtimeId, air })),
    ).toEqual([
      { runtimeId: BEDROCK_1_26_30_AIR_RUNTIME_ID, air: true },
      { runtimeId: 44, air: false },
    ]);
    expect(JSON.stringify(port.getSnapshot())).not.toContain(
      "must-not-survive",
    );
  });

  it("ignores non-primary block layers and pre-spawn block packets", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    client.emit("update_block", {
      position: { x: 1, y: 71, z: 1 },
      block_runtime_id: 1,
      layer: 0,
    });
    spawn(client);
    client.emit("update_block", {
      position: { x: 1, y: 71, z: 1 },
      block_runtime_id: 1,
      layer: 1,
    });
    expect(port.getSnapshot().blocks).toEqual([]);
  });

  it("maps only own mob_equipment and retains no NBT, names, or free-form data", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    client.emit("mob_equipment", {
      runtime_entity_id: 8n,
      selected_slot: 1,
      item: { network_id: 99 },
    });
    client.emit("mob_equipment", {
      runtime_entity_id: 7n,
      selected_slot: 2,
      item: {
        network_id: 10,
        count: 3,
        block_runtime_id: 40,
        has_stack_id: true,
        stack_id: { empty: 0, id: 123 },
        extra: { nbt: { display: { Name: "private" } }, lore: ["private"] },
      },
    });
    expect(port.getSnapshot().inventory).toEqual({
      selectedSlot: 2,
      heldItem: {
        status: "known",
        networkId: 10,
        count: 3,
        blockRuntimeId: 40,
        stackNetworkId: 123,
      },
      fullInventory: "unsupported",
    });
    expect(JSON.stringify(port.getSnapshot())).not.toContain("private");
  });

  it("uses explicit empty, unsupported-stack, and inconsistent states", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    client.emit("mob_equipment", {
      runtime_entity_id: 7n,
      selected_slot: 0,
      item: { network_id: 0 },
    });
    expect(port.getSnapshot().inventory.heldItem.status).toBe("empty");
    client.emit("mob_equipment", {
      runtime_entity_id: 7n,
      selected_slot: 1,
      item: {
        network_id: 10,
        count: 1,
        block_runtime_id: 40,
        has_stack_id: false,
      },
    });
    expect(port.getSnapshot().inventory.heldItem).toMatchObject({
      status: "known",
      stackNetworkId: "unsupported",
    });
    client.emit("mob_equipment", {
      runtime_entity_id: 7n,
      selected_slot: 2,
      item: { network_id: 10, count: 0 },
    });
    expect(port.getSnapshot().inventory.heldItem.status).toBe("inconsistent");
  });

  it("invalidates on dimension change until reconnect and on disconnect", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    client.emit("change_dimension", { dimension: 1 });
    expect(port.getSnapshot()).toMatchObject({
      availability: "dimension_transition",
      dimension: "nether",
      blocks: [],
    });
    client.emit("spawn");
    expect(port.getSnapshot().availability).toBe("dimension_transition");
    client.emit("close");
    expect(port.getSnapshot().availability).toBe("disconnected");
    expect(port.getSnapshot().dimension).toBeUndefined();
  });

  it("delivers the terminal disconnected event before explicit cleanup", async () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    const causes: string[] = [];
    port.subscribe((event) => {
      causes.push(event.cause);
    });
    spawn(client);
    await Promise.resolve();
    client.emit("close");
    await Promise.resolve();
    expect(causes.at(-1)).toBe("disconnected");
    expect(client.eventNames()).toEqual([]);
    port.close();
  });

  it("invalidates a ready cache even when the changed dimension is unknown", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    client.emit("update_block", {
      position: { x: 0, y: 71, z: 0 },
      block_runtime_id: 4,
      layer: 0,
    });
    client.emit("change_dimension", { dimension: 3 });
    expect(port.getSnapshot()).toMatchObject({
      availability: "dimension_transition",
      blocks: [],
      inventory: { selectedSlot: "unknown" },
    });
    expect(port.getSnapshot().dimension).toBeUndefined();
  });

  it("removes packet listeners and rejects new external observations after close", () => {
    const client = new FakeClient();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
    });
    spawn(client);
    expect(client.listenerCount("update_block")).toBe(1);
    port.close();
    port.close();
    expect(client.eventNames()).toEqual([]);
    expect(port.getSnapshot().availability).toBe("disconnected");
    client.emit("update_block", {
      position: { x: 0, y: 0, z: 0 },
      block_runtime_id: 1,
      layer: 0,
    });
    expect(port.getSnapshot().blocks).toEqual([]);
  });

  it("rolls back listeners when registration fails", () => {
    class ThrowingClient extends FakeClient {
      override on(event: string, listener: (packet?: unknown) => void): this {
        if (event === "update_block") throw new Error("registration failed");
        return super.on(event, listener);
      }
    }
    const client = new ThrowingClient();
    expect(
      () => new BedrockWorldObservationPort({ client, version: "1.26.30" }),
    ).toThrow("registration failed");
    expect(client.eventNames()).toEqual([]);
  });

  it("isolates subscriber failures from subsequent observations", async () => {
    const client = new FakeClient();
    const errors = vi.fn();
    const listener = vi.fn();
    const port = new BedrockWorldObservationPort({
      client,
      version: "1.26.30",
      onSubscriberError: errors,
    });
    port.subscribe(() => Promise.reject(new Error("subscriber")));
    port.subscribe(listener);
    spawn(client);
    await vi.waitFor(() => expect(errors).toHaveBeenCalled());
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
