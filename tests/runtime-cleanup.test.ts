import { describe, expect, it, vi } from "vitest";

import { runCleanupSteps } from "../src/runtime/cleanup.js";

describe("runCleanupSteps", () => {
  it("各cleanup障害を隔離して後続stepを実行する", async () => {
    const order: string[] = [];
    const onFailure = vi.fn();
    await expect(
      runCleanupSteps(
        [
          {
            name: "first",
            run: () => {
              order.push("first");
              throw new Error("unsafe detail");
            },
          },
          {
            name: "second",
            run: async () => {
              order.push("second");
              await Promise.reject(new Error("unsafe async detail"));
            },
          },
          {
            name: "third",
            run: () => {
              order.push("third");
            },
          },
        ],
        onFailure,
      ),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["first", "second", "third"]);
    expect(onFailure.mock.calls).toEqual([["first"], ["second"]]);
  });
});
