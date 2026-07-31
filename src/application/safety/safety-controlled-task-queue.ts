import type { TaskQueueItem } from "../../domain/task-queue/index.js";
import type {
  StateSnapshotSource,
  WorkSafetyDecision,
  WorkSafetyPolicy,
} from "../../domain/safety/index.js";
import type { TaskQueueService } from "../task-queue/index.js";

export interface SafetyClaimResult {
  readonly decision: WorkSafetyDecision;
  readonly item?: TaskQueueItem;
}

export interface SafetyContinuationResult {
  readonly decision: WorkSafetyDecision;
  readonly stopped: boolean;
}

export class SafetyControlledTaskQueue {
  readonly #queue: TaskQueueService;
  readonly #snapshots: StateSnapshotSource;
  readonly #policy: WorkSafetyPolicy;
  readonly #stoppedTaskIds = new Set<string>();

  constructor(
    queue: TaskQueueService,
    snapshots: StateSnapshotSource,
    policy: WorkSafetyPolicy,
  ) {
    this.#queue = queue;
    this.#snapshots = snapshots;
    this.#policy = policy;
  }

  async claimNext(): Promise<SafetyClaimResult> {
    const decision = this.#policy.evaluate(
      this.#snapshots.getSnapshot(),
      "start",
    );
    if (decision.disposition !== "allow") {
      return Object.freeze({ decision });
    }
    const { item } = await this.#queue.dispatch({ type: "task.claim_next" });
    if (item === undefined) return Object.freeze({ decision });
    const afterClaim = this.#policy.evaluate(
      this.#snapshots.getSnapshot(),
      "start",
    );
    if (afterClaim.disposition !== "allow") {
      await this.#stopOnce(item.taskId);
      return Object.freeze({ decision: afterClaim });
    }
    return Object.freeze({ decision: afterClaim, item });
  }

  async enforceContinuation(taskId: string): Promise<SafetyContinuationResult> {
    const decision = this.#policy.evaluate(
      this.#snapshots.getSnapshot(),
      "continue",
    );
    if (decision.disposition !== "stop") {
      return Object.freeze({ decision, stopped: false });
    }
    const stopped = await this.#stopOnce(taskId);
    return Object.freeze({ decision, stopped });
  }

  async #stopOnce(taskId: string): Promise<boolean> {
    if (this.#stoppedTaskIds.has(taskId)) return false;
    this.#stoppedTaskIds.add(taskId);
    try {
      await this.#queue.dispatch({
        type: "task.finish",
        taskId,
        outcome: "stopped",
      });
    } catch (error) {
      this.#stoppedTaskIds.delete(taskId);
      throw error;
    }
    return true;
  }
}
