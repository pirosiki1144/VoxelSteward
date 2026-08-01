import type {
  NotificationOutboxKey,
  NotificationOutboxRecord,
  NotificationOutboxRepository,
} from "../../ports/notification-outbox-repository.js";

const identity = ({ runId, notificationId }: NotificationOutboxKey): string =>
  `${runId}\u0000${notificationId}`;

const copy = (record: NotificationOutboxRecord): NotificationOutboxRecord =>
  Object.freeze({ ...record });

export class InMemoryNotificationOutboxRepository implements NotificationOutboxRepository {
  readonly #records = new Map<string, NotificationOutboxRecord>();
  #closed = false;

  constructor(records: readonly NotificationOutboxRecord[] = []) {
    for (const record of records)
      this.#records.set(identity(record), copy(record));
  }

  claimNext(
    workerId: string,
    now: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<NotificationOutboxRecord | undefined> {
    this.#ensureOpen();
    if (leaseDurationMs <= 0 || maxAttempts <= 0) throw new RangeError();
    const nowMs = new Date(now).getTime();
    const selected = [...this.#records.values()]
      .filter(({ status }) => status === "pending" || status === "delivering")
      .sort(
        (left, right) =>
          left.message.occurredAt.localeCompare(right.message.occurredAt) ||
          left.message.sourceRevision - right.message.sourceRevision ||
          left.runId.localeCompare(right.runId) ||
          left.notificationId.localeCompare(right.notificationId),
      )[0];
    if (selected === undefined) return Promise.resolve(undefined);
    const available =
      (selected.status === "pending" &&
        (selected.nextAttemptAt === undefined ||
          new Date(selected.nextAttemptAt).getTime() <= nowMs)) ||
      (selected.status === "delivering" &&
        selected.leaseExpiresAt !== undefined &&
        new Date(selected.leaseExpiresAt).getTime() <= nowMs);
    if (!available) return Promise.resolve(undefined);
    const limit = selected.maxAttempts ?? maxAttempts;
    if (selected.attempts >= limit) {
      this.#records.set(
        identity(selected),
        copy({
          ...selected,
          status: "failed",
          maxAttempts: limit,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        }),
      );
      return Promise.resolve(undefined);
    }
    const claimed = copy({
      ...selected,
      status: "delivering",
      attempts: selected.attempts + 1,
      maxAttempts: selected.maxAttempts ?? maxAttempts,
      nextAttemptAt: undefined,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(nowMs + leaseDurationMs).toISOString(),
      lastErrorCode: undefined,
    });
    this.#records.set(identity(claimed), claimed);
    return Promise.resolve(claimed);
  }

  markDelivered(
    key: NotificationOutboxKey,
    workerId: string,
    deliveredAt: string,
  ): Promise<boolean> {
    this.#ensureOpen();
    const current = this.#records.get(identity(key));
    if (current?.status !== "delivering" || current.leaseOwner !== workerId)
      return Promise.resolve(false);
    this.#records.set(
      identity(key),
      copy({
        ...current,
        status: "delivered",
        deliveredAt,
        nextAttemptAt: undefined,
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: undefined,
      }),
    );
    return Promise.resolve(true);
  }

  markFailed(
    key: NotificationOutboxKey,
    workerId: string,
    failedAt: string,
    nextAttemptAt: string | undefined,
    errorCode: string,
  ): Promise<"pending" | "failed" | undefined> {
    this.#ensureOpen();
    const current = this.#records.get(identity(key));
    if (current?.status !== "delivering" || current.leaseOwner !== workerId)
      return Promise.resolve(undefined);
    const status =
      current.attempts >= (current.maxAttempts ?? 1) ? "failed" : "pending";
    this.#records.set(
      identity(key),
      copy({
        ...current,
        status,
        nextAttemptAt:
          status === "failed" ? undefined : (nextAttemptAt ?? failedAt),
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastErrorCode: errorCode,
      }),
    );
    return Promise.resolve(status);
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }

  list(): readonly NotificationOutboxRecord[] {
    this.#ensureOpen();
    return Object.freeze([...this.#records.values()]);
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("notification outbox repository closed");
  }
}
