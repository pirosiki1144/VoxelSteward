import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

import {
  BedrockClientMovementTransport,
  BedrockMovementPort,
  type BedrockMovementObservation,
  type BedrockMovementTransport,
} from "../src/adapters/minecraft/bedrock-movement-port.js";
import {
  createNeutralPlayerAuthInputFrame,
  createPlayerAuthInputFrame,
  type PlayerAuthInputFrameDraft,
  type PlayerAuthInputPayload,
} from "../src/adapters/minecraft/player-auth-input-frame.js";
import { MovementError } from "../src/domain/movement/index.js";

interface PacketSerializer {
  createPacketBuffer(packet: {
    readonly name: string;
    readonly params: object;
  }): Buffer;
}

interface SerializerModule {
  createSerializer(version: string): PacketSerializer;
}

const require = createRequire(import.meta.url);
const serializerModule =
  require("bedrock-protocol/src/transforms/serializer.js") as SerializerModule;

const draft = (tick = 1n): PlayerAuthInputFrameDraft => ({
  tick,
  position: { x: 1, y: 71, z: 2 },
  delta: { x: 0.1, y: 0, z: 0 },
  moveVector: { x: 1, z: 0 },
  pitch: 0,
  yaw: 0,
  headYaw: 0,
  cameraOrientation: { x: 0, y: 0, z: 1 },
});

class FakeTransport implements BedrockMovementTransport {
  readonly version = "1.26.30";
  readonly payloads: PlayerAuthInputPayload[] = [];
  readonly observations = new Set<
    (observation: BedrockMovementObservation) => void
  >();
  readonly disconnects = new Set<() => void>();
  queueError = false;

  queuePlayerAuthInput(payload: PlayerAuthInputPayload): void {
    this.payloads.push(payload);
    if (this.queueError) throw new Error("synthetic queue failure");
  }

  subscribeObservation(
    listener: (observation: BedrockMovementObservation) => void,
  ): () => void {
    this.observations.add(listener);
    return () => this.observations.delete(listener);
  }

  subscribeDisconnect(listener: () => void): () => void {
    this.disconnects.add(listener);
    return () => this.disconnects.delete(listener);
  }

  observe(observation: BedrockMovementObservation): void {
    for (const listener of this.observations) listener(observation);
  }
}

const step = {
  index: 0,
  total: 1,
  target: { x: 1, y: 71, z: 2, dimension: "overworld" as const },
};

describe("player auth input frame", () => {
  it("builds an immutable safe frame accepted by the pinned schema", () => {
    const frame = createPlayerAuthInputFrame("1.26.30", draft());
    expect(frame.input_data).toEqual({});
    expect(frame).not.toHaveProperty("transaction");
    expect(frame).not.toHaveProperty("item_stack_request");
    expect(frame).not.toHaveProperty("block_action");
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.position)).toBe(true);
    const serializer = serializerModule.createSerializer("1.26.30");
    expect(() =>
      serializer.createPacketBuffer({
        name: "player_auth_input",
        params: frame,
      }),
    ).not.toThrow();
  });

  it("creates a neutral frame with zero movement and no flags", () => {
    const frame = createNeutralPlayerAuthInputFrame("1.26.30", {
      tick: 2n,
      position: { x: 1, y: 71, z: 2 },
      pitch: 0,
      yaw: 0,
      headYaw: 0,
      cameraOrientation: { x: 0, y: 0, z: 1 },
    });
    expect(frame.move_vector).toEqual({ x: 0, z: 0 });
    expect(frame.delta).toEqual({ x: 0, y: 0, z: 0 });
    expect(frame.input_data).toEqual({});
  });

  it("fails closed for unsupported versions and invalid numbers", () => {
    try {
      createPlayerAuthInputFrame("1.21.90", draft());
      expect.fail("unsupported version must fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_MOVEMENT_PROTOCOL" });
    }
    try {
      createPlayerAuthInputFrame("1.26.30", {
        ...draft(),
        position: { x: Number.NaN, y: 0, z: 0 },
      });
      expect.fail("invalid position must fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_MOVEMENT_FRAME" });
    }
  });
});

