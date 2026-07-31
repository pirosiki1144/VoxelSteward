import type { StateChangeEvent } from "../../src/domain/state/index.js";
import type { NotificationMessage } from "../../src/ports/notification-port.js";
import type { StatePersistenceRepository } from "../../src/ports/state-persistence-repository.js";

export interface PersistedStateChange {
  readonly runId: string;
  readonly event: StateChangeEvent;
  readonly notification: NotificationMessage | undefined;
}

export class FakeStatePersistenceRepository implements StatePersistenceRepository {
  readonly initialized: Array<{ runId: string; startedAt: string }> = [];
  readonly persisted: PersistedStateChange[] = [];
  closeCalls = 0;
  handler?: (change: PersistedStateChange) => Promise<void>;

  initialize(runId: string, startedAt: string): Promise<void> {
    this.initialized.push({ runId, startedAt });
    return Promise.resolve();
  }

  async persist(
    runId: string,
    event: StateChangeEvent,
    notification: NotificationMessage | undefined,
  ): Promise<void> {
    const change = { runId, event, notification };
    this.persisted.push(change);
    await this.handler?.(change);
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}
