import type {
  NotificationMessage,
  NotificationPort,
} from "../../ports/notification-port.js";

export type HttpTransport = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

export type AbortableWait = (
  delayMs: number,
  signal: AbortSignal,
) => Promise<void>;

export type NotificationDeliveryClassification =
  | "configuration"
  | "timeout"
  | "network"
  | "rate_limited"
  | "client_error"
  | "server_error"
  | "cancelled";

export interface SafeNotificationDeliveryFailure {
  readonly code: string;
  readonly classification: NotificationDeliveryClassification;
  readonly status?: number;
  readonly attempts: number;
}

export class NotificationDeliveryError extends Error {
  readonly code: string;
  readonly classification: NotificationDeliveryClassification;
  readonly status?: number;
  readonly attempts: number;

  constructor(failure: SafeNotificationDeliveryFailure) {
    super("Notification delivery failed");
    this.name = "NotificationDeliveryError";
    delete this.stack;
    this.code = failure.code;
    this.classification = failure.classification;
    if (failure.status !== undefined) this.status = failure.status;
    this.attempts = failure.attempts;
  }
}

export const toSafeNotificationDeliveryFailure = (
  error: unknown,
): SafeNotificationDeliveryFailure => {
  if (error instanceof NotificationDeliveryError) {
    return Object.freeze({
      code: error.code,
      classification: error.classification,
      ...(error.status === undefined ? {} : { status: error.status }),
      attempts: error.attempts,
    });
  }
  return Object.freeze({
    code: "UNKNOWN_NOTIFICATION_DELIVERY_ERROR",
    classification: "network",
    attempts: 0,
  });
};

export interface DiscordWebhookNotificationPortOptions {
  readonly webhookUrl: URL;
  readonly requestTimeoutMs: number;
  readonly maxAttempts: number;
  readonly totalBudgetMs: number;
  readonly transport?: HttpTransport;
  readonly monotonicNow?: () => number;
  readonly wait?: AbortableWait;
  readonly jitter?: (baseDelayMs: number) => number;
}

const MAX_CONTENT_LENGTH = 2_000;
const MAX_RATE_LIMIT_BODY_BYTES = 16 * 1_024;

const defaultWait: AbortableWait = (delayMs, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const finish = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const deliveryError = (
  code: string,
  classification: NotificationDeliveryClassification,
  attempts: number,
  status?: number,
): NotificationDeliveryError =>
  new NotificationDeliveryError({
    code,
    classification,
    attempts,
    ...(status === undefined ? {} : { status }),
  });

const parseSeconds = (raw: string | null): number | undefined => {
  if (raw === null || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  const milliseconds = seconds * 1_000;
  if (!Number.isFinite(milliseconds) || milliseconds > 86_400_000) {
    return undefined;
  }
  return milliseconds;
};

const discardBody = (response: Response): void => {
  void response.body?.cancel().catch(() => undefined);
};

const readBoundedText = async (
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string | undefined> => {
  if (signal.aborted) {
    discardBody(response);
    return undefined;
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  let readFailed = false;
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  const onAbort = (): void => cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    cancel();
  }, timeoutMs);
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        readFailed = true;
        void reader.cancel().catch(() => undefined);
        break;
      }
      const chunk = result.value;
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        void reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(chunk);
    }
  } catch {
    readFailed = true;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  if (signal.aborted || timedOut || readFailed) return undefined;
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
};

const retryAfterFromResponse = async (
  response: Response,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<number | undefined> => {
  const headerDelay = parseSeconds(response.headers.get("Retry-After"));
  if (headerDelay !== undefined) {
    discardBody(response);
    return headerDelay;
  }
  const text = await readBoundedText(
    response,
    MAX_RATE_LIMIT_BODY_BYTES,
    signal,
    timeoutMs,
  );
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("retry_after" in parsed)
    ) {
      return undefined;
    }
    const value = (parsed as { retry_after?: unknown }).retry_after;
    return typeof value === "number" ? parseSeconds(String(value)) : undefined;
  } catch {
    return undefined;
  }
};

