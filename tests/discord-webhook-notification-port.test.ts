import { describe, expect, it, vi } from "vitest";

import {
  DiscordWebhookNotificationPort,
  NotificationDeliveryError,
  renderDiscordContent,
  toSafeNotificationDeliveryFailure,
  type AbortableWait,
  type HttpTransport,
} from "../src/adapters/notifications/discord-webhook-notification-port.js";
import type { NotificationMessage } from "../src/ports/notification-port.js";

const testWebhookUrl = new URL(
  "https://discord.com/api/webhooks/1234567890/TEST_ONLY_NON_SECRET",
);
const message: NotificationMessage = Object.freeze({
  notificationId: "state:2:minecraft_connecting",
  sourceRevision: 2,
  type: "minecraft_connecting",
  severity: "info",
  occurredAt: "2026-07-31T00:00:00.000Z",
  title: "Minecraftへ接続開始",
  body: "Minecraftへの読み取り専用接続を開始しました。",
});

interface Harness {
  readonly port: DiscordWebhookNotificationPort;
  readonly calls: { input: string | URL; init: RequestInit }[];
  readonly delays: number[];
  readonly advance: (milliseconds: number) => void;
}

const harness = (
  responses: Array<Response | Error>,
  overrides: {
    wait?: AbortableWait;
    jitter?: (base: number) => number;
  } = {},
): Harness => {
  let now = 0;
  const calls: { input: string | URL; init: RequestInit }[] = [];
  const delays: number[] = [];
  const transport: HttpTransport = (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    if (response === undefined) {
      return Promise.reject(new Error("unexpected transport call"));
    }
    return Promise.resolve(response);
  };
  const wait: AbortableWait =
    overrides.wait ??
    ((delayMs, signal) => {
      if (signal.aborted) return Promise.reject(new Error("aborted"));
      delays.push(delayMs);
      now += delayMs;
      return Promise.resolve();
    });
  return {
    port: new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 5_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
      transport,
      monotonicNow: () => now,
      wait,
      jitter: overrides.jitter ?? (() => 0),
    }),
    calls,
    delays,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
};

