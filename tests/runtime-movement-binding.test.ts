import { describe, expect, it, vi } from "vitest";

import {
  createDisabledRuntimeMovementBinding,
  createRuntimeMovementBinding,
} from "../src/runtime/movement-binding.js";

describe("runtime movement binding", () => {
  it("is disabled by default and has no movement port", () => {
    const binding = createDisabledRuntimeMovementBinding();
    expect(binding.enabled).toBe(false);
    expect(binding.port).toBeUndefined();
    expect(() => binding.close()).not.toThrow();
  });

  it("closes an explicitly injected port once", () => {
    const stop = vi.fn();
    const binding = createRuntimeMovementBinding(() => ({
      move: vi.fn(),
      stop,
    }));
    expect(binding.enabled).toBe(true);
    binding.close();
    binding.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
