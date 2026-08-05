import { describe, expect, it } from "vitest";

import { loadSchedulerRuntimeConfig } from "../src/runtime/scheduler-config.js";

describe("scheduler runtime config", () => {
  it("poll間隔の既定値と有限範囲を検証する", () => {
    expect(loadSchedulerRuntimeConfig({})).toEqual({ pollIntervalMs: 1_000 });
    expect(
      loadSchedulerRuntimeConfig({ SCHEDULER_POLL_INTERVAL_MS: "250" }),
    ).toEqual({ pollIntervalMs: 250 });
  });

  it.each(["0", "99", "60001", "1.5", "invalid"])(
    "不正なpoll間隔を拒否する: %s",
    (value) => {
      expect(() =>
        loadSchedulerRuntimeConfig({ SCHEDULER_POLL_INTERVAL_MS: value }),
      ).toThrow();
    },
  );
});
