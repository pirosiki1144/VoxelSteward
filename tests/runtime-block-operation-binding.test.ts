import { describe, expect, it, vi } from "vitest";

import { createDisabledRuntimeBlockOperationBinding } from "../src/runtime/block-operation-binding.js";

describe("runtime block operation binding", () => {
  it("既定でunsupportedかつdisabledで外部通信しない", async () => {
    const binding = createDisabledRuntimeBlockOperationBinding();
    expect(binding.enabled).toBe(false);
    expect(binding.port.capability).toBe("unsupported");
    await expect(
      binding.port.observe(
        { x: 0, y: 71, z: 0, dimension: "overworld" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });

  it("closeを複数回安全に呼べる", () => {
    const binding = createDisabledRuntimeBlockOperationBinding();
    const stop = vi.spyOn(binding.port, "stop");
    binding.close();
    binding.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
