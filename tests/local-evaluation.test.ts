import { describe, expect, it } from "vitest";

import {
  evaluateReadOnlyConnection,
  evaluateSingleBlockGate,
  runLocalEvaluation,
  type LocalEvaluationFixture,
} from "../src/evaluation/local-evaluation.js";

const fixture = (
  overrides: Partial<LocalEvaluationFixture> = {},
): LocalEvaluationFixture => ({
  connected: true,
  spawned: true,
  otherPlayerDetected: false,
  health: 20,
  hunger: 20,
  position: { x: 0, y: 64, z: 0, dimension: "overworld" },
  targetBlock: "air",
  supportBlock: "solid_other",
  ...overrides,
});

describe("local evaluation harness", () => {
  it("接続・spawn後は読み取りだけを行う", () => {
    expect(evaluateReadOnlyConnection(fixture())).toEqual({
      scenario: "readonly_connection",
      outcome: "passed",
      reason: "observations_available",
      readOperations: 3,
      writeOperations: 0,
    });
  });

  it("他player検知時は安全停止し、書込みを行わない", () => {
    expect(
      evaluateReadOnlyConnection(fixture({ otherPlayerDetected: true })),
    ).toMatchObject({
      outcome: "stopped",
      reason: "other_player_detected",
      writeOperations: 0,
    });
  });

  it("危険なtelemetryでは停止し、推測や操作を行わない", () => {
    expect(evaluateReadOnlyConnection(fixture({ health: 5 }))).toMatchObject({
      outcome: "stopped",
      reason: "unsafe_telemetry",
      writeOperations: 0,
    });
  });

  it("block配置はprotocol gateがunsupportedの間は送信しない", () => {
    expect(evaluateSingleBlockGate(fixture())).toMatchObject({
      scenario: "single_block_gate",
      outcome: "blocked",
      reason: "protocol_capability_unsupported",
      writeOperations: 0,
    });
  });

  it("接続準備前や他player時にblock配置を開始しない", () => {
    expect(
      evaluateSingleBlockGate(
        fixture({
          connected: false,
          spawned: false,
          otherPlayerDetected: true,
        }),
      ),
    ).toMatchObject({
      outcome: "stopped",
      reason: "connection_not_ready",
      writeOperations: 0,
    });
  });

  it("標準fixture全体でネットワーク・書込み操作が0件", () => {
    const results = runLocalEvaluation(fixture());
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.writeOperations === 0)).toBe(true);
  });
});