export const renderDiscordContent = (message: NotificationMessage): string => {
  const content = [
    `[${message.severity}] ${message.title}`,
    message.body,
    `Type: ${message.type}`,
    `Revision: ${message.sourceRevision}`,
    `Occurred at: ${message.occurredAt}`,
    `Notification ID: ${message.notificationId}`,
  ].join("\n");
  if (content.length > MAX_CONTENT_LENGTH) {
    throw deliveryError("NOTIFICATION_CONTENT_TOO_LONG", "configuration", 0);
  }
  return content;
};

export class DiscordWebhookNotificationPort implements NotificationPort {
  readonly #webhookUrl: URL;
  readonly #requestTimeoutMs: number;
  readonly #maxAttempts: number;
  readonly #totalBudgetMs: number;
  readonly #transport: HttpTransport;
  readonly #monotonicNow: () => number;
  readonly #wait: AbortableWait;
  readonly #jitter: (baseDelayMs: number) => number;
  readonly #lifecycle = new AbortController();
  #nextAllowedAt = 0;

  constructor(options: DiscordWebhookNotificationPortOptions) {
    this.#webhookUrl = new URL(options.webhookUrl);
    this.#webhookUrl.searchParams.set("wait", "true");
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#maxAttempts = options.maxAttempts;
    this.#totalBudgetMs = options.totalBudgetMs;
    this.#transport = options.transport ?? globalThis.fetch;
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#wait = options.wait ?? defaultWait;
    this.#jitter =
      options.jitter ??
      ((baseDelayMs) => Math.floor(Math.random() * (baseDelayMs * 0.2 + 1)));
  }