describe("BedrockMovementPort", () => {
  it("sends one frame and resolves only from a server observation", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft());
    const pending = port.move(step, new AbortController().signal);
    expect(transport.payloads).toHaveLength(1);
    transport.observe({
      kind: "position",
      position: step.target,
    });
    await expect(pending).resolves.toEqual(step.target);
    expect(transport.observations.size).toBe(0);
    expect(transport.disconnects.size).toBe(0);
  });

  it("rejects duplicate or decreasing ticks before a second send", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft(1n));
    const first = port.move(step, new AbortController().signal);
    transport.observe({ kind: "position", position: step.target });
    await first;
    await expect(
      port.move(step, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_MOVEMENT_FRAME" });
    expect(transport.payloads).toHaveLength(1);
  });

  it("queueが同期throwしても送信済みtickを再利用しない", async () => {
    const transport = new FakeTransport();
    transport.queueError = true;
    const port = new BedrockMovementPort(transport, () => draft(7n));
    await expect(
      port.move(step, new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOVEMENT_DISCONNECTED" });
    transport.queueError = false;
    await expect(
      port.move(step, new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_MOVEMENT_FRAME" });
    expect(transport.payloads).toHaveLength(1);
  });

  it("fails on correction and never treats the sent position as observed", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft());
    const pending = port.move(step, new AbortController().signal);
    transport.observe({
      kind: "correction",
      tick: 1n,
      position: step.target,
    });
    await expect(pending).rejects.toMatchObject({ code: "MOVEMENT_CORRECTED" });
  });

  it("ignores stale corrections and fails closed on dimension changes", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft(3n));
    const pending = port.move(step, new AbortController().signal);
    transport.observe({ kind: "correction", tick: 2n, position: step.target });
    expect(transport.observations.size).toBe(1);
    transport.observe({
      kind: "position",
      position: { ...step.target, dimension: "nether" },
    });
    await expect(pending).rejects.toMatchObject({
      code: "MOVEMENT_OBSERVATION_INVALID",
    });
  });

  it("fails on disconnect and cleans listeners", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft());
    const pending = port.move(step, new AbortController().signal);
    for (const listener of transport.disconnects) listener();
    await expect(pending).rejects.toMatchObject({
      code: "MOVEMENT_DISCONNECTED",
    });
    expect(transport.observations.size).toBe(0);
    expect(transport.disconnects.size).toBe(0);
  });

  it("does not send when already aborted", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft());
    const controller = new AbortController();
    controller.abort();
    await expect(port.move(step, controller.signal)).rejects.toMatchObject({
      code: "MOVEMENT_ADAPTER_CLOSED",
    });
    expect(transport.payloads).toHaveLength(0);
  });

  it("cleans a partially registered listener when later registration fails", async () => {
    const observations = new Set<
      (observation: BedrockMovementObservation) => void
    >();
    const queuePlayerAuthInput = vi.fn();
    const transport: BedrockMovementTransport = {
      version: "1.26.30",
      queuePlayerAuthInput,
      subscribeObservation: (listener) => {
        observations.add(listener);
        return () => observations.delete(listener);
      },
      subscribeDisconnect: () => {
        throw new Error("registration failed");
      },
    };
    const port = new BedrockMovementPort(transport, () => draft());
    await expect(
      port.move(step, new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOVEMENT_DISCONNECTED" });
    expect(observations.size).toBe(0);
    expect(queuePlayerAuthInput).not.toHaveBeenCalled();
  });

  it("settles even when transport unsubscribe callbacks throw", async () => {
    let observation: ((event: BedrockMovementObservation) => void) | undefined;
    const transport: BedrockMovementTransport = {
      version: "1.26.30",
      queuePlayerAuthInput: () => undefined,
      subscribeObservation: (listener) => {
        observation = listener;
        return () => {
          throw new Error("observation cleanup failed");
        };
      },
      subscribeDisconnect: () => () => {
        throw new Error("disconnect cleanup failed");
      },
    };
    const port = new BedrockMovementPort(transport, () => draft());
    const pending = port.move(step, new AbortController().signal);
    observation?.({ kind: "position", position: step.target });
    await expect(pending).resolves.toEqual(step.target);
  });

  it("aborts and removes listeners without sending after stop", async () => {
    const transport = new FakeTransport();
    const port = new BedrockMovementPort(transport, () => draft());
    const pending = port.move(step, new AbortController().signal);
    port.stop();
    await expect(pending).rejects.toMatchObject({
      code: "MOVEMENT_ADAPTER_CLOSED",
    });
    expect(transport.observations.size).toBe(0);
    expect(transport.disconnects.size).toBe(0);
    await expect(
      port.move(step, new AbortController().signal),
    ).rejects.toMatchObject({ code: "MOVEMENT_ADAPTER_CLOSED" });
    expect(transport.payloads).toHaveLength(1);
  });
});

describe("BedrockClientMovementTransport", () => {
  it("normalizes only own observations and releases raw listeners", () => {
    const listeners = new Map<string, Set<(packet?: unknown) => void>>();
    const client = {
      queue: vi.fn(),
      on: (event: string, listener: (packet?: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off: (event: string, listener: (packet?: unknown) => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    const transport = new BedrockClientMovementTransport({
      client,
      version: "1.26.30",
      getOwnRuntimeId: () => "42",
      getDimension: () => "overworld",
    });
    const observed: BedrockMovementObservation[] = [];
    const unsubscribe = transport.subscribeObservation((event) =>
      observed.push(event),
    );
    for (const listener of listeners.get("move_player") ?? []) {
      listener({
        runtime_id: 7n,
        position: { x: 0, y: 71, z: 0 },
      });
      listener({
        runtime_id: 42n,
        position: { x: 1, y: 71, z: 2 },
      });
    }
    expect(observed).toHaveLength(1);
    unsubscribe();
    expect(listeners.get("move_player")?.size).toBe(0);
    expect(listeners.get("correct_player_move_prediction")?.size).toBe(0);
  });

  it("does not accept an observation until own runtime identity is known", () => {
    const listeners = new Map<string, Set<(packet?: unknown) => void>>();
    const client = {
      queue: vi.fn(),
      on: (event: string, listener: (packet?: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off: vi.fn(),
    };
    const transport = new BedrockClientMovementTransport({
      client,
      version: "1.26.30",
      getOwnRuntimeId: () => undefined,
      getDimension: () => "overworld",
    });
    const observed = vi.fn();
    transport.subscribeObservation(observed);
    for (const listener of listeners.get("move_player") ?? []) {
      listener({ runtime_id: 1n, position: { x: 0, y: 0, z: 0 } });
    }
    expect(observed).not.toHaveBeenCalled();
  });

  it("removes the first raw listener if the second registration fails", () => {
    const listeners = new Map<string, Set<(packet?: unknown) => void>>();
    const client = {
      queue: vi.fn(),
      on: (event: string, listener: (packet?: unknown) => void) => {
        if (event === "correct_player_move_prediction") {
          throw new Error("registration failed");
        }
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      off: (event: string, listener: (packet?: unknown) => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    const transport = new BedrockClientMovementTransport({
      client,
      version: "1.26.30",
      getOwnRuntimeId: () => "1",
      getDimension: () => "overworld",
    });
    expect(() => transport.subscribeObservation(vi.fn())).toThrowError(
      MovementError,
    );
    expect(listeners.get("move_player")?.size).toBe(0);
  });
});
