import { describe, expect, it } from "vitest";

import {
  AuthoritativeFrameOwnershipError,
  BedrockAuthoritativeFrameOwnership,
} from "../src/adapters/minecraft/bedrock-authoritative-frame-ownership.js";
import { createNeutralPlayerAuthInputFrame } from "../src/adapters/minecraft/player-auth-input-frame.js";

const frame = (tick: bigint, x = 0) =>
  createNeutralPlayerAuthInputFrame("1.26.30", {
    tick,
    position: { x, y: 71, z: 0 },
    pitch: 0,
    yaw: 0,
    headYaw: 0,
    cameraOrientation: { x: 0, y: 0, z: 1 },
  });

const blockRequest = (
  overrides: Partial<
    Parameters<BedrockAuthoritativeFrameOwnership["acquireBlockPlacement"]>[0]
  > = {},
) => ({
  frame: frame(1n),
  dimension: "overworld" as const,
  target: { x: 1, y: 71, z: 0, dimension: "overworld" as const },
  observationRevision: 4,
  ...overrides,
});

const expectOwnershipError = (
  operation: () => unknown,
  code: AuthoritativeFrameOwnershipError["code"],
): void => {
  try {
    operation();
    throw new Error("Expected authoritative frame ownership error");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthoritativeFrameOwnershipError);
    if (!(error instanceof AuthoritativeFrameOwnershipError)) return;
    expect(error.code).toBe(code);
  }
};

describe("BedrockAuthoritativeFrameOwnership", () => {
  const ownershipWithRevision = (revision = 4, safetyAllowed = true) =>
    new BedrockAuthoritativeFrameOwnership({
      getLatestObservationRevision: () => revision,
      getBlockPlacementSafetyAllowed: () => safetyAllowed,
    });

  it("movementとblock placementを同時所有させない", () => {
    const ownership = ownershipWithRevision();
    const movement = ownership.acquireMovement(1n);
    expect(() => ownership.acquireBlockPlacement(blockRequest())).toThrowError(
      AuthoritativeFrameOwnershipError,
    );
    movement.release();
    expect(ownership.acquireBlockPlacement(blockRequest()).owner).toBe(
      "block_placement",
    );
  });

  it("commit済みtickの重複と逆行を拒否する", () => {
    const ownership = new BedrockAuthoritativeFrameOwnership();
    ownership.acquireMovement(2n).commit();
    for (const tick of [2n, 1n]) {
      expectOwnershipError(
        () => ownership.acquireMovement(tick),
        "invalid_tick",
      );
    }
  });

  it("releaseした未送信frameはtickを消費しない", () => {
    const ownership = new BedrockAuthoritativeFrameOwnership();
    ownership.acquireMovement(3n).release();
    expect(() => ownership.acquireMovement(3n)).not.toThrow();
  });

  it.each([
    [{ observationRevision: 3 }, "stale_observation"],
    [
      { target: { x: 1, y: 71, z: 0, dimension: "nether" as const } },
      "dimension_mismatch",
    ],
    [
      { target: { x: 20, y: 71, z: 0, dimension: "overworld" as const } },
      "out_of_reach",
    ],
  ] as const)("block frameの不正条件%oを拒否する", (override, code) => {
    const ownership = ownershipWithRevision();
    expectOwnershipError(
      () => ownership.acquireBlockPlacement(blockRequest(override)),
      code,
    );
  });

  it("安全policyが許可しないblock frameを取得前に拒否する", () => {
    const ownership = ownershipWithRevision(4, false);
    expectOwnershipError(
      () => ownership.acquireBlockPlacement(blockRequest()),
      "safety_stop",
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "不正な観測revision %sを拒否する",
    (observationRevision) => {
      const ownership = ownershipWithRevision();
      expectOwnershipError(
        () =>
          ownership.acquireBlockPlacement(
            blockRequest({ observationRevision }),
          ),
        "stale_observation",
      );
    },
  );

  it("latest revisionをcaller値ではなく注入元から再取得する", () => {
    let revision = 4;
    const ownership = new BedrockAuthoritativeFrameOwnership({
      getLatestObservationRevision: () => revision,
      getBlockPlacementSafetyAllowed: () => true,
    });
    revision = 5;
    expectOwnershipError(
      () => ownership.acquireBlockPlacement(blockRequest()),
      "stale_observation",
    );
  });

  it("lease取得後もcommit直前に観測鮮度と安全状態を再評価する", () => {
    let revision = 4;
    let safetyAllowed = true;
    const ownership = new BedrockAuthoritativeFrameOwnership({
      getLatestObservationRevision: () => revision,
      getBlockPlacementSafetyAllowed: () => safetyAllowed,
    });
    const staleLease = ownership.acquireBlockPlacement(blockRequest());
    revision = 5;
    expectOwnershipError(() => staleLease.commit(), "stale_observation");

    revision = 4;
    const unsafeLease = ownership.acquireBlockPlacement(blockRequest());
    safetyAllowed = false;
    expectOwnershipError(() => unsafeLease.commit(), "safety_stop");
  });

  it("close後は新しいframeを取得できずcloseは冪等", () => {
    const ownership = new BedrockAuthoritativeFrameOwnership();
    ownership.close();
    ownership.close();
    expectOwnershipError(() => ownership.acquireMovement(1n), "closed");
  });
});
