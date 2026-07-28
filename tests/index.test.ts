import { describe, expect, it } from "vitest";

import { healthPayload } from "../src/index.js";

describe("health endpoint", () => {
  it("returns a healthy service payload", () => {
    expect(healthPayload()).toEqual({
      service: "voxel-steward",
      status: "ok",
    });
  });
});
