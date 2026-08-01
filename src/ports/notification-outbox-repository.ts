import type { NotificationMessage } from "./notification-port.js";

export type NotificationDeliveryStatus =
  "pending" | "delivering" | "delivered" | "failed";

export interface NotificationOutboxKey {
  readonly runId: string;
  readonly notificationId: string;
}

export interface NotificationOutboxRecord extends NotificationOutboxKey {
  readonly message: NotificationMessage;
  readonly status: NotificationDeliveryStatus;
  readonly attempts: number;
  readonly maxAttempts?: number | undefined;
  readonly nextAttemptAt?: string | undefined;
  readonly leaseOwner?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly deliveredAt?: string | undefined;
  readonly lastErrorCode?: string | undefined;
}

export interface NotificationOutboxRepository {
  claimNext(
    workerId: string,
    now: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<NotificationOutboxRecord | undefined>;
  markDelivered(
    key: NotificationOutboxKey,
    workerId: string,
    deliveredAt: string,
  ): Promise<boolean>;
  markFailed(
    key: NotificationOutboxKey,
    workerId: string,
    failedAt: string,
    nextAttemptAt: string | undefined,
    errorCode: string,
  ): Promise<"pending" | "failed" | undefined>;
  close(): Promise<void>;
}
