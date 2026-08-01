import { describe, expect, it, vi } from "vitest";

import { runBlockPlacementAcceptancePreflight } from "../src/block-placement-acceptance.js";
import { loadBlockPlacementAcceptanceConfig } from "../src/runtime/block-placement-acceptance-config.js";

const enabledEnvironment = (): NodeJS.ProcessEnv => ({
  BLOCK_PLACEMENT_ACCEPTANCE_ENABLED: "true",
  BLOCK_PLACEMENT_OPERATOR_CONFIRMED: "true",
  BLOCK_PLACEMENT_MAX_ATTEMPTS: "1",
  BOT_MODE: "normal",
  MINECRAFT_VERSION: "1.26.30",
});

describe("block placement acceptance config", () => {
  it("未指定とfalseはdisabled", () => {
    expect(loadBlockPlacementAcceptanceConfig({})).toEqual({ enabled: false });
    expect(
      loadBlockPlacementAcceptanceConfig({
        BLOCK_PLACEMENT_ACCEPTANCE_ENABLED: "false",
      }),
    ).toEqual({ enabled: false });
  });

  it.each([
    { ...enabledEnvironment(), BLOCK_PLACEMENT_ACCEPTANCE_ENABLED: "TRUE" },
    { ...enabledEnvironment(), BOT_MODE: "debug" },
    { ...enabledEnvironment(), BLOCK_PLACEMENT_OPERATOR_CONFIRMED: "false" },
    { ...enabledEnvironment(), BLOCK_PLACEMENT_MAX_ATTEMPTS: "2" },
    { ...enabledEnvironment(), MINECRAFT_VERSION: "1.26.20" },
  ])("不正または安全条件不足の設定を拒否する", (environment) => {
    expect(() => loadBlockPlacementAcceptanceConfig(environment)).toThrowError(
      "Invalid block placement acceptance configuration",
    );
  });
});

describe("block placement acceptance preflight", () => {
  it("disabled時は副作用なしで正常終了する", async () => {
    const acquireInstanceLock = vi.fn();
    const createMinecraftClient = vi.fn();
    const createAuthenticationSession = vi.fn();
    const connectMinecraft = vi.fn();
    await expect(
      runBlockPlacementAcceptancePreflight(
        {},
        {
          acquireInstanceLock,
          createMinecraftClient,
          createAuthenticationSession,
          connectMinecraft,
        },
      ),
    ).resolves.toEqual({ outcome: "disabled", exitCode: 0 });
    expect(acquireInstanceLock).not.toHaveBeenCalled();
    expect(createMinecraftClient).not.toHaveBeenCalled();
    expect(createAuthenticationSession).not.toHaveBeenCalled();
    expect(connectMinecraft).not.toHaveBeenCalled();
  });

  it("unsupported capabilityはlock・client・接続より前に固定理由で停止する", async () => {
    const acquireInstanceLock = vi.fn();
    const createMinecraftClient = vi.fn();
    const createAuthenticationSession = vi.fn();
    const connectMinecraft = vi.fn();
    await expect(
      runBlockPlacementAcceptancePreflight(enabledEnvironment(), {
        acquireInstanceLock,
        createMinecraftClient,
        createAuthenticationSession,
        connectMinecraft,
      }),
    ).resolves.toEqual({
      outcome: "blocked",
      reason: "protocol_capability_unsupported",
      exitCode: 1,
    });
    expect(acquireInstanceLock).not.toHaveBeenCalled();
    expect(createMinecraftClient).not.toHaveBeenCalled();
    expect(createAuthenticationSession).not.toHaveBeenCalled();
    expect(connectMinecraft).not.toHaveBeenCalled();
  });
});
