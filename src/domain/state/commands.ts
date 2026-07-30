import type {
  MinecraftConnectionState,
  Position,
  RuntimeState,
  SanitizedError,
  TaskState,
} from "./types.js";

export type StateCommand =
  | { readonly type: "runtime.transition"; readonly to: RuntimeState }
  | {
      readonly type: "minecraft.connection.transition";
      readonly to: MinecraftConnectionState;
    }
  | {
      readonly type: "minecraft.spawn.update";
      readonly completed: boolean;
    }
  | {
      readonly type: "minecraft.telemetry.update";
      readonly telemetry: {
        readonly position?: Position;
        readonly health?: number;
        readonly hunger?: number;
      };
    }
  | { readonly type: "safety.other_player_detected" }
  | {
      readonly type: "task.prepare";
      readonly taskId: string;
      readonly taskType: string;
    }
  | {
      readonly type: "task.transition";
      readonly to: Exclude<TaskState, "idle" | "preparing">;
    }
  | {
      readonly type: "task.progress.update";
      readonly progress: number;
      readonly message?: string;
    }
  | { readonly type: "task.reset" }
  | {
      readonly type: "runtime.stop_reason.record";
      readonly reason: string;
    }
  | {
      readonly type: "runtime.error.record";
      readonly error: SanitizedError;
    };