  async send(message: NotificationMessage): Promise<void> {
    if (this.#lifecycle.signal.aborted) {
      throw deliveryError("NOTIFICATION_DELIVERY_CANCELLED", "cancelled", 0);
    }
    const content = renderDiscordContent(message);
    const body = JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    });
    const startedAt = this.#monotonicNow();
    let attempts = 0;

    await this.#waitWithinBudget(
      Math.max(0, this.#nextAllowedAt - this.#monotonicNow()),
      startedAt,
      attempts,
    );

    while (attempts < this.#maxAttempts) {
      if (this.#lifecycle.signal.aborted) {
        throw deliveryError(
          "NOTIFICATION_DELIVERY_CANCELLED",
          "cancelled",
          attempts,
        );
      }
      const remaining = this.#remainingBudget(startedAt);
      if (remaining <= 0) {
        throw deliveryError(
          "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
          "timeout",
          attempts,
        );
      }
      attempts += 1;
      const response = await this.#attempt(
        body,
        Math.min(this.#requestTimeoutMs, remaining),
        attempts,
      ).catch(async (error: unknown) => {
        if (
          error instanceof NotificationDeliveryError &&
          error.classification === "cancelled"
        ) {
          throw error;
        }
        if (attempts >= this.#maxAttempts) {
          throw deliveryError(
            error instanceof NotificationDeliveryError
              ? error.code
              : "NOTIFICATION_NETWORK_FAILED",
            error instanceof NotificationDeliveryError
              ? error.classification
              : "network",
            attempts,
          );
        }
        await this.#waitForRetry(startedAt, attempts);
        return undefined;
      });
      if (response === undefined) continue;
      if (this.#remainingBudget(startedAt) <= 0) {
        discardBody(response);
        throw deliveryError(
          "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
          "timeout",
          attempts,
        );
      }

      if (response.status >= 200 && response.status < 300) {
        this.#recordRateLimit(response);
        discardBody(response);
        return;
      }
      if (response.status === 429) {
        const bodyBudget = this.#remainingBudget(startedAt);
        if (bodyBudget <= 0) {
          discardBody(response);
          throw deliveryError(
            "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
            "timeout",
            attempts,
          );
        }
        const retryAfter = await retryAfterFromResponse(
          response,
          this.#lifecycle.signal,
          bodyBudget,
        );
        if (this.#lifecycle.signal.aborted) {
          throw deliveryError(
            "NOTIFICATION_DELIVERY_CANCELLED",
            "cancelled",
            attempts,
          );
        }
        if (this.#remainingBudget(startedAt) <= 0) {
          throw deliveryError(
            "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
            "timeout",
            attempts,
          );
        }
        if (retryAfter === undefined || attempts >= this.#maxAttempts) {
          throw deliveryError(
            "NOTIFICATION_RATE_LIMITED",
            "rate_limited",
            attempts,
            response.status,
          );
        }
        await this.#waitWithinBudget(retryAfter, startedAt, attempts);
        continue;
      }

      const retryableServerError = [500, 502, 503, 504].includes(
        response.status,
      );
      const classification =
        response.status >= 400 && response.status < 500
          ? "client_error"
          : "server_error";
      discardBody(response);
      if (!retryableServerError || attempts >= this.#maxAttempts) {
        throw deliveryError(
          retryableServerError
            ? "NOTIFICATION_SERVER_RETRIES_EXHAUSTED"
            : "NOTIFICATION_HTTP_REJECTED",
          classification,
          attempts,
          response.status,
        );
      }
      await this.#waitForRetry(startedAt, attempts);
    }
  }

  close(): void {
    this.#lifecycle.abort();
  }

  async #attempt(
    body: string,
    timeoutMs: number,
    attempts: number,
  ): Promise<Response> {
    if (this.#lifecycle.signal.aborted) {
      throw deliveryError(
        "NOTIFICATION_DELIVERY_CANCELLED",
        "cancelled",
        attempts,
      );
    }
    const controller = new AbortController();
    const attemptStartedAt = this.#monotonicNow();
    let timedOut = false;
    const onClose = (): void => controller.abort();
    this.#lifecycle.signal.addEventListener("abort", onClose, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let response: Response;
    try {
      response = await this.#transport(this.#webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
        redirect: "manual",
      });
    } catch {
      if (this.#lifecycle.signal.aborted) {
        throw deliveryError(
          "NOTIFICATION_DELIVERY_CANCELLED",
          "cancelled",
          attempts,
        );
      }
      if (timedOut) {
        throw deliveryError(
          "NOTIFICATION_ATTEMPT_TIMED_OUT",
          "timeout",
          attempts,
        );
      }
      throw deliveryError("NOTIFICATION_NETWORK_FAILED", "network", attempts);
    } finally {
      clearTimeout(timer);
      this.#lifecycle.signal.removeEventListener("abort", onClose);
    }
    if (this.#lifecycle.signal.aborted) {
      discardBody(response);
      throw deliveryError(
        "NOTIFICATION_DELIVERY_CANCELLED",
        "cancelled",
        attempts,
      );
    }
    if (timedOut || this.#monotonicNow() - attemptStartedAt >= timeoutMs) {
      discardBody(response);
      throw deliveryError(
        "NOTIFICATION_ATTEMPT_TIMED_OUT",
        "timeout",
        attempts,
      );
    }
    return response;
  }

  #recordRateLimit(response: Response): void {
    if (response.headers.get("X-RateLimit-Remaining") !== "0") return;
    const resetAfter = parseSeconds(
      response.headers.get("X-RateLimit-Reset-After"),
    );
    if (resetAfter !== undefined) {
      this.#nextAllowedAt = this.#monotonicNow() + resetAfter;
    }
  }

  #remainingBudget(startedAt: number): number {
    return this.#totalBudgetMs - (this.#monotonicNow() - startedAt);
  }

  async #waitForRetry(startedAt: number, attempts: number): Promise<void> {
    const baseDelay = 250 * 2 ** (attempts - 1);
    const jitter = this.#jitter(baseDelay);
    const safeJitter =
      Number.isFinite(jitter) && jitter >= 0 ? Math.floor(jitter) : 0;
    await this.#waitWithinBudget(baseDelay + safeJitter, startedAt, attempts);
  }

  async #waitWithinBudget(
    delayMs: number,
    startedAt: number,
    attempts: number,
  ): Promise<void> {
    if (this.#lifecycle.signal.aborted) {
      throw deliveryError(
        "NOTIFICATION_DELIVERY_CANCELLED",
        "cancelled",
        attempts,
      );
    }
    if (delayMs <= 0) return;
    const remaining = this.#remainingBudget(startedAt);
    if (!Number.isFinite(delayMs) || delayMs > remaining) {
      throw deliveryError(
        "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
        "timeout",
        attempts,
      );
    }
    try {
      await this.#wait(delayMs, this.#lifecycle.signal);
    } catch {
      if (this.#lifecycle.signal.aborted) {
        throw deliveryError(
          "NOTIFICATION_DELIVERY_CANCELLED",
          "cancelled",
          attempts,
        );
      }
      throw deliveryError("NOTIFICATION_WAIT_FAILED", "network", attempts);
    }
  }
}
