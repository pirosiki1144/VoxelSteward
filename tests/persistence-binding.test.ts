import { describe, expect, it } from "vitest";

import { createRuntimePersistenceBinding } from "../src/runtime/persistence-binding.js";
import { PersistenceError } from "../src/ports/state-persistence-repository.js";

describe("createRuntimePersistenceBinding", () => {
  it("無効時は外部接続なしのNo-op repositoryを返す", async () => {
    const binding = await createRuntimePersistenceBinding(
      { enabled: false },
      "2026-07-31T00:00:00.000Z",
    );
    expect(binding.enabled).toBe(false);
    await expect(
      binding.repository.initialize(binding.runId, "2026-07-31T00:00:00.000Z"),
    ).resolves.toBeUndefined();
    await expect(binding.close()).resolves.toBeUndefined();
  });

  it("driverの同期例外を秘密を含まない固定errorへ変換する", async () => {
    const result = createRuntimePersistenceBinding(
      {
        enabled: true,
        host: "db.invalid",
        port: 3306,
        database: "database",
        user: "user",
        password: "sensitive-test-value",
        connectionTimeoutMs: 5000,
      },
      "2026-07-31T00:00:00.000Z",
      () => {
        throw new Error("sensitive-test-value");
      },
    );
    await expect(result).rejects.toEqual(
      new PersistenceError("PERSISTENCE_FATAL", false),
    );
    await result.catch((error: unknown) => {
      expect(JSON.stringify(error)).not.toContain("sensitive-test-value");
    });
  });
});
