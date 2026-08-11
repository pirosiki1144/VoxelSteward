import { pathToFileURL } from "node:url";

import { assessBedrockBlockPlacementCapability } from "../adapters/minecraft/bedrock-block-placement-capability.js";
import type { BlockPosition } from "../domain/block-operation/index.js";
import { createLogger } from "../infrastructure/logger.js";

export type LocalEvaluationScenario =
  "readonly_connection" | "single_block_gate";

export interface LocalEvaluationFixture {
  readonly connected: boolean;
  readonly spawned: boolean;
  readonly otherPlayerDetected: boolean;
  readonly health: number;
  readonly hunger: number;
  readonly position: BlockPosition;
  readonly targetBlock: "air" | "dirt" | "solid_other";
  readonly supportBlock: "air" | "dirt" | "solid_other";
}

export interface LocalEvaluationResult {
  readonly scenario: LocalEvaluationScenario;
  readonly outcome: "passed" | "stopped" | "blocked";
  readonly reason:
    | "observations_available"
    | "other_player_detected"
    | "unsafe_telemetry"
    | "protocol_capability_unsupported"
    | "connection_not_ready";
  readonly readOperations: number;
  readonly writeOperations: number;
}

const defaultFixture: LocalEvaluationFixture = Object.freeze({
  connected: true,
  spawned: true,
  otherPlayerDetected: false,
  health: 20,
  hunger: 20,
  position: Object.freeze({ x: 0, y: 64, z: 0, dimension: "overworld" }),
  targetBlock: "air",
  supportBlock: "solid_other",
});

const isSafe = (fixture: LocalEvaluationFixture): boolean =>
  fixture.health > 6 && fixture.hunger > 6;

export const evaluateReadOnlyConnection = (
  fixture: LocalEvaluationFixture = defaultFixture,
): LocalEvaluationResult => {
  if (!fixture.connected || !fixture.spawned) {
    return Object.freeze({
      scenario: "readonly_connection",
      outcome: "stopped",
      reason: "connection_not_ready",
      readOperations: 0,
      writeOperations: 0,
    });
  }
  if (fixture.otherPlayerDetected) {
    return Object.freeze({
      scenario: "readonly_connection",
      outcome: "stopped",
      reason: "other_player_detected",
      readOperations: 0,
      writeOperations: 0,
    });
  }
  if (!isSafe(fixture)) {
    return Object.freeze({
      scenario: "readonly_connection",
      outcome: "stopped",
      reason: "unsafe_telemetry",
      readOperations: 1,
      writeOperations: 0,
    });
  }
  return Object.freeze({
    scenario: "readonly_connection",
    outcome: "passed",
    reason: "observations_available",
    readOperations: 3,
    writeOperations: 0,
  });
};

export const evaluateSingleBlockGate = (
  fixture: LocalEvaluationFixture = defaultFixture,
): LocalEvaluationResult => {
  const connection = evaluateReadOnlyConnection(fixture);
  if (connection.outcome !== "passed") {
    return Object.freeze({
      scenario: "single_block_gate",
      outcome: connection.outcome,
      reason: connection.reason,
      readOperations: connection.readOperations,
      writeOperations: 0,
    });
  }
  if (fixture.targetBlock !== "air" || fixture.supportBlock === "air") {
    return Object.freeze({
      scenario: "single_block_gate",
      outcome: "blocked",
      reason: "protocol_capability_unsupported",
      readOperations: 5,
      writeOperations: 0,
    });
  }
  const capability = assessBedrockBlockPlacementCapability("1.26.30");
  return Object.freeze({
    scenario: "single_block_gate",
    outcome: capability.capability === "unsupported" ? "blocked" : "passed",
    reason:
      capability.capability === "unsupported"
        ? "protocol_capability_unsupported"
        : "observations_available",
    readOperations: 5,
    writeOperations: 0,
  });
};

export const runLocalEvaluation = (
  fixture: LocalEvaluationFixture = defaultFixture,
): readonly LocalEvaluationResult[] =>
  Object.freeze([
    evaluateReadOnlyConnection(fixture),
    evaluateSingleBlockGate(fixture),
  ]);

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  const logger = createLogger("normal", "info");
  const results = runLocalEvaluation();
  for (const result of results) {
    logger.log("info", {
      event: "evaluation.scenario_finished",
      scenario: result.scenario,
      outcome: result.outcome,
      reason: result.reason,
      readOperations: result.readOperations,
      writeOperations: result.writeOperations,
    });
  }
  logger.log("info", {
    event: "evaluation.finished",
    outcome: "safe",
    network: "disabled",
    writeOperations: results.reduce(
      (total, result) => total + result.writeOperations,
      0,
    ),
  });
}
