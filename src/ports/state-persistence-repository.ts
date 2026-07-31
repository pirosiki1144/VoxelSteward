import type { StateChangeEvent } from "../domain/state/index.js";
import type { NotificationMessage } from "./notification-port.js";

export interface StatePersistenceRepository {
  initialize(runId: string, startedAt: string): Promise<void>;
  persist(
    runId: string,
    event: StateChangeEvent,
    notification: NotificationMessage | undefined,
  ): Promise<void>;
  close(): Promise<void>;
}

export class PersistenceError extends Error {
  override readonly name = "PersistenceError";

  constructor(
    readonly code: "PERSISTENCE_TRANSIENT" | "PERSISTENCE_FATAL",
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
