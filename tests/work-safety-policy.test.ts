import { describe, expect, it } from "vitest";

import {
  DefaultWorkSafetyPolicy,
  MINIMUM_WORK_HEALTH,
  MINIMUM_WORK_HUNGER,
} from "../src/domain/safety/index.js";
import {
  createStateStore,
  type StateSnapshot,
} from "../src/domain/state/index.js";

const readySnapshot = (): StateSnapshot => {
  const store = createStateStore({
    clock: { now: () => new Date("2026-08-01T00:00:00.000Z") },
  });
  store.dispatch({ type: "runtime.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connected" });
  store.dispatch({ type: "minecraft.spawn.update", completed: true });
  store.dispatch({
    type: "minecraft.telemetry.update",
    telemetry: { health: 20, hunger: 20 },
  });
  store.dispatch({ type: "runtime.transition", to: "ready" });
  return store.getSnapshot();
};

describe("DefaultWorkSafetyPolicy", () => {
  const policy = new DefaultWorkSafetyPolicy();

  it("ready、spawn済み、正常telemetryなら開始と継続を許可する", () => {
    expect(policy.evaluate(readySnapshot(), "start")).toEqual({
      disposition: "allow",
      reason: "safe",
      resumable: true,
    });
    expect(policy.evaluate(readySnapshot(), "continue")).toEqual({
      disposition: "allow",
      reason: "safe",
      resumable: true,
    });
  });

  it.each([
    ["starting", "runtime_not_ready"],
    ["connecting", "runtime_not_ready"],
    ["reconnecting", "runtime_not_ready"],
  ] as const)("runtime=%sでは開始を保留する", (runtime, reason) => {
    expect(
      policy.evaluate({ ...readySnapshot(), runtime }, "start"),
    ).toMatchObject({ disposition: "block", reason, resumable: true });
  });

  it("spawn未完了または接続未完了をfail-closedで拒否する", () => {
    const snapshot = readySnapshot();
    expect(
      policy.evaluate(
        {
          ...snapshot,
          minecraft: {
            ...snapshot.minecraft,
            connection: "connected",
            spawnCompleted: false,
          },
        },
        "continue",
      ),
    ).toMatchObject({ disposition: "stop", reason: "minecraft_not_spawned" });
  });

  it("値が残っていてもtelemetry状態が未知なら許可しない", () => {
    const snapshot = readySnapshot();
    expect(
      policy.evaluate(
        {
          ...snapshot,
          minecraft: { ...snapshot.minecraft, telemetryStatus: "unknown" },
        },
        "start",
      ),
    ).toMatchObject({
      disposition: "block",
      reason: "telemetry_unavailable",
    });
  });

  it.each([
    ["health", undefined, "health_unavailable"],
    ["health", Number.NaN, "health_invalid"],
    ["health", 21, "health_invalid"],
    ["health", MINIMUM_WORK_HEALTH - 1, "health_critical"],
    ["hunger", undefined, "hunger_unavailable"],
    ["hunger", Number.POSITIVE_INFINITY, "hunger_invalid"],
    ["hunger", 21, "hunger_invalid"],
    ["hunger", MINIMUM_WORK_HUNGER - 1, "hunger_critical"],
  ] as const)("未知・不正・危険telemetryを拒否する", (field, value, reason) => {
    const snapshot = readySnapshot();
    const minecraft = { ...snapshot.minecraft };
    if (value === undefined) delete minecraft[field];
    else Object.assign(minecraft, { [field]: value });
    expect(policy.evaluate({ ...snapshot, minecraft }, "start")).toMatchObject({
      disposition: "block",
      reason,
    });
    expect(
      policy.evaluate({ ...snapshot, minecraft }, "continue"),
    ).toMatchObject({ disposition: "stop", reason });
  });

  it("他プレイヤー検知を非再開可能な停止として最優先する", () => {
    const snapshot = readySnapshot();
    expect(
      policy.evaluate(
        {
          ...snapshot,
          runtime: "stopping",
          stopReason: "other_player_detected",
          minecraft: { ...snapshot.minecraft, otherPlayerDetected: true },
        },
        "start",
      ),
    ).toEqual({
      disposition: "block",
      reason: "other_player_detected",
      resumable: false,
    });
  });

  it.each(["signal_sigint", "signal_sigterm", "stop_requested"])(
    "%s停止後の開始を非再開可能として拒否する",
    (stopReason) => {
      expect(
        policy.evaluate(
          { ...readySnapshot(), runtime: "stopping", stopReason },
          "start",
        ),
      ).toMatchObject({
        disposition: "block",
        reason: "stop_requested",
        resumable: false,
      });
    },
  );
});
