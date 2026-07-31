import { describe, expect, it, vi } from "vitest";

import { WorldObservationStore } from "../src/domain/world-observation/index.js";
import {
  createDisabledRuntimeWorldObservationBinding,
  createRuntimeWorldObservationBinding,
} from "../src/runtime/world-observation-binding.js";

describe("runtime world observation binding", () => {
  it("is read-only and disabled by default", () => {
    const binding = createDisabledRuntimeWorldObservationBinding();
    expect(binding.enabled).toBe(false);
    expect(binding.port.getSnapshot().availability).toBe("disconnected");
    binding.close();
    binding.close();
  });

  it("closes an explicitly injected observation port once", () => {
    const store = new WorldObservationStore();
    const close = vi.spyOn(store, "close");
    const binding = createRuntimeWorldObservationBinding(() => store);
    expect(binding.enabled).toBe(true);
    binding.close();
    binding.close();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