describe("DiscordWebhookNotificationPort", () => {
  it("POST、wait=true、JSON、mention無効化で2xx送信する", async () => {
    const setup = harness([new Response("{}", { status: 200 })]);
    await setup.port.send(message);

    expect(setup.calls).toHaveLength(1);
    expect(String(setup.calls[0]?.input)).toBe(
      `${testWebhookUrl.href}?wait=true`,
    );
    expect(setup.calls[0]?.init.method).toBe("POST");
    expect(setup.calls[0]?.init.headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(setup.calls[0]?.init.redirect).toBe("manual");
    const requestBody = setup.calls[0]?.init.body;
    if (typeof requestBody !== "string") {
      throw new Error("expected a string request body");
    }
    expect(JSON.parse(requestBody)).toEqual({
      content: renderDiscordContent(message),
      allowed_mentions: { parse: [] },
    });
  });

  it("contentは確定済みフィールドだけで決定論的に生成する", () => {
    const content = renderDiscordContent(message);
    expect(content).toContain(message.notificationId);
    expect(content).toContain(String(message.sourceRevision));
    expect(content).toContain(message.type);
    expect(content).toContain(message.severity);
    expect(content).toContain(message.occurredAt);
    expect(content).toContain(message.title);
    expect(content).toContain(message.body);
  });

  it("2,000文字を許可し2,001文字以上を通信前に拒否する", async () => {
    const fixedLength = renderDiscordContent({ ...message, body: "" }).length;
    const exact = { ...message, body: "a".repeat(2_000 - fixedLength) };
    expect(renderDiscordContent(exact)).toHaveLength(2_000);

    const setup = harness([new Response(null, { status: 204 })]);
    await expect(
      setup.port.send({ ...exact, body: `${exact.body}a` }),
    ).rejects.toMatchObject({
      code: "NOTIFICATION_CONTENT_TOO_LONG",
      classification: "configuration",
      attempts: 0,
    });
    expect(setup.calls).toHaveLength(0);
  });

  it.each([302, 400, 401, 403, 404, 418, 501])(
    "%iを再試行しない",
    async (status) => {
      const setup = harness([new Response(null, { status })]);
      await expect(setup.port.send(message)).rejects.toMatchObject({
        status,
        attempts: 1,
      });
      expect(setup.calls).toHaveLength(1);
    },
  );

  it.each([500, 502, 503, 504])("%iを250ms後に再試行する", async (status) => {
    const setup = harness([
      new Response(null, { status }),
      new Response(null, { status: 204 }),
    ]);
    await setup.port.send(message);
    expect(setup.calls).toHaveLength(2);
    expect(setup.delays).toEqual([250]);
  });

  it("通信失敗を最大3回、250msと500msで再試行する", async () => {
    const setup = harness([
      new Error("secret transport detail"),
      new Error("secret transport detail"),
      new Error("secret transport detail"),
    ]);
    await expect(setup.port.send(message)).rejects.toMatchObject({
      classification: "network",
      attempts: 3,
    });
    expect(setup.calls).toHaveLength(3);
    expect(setup.delays).toEqual([250, 500]);
  });

  it("各HTTP試行を5秒でtimeoutし最大3回に制限する", async () => {
    vi.useFakeTimers();
    try {
      const calls: AbortSignal[] = [];
      const port = new DiscordWebhookNotificationPort({
        webhookUrl: testWebhookUrl,
        requestTimeoutMs: 5_000,
        maxAttempts: 3,
        totalBudgetMs: 15_000,
        transport: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init.signal;
            if (!(signal instanceof AbortSignal)) {
              reject(new Error("missing signal"));
              return;
            }
            calls.push(signal);
            signal.addEventListener(
              "abort",
              () => reject(new Error("transport aborted")),
              { once: true },
            );
          }),
        monotonicNow: () => performance.now(),
        wait: () => Promise.resolve(),
        jitter: () => 0,
      });
      const delivery = port.send(message);
      const result = expect(delivery).rejects.toMatchObject({
        classification: "timeout",
        attempts: 3,
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await result;
      expect(calls).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("各HTTP試行timeoutを残り総予算まで短縮する", async () => {
    vi.useFakeTimers();
    try {
      let clockCalls = 0;
      let signal: AbortSignal | undefined;
      const port = new DiscordWebhookNotificationPort({
        webhookUrl: testWebhookUrl,
        requestTimeoutMs: 5_000,
        maxAttempts: 1,
        totalBudgetMs: 15_000,
        transport: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            signal =
              init.signal instanceof AbortSignal ? init.signal : undefined;
            signal?.addEventListener(
              "abort",
              () => reject(new Error("transport aborted")),
              { once: true },
            );
          }),
        monotonicNow: () => (clockCalls++ < 2 ? 0 : 12_000),
        wait: () => Promise.resolve(),
        jitter: () => 0,
      });
      const delivery = port.send(message);
      const result = expect(delivery).rejects.toMatchObject({
        classification: "timeout",
        attempts: 1,
      });
      await vi.advanceTimersByTimeAsync(2_999);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("jitterを決定論的に差し替える", async () => {
    const setup = harness(
      [
        new Response(null, { status: 503 }),
        new Response(null, { status: 204 }),
      ],
      { jitter: (base) => base / 10 },
    );
    await setup.port.send(message);
    expect(setup.delays).toEqual([275]);
  });

  it("Retry-After headerを小数秒としてJSONより優先する", async () => {
    const setup = harness([
      new Response('{"retry_after":9}', {
        status: 429,
        headers: { "Retry-After": "0.125" },
      }),
      new Response(null, { status: 204 }),
    ]);
    await setup.port.send(message);
    expect(setup.delays).toEqual([125]);
  });

  it("429 JSON retry_afterを秒からmsへ変換する", async () => {
    const setup = harness([
      new Response('{"retry_after":0.25}', { status: 429 }),
      new Response(null, { status: 204 }),
    ]);
    await setup.port.send(message);
    expect(setup.delays).toEqual([250]);
  });

  it.each([
    [null, "{}"],
    ["NaN", "{}"],
    ["-1", "{}"],
    ["999999999", "{}"],
    [null, "not-json"],
  ])("不正な429待機値を推測せず打ち切る", async (header, body) => {
    const setup = harness([
      new Response(body, {
        status: 429,
        ...(header === null ? {} : { headers: { "Retry-After": header } }),
      }),
    ]);
    await expect(setup.port.send(message)).rejects.toMatchObject({
      classification: "rate_limited",
      attempts: 1,
    });
    expect(setup.calls).toHaveLength(1);
  });

  it("429本文の16KiB上限超過を安全に破棄する", async () => {
    const setup = harness([
      new Response(`{"retry_after":1,"padding":"${"a".repeat(17_000)}"}`, {
        status: 429,
      }),
    ]);
    await expect(setup.port.send(message)).rejects.toMatchObject({
      classification: "rate_limited",
    });
  });

  it("成功時のrate limit headersで次通知を事前待機する", async () => {
    const setup = harness([
      new Response(null, {
        status: 204,
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset-After": "0.5",
        },
      }),
      new Response(null, { status: 204 }),
    ]);
    await setup.port.send(message);
    await setup.port.send({ ...message, notificationId: "state:3:test" });
    expect(setup.delays).toEqual([500]);
  });

  it("総予算を超える待機を開始しない", async () => {
    const setup = harness([
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "15.001" },
      }),
    ]);
    await expect(setup.port.send(message)).rejects.toMatchObject({
      code: "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
      attempts: 1,
    });
    expect(setup.delays).toHaveLength(0);
  });

  it("HTTP応答時間を含む残り総予算が不足すれば再試行しない", async () => {
    let now = 0;
    const calls: number[] = [];
    const port = new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 5_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
      monotonicNow: () => now,
      transport: () => {
        calls.push(now);
        now = 14_900;
        return Promise.resolve(new Response(null, { status: 503 }));
      },
      wait: () => {
        throw new Error("wait must not start");
      },
      jitter: () => 0,
    });
    await expect(port.send(message)).rejects.toMatchObject({
      code: "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
      attempts: 1,
    });
    expect(calls).toEqual([0]);
  });

  it("試行期限後に返った2xxを成功扱いしない", async () => {
    let now = 0;
    const port = new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 5_000,
      maxAttempts: 1,
      totalBudgetMs: 15_000,
      monotonicNow: () => now,
      transport: () => {
        now = 5_000;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      wait: () => Promise.resolve(),
      jitter: () => 0,
    });
    await expect(port.send(message)).rejects.toMatchObject({
      code: "NOTIFICATION_ATTEMPT_TIMED_OUT",
      classification: "timeout",
      attempts: 1,
    });
  });

  it("総期限後に返ったResponseを破棄し再試行しない", async () => {
    let now = 0;
    let calls = 0;
    const port = new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 20_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
      monotonicNow: () => now,
      transport: () => {
        calls += 1;
        now = 15_001;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
      wait: () => {
        throw new Error("wait must not start");
      },
      jitter: () => 0,
    });
    await expect(port.send(message)).rejects.toMatchObject({
      code: "NOTIFICATION_TOTAL_BUDGET_EXHAUSTED",
      classification: "timeout",
      attempts: 1,
    });
    expect(calls).toBe(1);
  });

  it("closeで待機を中断し、close後は通信しない", async () => {
    let rejectWait: (() => void) | undefined;
    const setup = harness(
      [
        new Response(null, { status: 503 }),
        new Response(null, { status: 204 }),
      ],
      {
        wait: (_delay, signal) =>
          new Promise<void>((_resolve, reject) => {
            rejectWait = () => reject(new Error("aborted"));
            signal.addEventListener("abort", rejectWait, { once: true });
          }),
      },
    );
    const delivery = setup.port.send(message);
    await vi.waitFor(() => expect(rejectWait).toBeTypeOf("function"));
    setup.port.close();
    await expect(delivery).rejects.toMatchObject({
      classification: "cancelled",
    });
    await expect(setup.port.send(message)).rejects.toMatchObject({
      classification: "cancelled",
      attempts: 0,
    });
    expect(setup.calls).toHaveLength(1);
  });

  it("closeで進行中fetchを中断する", async () => {
    let transportStarted = false;
    const port = new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 5_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
      transport: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          transportStarted = true;
          const signal = init.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("missing signal"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("transport aborted")),
            { once: true },
          );
        }),
      wait: () => Promise.resolve(),
      jitter: () => 0,
    });
    const delivery = port.send(message);
    const result = expect(delivery).rejects.toMatchObject({
      classification: "cancelled",
      attempts: 1,
    });
    await vi.waitFor(() => expect(transportStarted).toBe(true));
    port.close();
    await result;
  });

  it("close後にtransportがResponseを返しても本文を処理しない", async () => {
    let bodyCancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull: () => undefined,
        cancel: () => {
          bodyCancelled = true;
        },
      }),
      { status: 429 },
    );
    const port = new DiscordWebhookNotificationPort({
      webhookUrl: testWebhookUrl,
      requestTimeoutMs: 5_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
      transport: () => {
        port.close();
        return Promise.resolve(response);
      },
      wait: () => Promise.resolve(),
      jitter: () => 0,
    });
    await expect(port.send(message)).rejects.toMatchObject({
      classification: "cancelled",
      attempts: 1,
    });
    await Promise.resolve();
    expect(bodyCancelled).toBe(true);
  });

  it("429本文が16KiBを超えた時点でreaderをcancelする", async () => {
    let bodyCancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(16 * 1_024 + 1));
        },
        cancel: () => {
          bodyCancelled = true;
        },
      }),
      { status: 429 },
    );
    const setup = harness([response]);
    await expect(setup.port.send(message)).rejects.toMatchObject({
      classification: "rate_limited",
      attempts: 1,
    });
    expect(bodyCancelled).toBe(true);
  });

  it("安全なエラー投影へURL、生Error、cause、本文を含めない", async () => {
    const setup = harness([new Error(`failed ${testWebhookUrl.href}`)]);
    let captured: unknown;
    try {
      await setup.port.send(message);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(NotificationDeliveryError);
    const safe = toSafeNotificationDeliveryFailure(captured);
    expect(safe).toEqual({
      code: "NOTIFICATION_NETWORK_FAILED",
      classification: "network",
      attempts: 3,
    });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain(testWebhookUrl.href);
    expect(serialized).not.toContain("failed");
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
  });

  it("Fake transportだけを使用してglobal fetchへ接続しない", async () => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not be called"));
    const setup = harness([new Response(null, { status: 204 })]);
    await setup.port.send(message);
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });
});
