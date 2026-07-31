import type { StateSnapshot } from "../state/index.js";
import type {
  WorkSafetyDecision,
  WorkSafetyIntent,
  WorkSafetyPolicy,
  WorkSafetyReason,
} from "./types.js";

export const MINIMUM_WORK_HEALTH = 10;
export const MINIMUM_WORK_HUNGER = 6;
const MAXIMUM_TELEMETRY_VALUE = 20;

const deny = (
  intent: WorkSafetyIntent,
  reason: Exclude<WorkSafetyReason, "safe">,
  resumable: boolean,
): WorkSafetyDecision =>
  Object.freeze({
    disposition: intent === "start" ? "block" : "stop",
    reason,
    resumable,
  });

const telemetryReason = (
  value: number | undefined,
  name: "health" | "hunger",
  minimum: number,
): Exclude<WorkSafetyReason, "safe"> | undefined => {
  if (value === undefined) return `${name}_unavailable`;
  if (!Number.isFinite(value) || value < 0 || value > MAXIMUM_TELEMETRY_VALUE) {
    return `${name}_invalid`;
  }
  if (value < minimum) return `${name}_critical`;
  return undefined;
};

export class DefaultWorkSafetyPolicy implements WorkSafetyPolicy {
  evaluate(
    snapshot: Readonly<StateSnapshot>,
    intent: WorkSafetyIntent,
  ): WorkSafetyDecision {
    if (snapshot.minecraft.otherPlayerDetected) {
      return deny(intent, "other_player_detected", false);
    }
    if (
      snapshot.stopReason !== undefined ||
      snapshot.runtime === "stopping" ||
      snapshot.runtime === "stopped" ||
      snapshot.runtime === "failed"
    ) {
      return deny(intent, "stop_requested", false);
    }
    if (snapshot.runtime !== "ready") {
      return deny(intent, "runtime_not_ready", true);
    }
    if (
      snapshot.minecraft.connection !== "spawned" ||
      !snapshot.minecraft.spawnCompleted
    ) {
      return deny(intent, "minecraft_not_spawned", true);
    }
    if (snapshot.minecraft.telemetryStatus === "invalid") {
      return deny(intent, "telemetry_invalid", true);
    }
    if (snapshot.minecraft.telemetryStatus !== "valid") {
      return deny(intent, "telemetry_unavailable", true);
    }
    const healthReason = telemetryReason(
      snapshot.minecraft.health,
      "health",
      MINIMUM_WORK_HEALTH,
    );
    if (healthReason !== undefined) return deny(intent, healthReason, true);
    const hungerReason = telemetryReason(
      snapshot.minecraft.hunger,
      "hunger",
      MINIMUM_WORK_HUNGER,
    );
    if (hungerReason !== undefined) return deny(intent, hungerReason, true);
    return Object.freeze({
      disposition: "allow",
      reason: "safe",
      resumable: true,
    });
  }
}
