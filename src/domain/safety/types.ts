import type { StateSnapshot } from "../state/index.js";

export type WorkSafetyIntent = "start" | "continue";

export type WorkSafetyReason =
  | "safe"
  | "other_player_detected"
  | "stop_requested"
  | "runtime_not_ready"
  | "minecraft_not_spawned"
  | "telemetry_unavailable"
  | "telemetry_invalid"
  | "health_unavailable"
  | "health_invalid"
  | "health_critical"
  | "hunger_unavailable"
  | "hunger_invalid"
  | "hunger_critical";

export type WorkSafetyDecision =
  | {
      readonly disposition: "allow";
      readonly reason: "safe";
      readonly resumable: true;
    }
  | {
      readonly disposition: "block" | "stop";
      readonly reason: Exclude<WorkSafetyReason, "safe">;
      readonly resumable: boolean;
    };

export interface WorkSafetyPolicy {
  evaluate(
    snapshot: Readonly<StateSnapshot>,
    intent: WorkSafetyIntent,
  ): WorkSafetyDecision;
}

export interface StateSnapshotSource {
  getSnapshot(): Readonly<StateSnapshot>;
}
