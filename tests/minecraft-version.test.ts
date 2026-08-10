import { describe, expect, it } from "vitest";

import {
  MinecraftVersionConfigError,
  minecraftVersionErrorLogFields,
  resolveMinecraftVersion,
} from "../src/smoke/minecraft-version.js";
import { loadRuntimeConfig } from "../src/runtime/config.js";
import { loadSmokeConfig } from "../src/smoke/config.js";

const environment = {
  MINECRAFT_HOST: "test.invalid",
  BOT_ACCOUNT_ID: "test-bot",
};

const captureError = (action: () => unknown): unknown => {
  try {
    action();
    return undefined;
  } catch (error) {
    return error;
  }
};

describe("Minecraft version configuration", () => {
  it("未指定時はライブラリ自動選択を使用する", () => {
    expect(resolveMinecraftVersion(undefined)).toEqual({ source: "auto" });
  });

  it("短縮表記を正規化してサポート済みバージョンを選択する", () => {
    expect(resolveMinecraftVersion("26.30")).toEqual({
      version: "1.26.30",
      configuredVersion: "1.26.30",
      source: "environment",
    });
  });

  it("runtimeとsmokeが同じバージョン解決を使用する", () => {
    const runtime = loadRuntimeConfig({
      ...environment,
      MINECRAFT_VERSION: "1.26.30",
    });
    const smoke = loadSmokeConfig({
      ...environment,
      MINECRAFT_VERSION: "1.26.30",
    });
    expect(runtime.version).toBe("1.26.30");
    expect(runtime.versionSource).toBe("environment");
    expect(smoke.version).toBe(runtime.version);
    expect(smoke.versionSource).toBe(runtime.versionSource);
  });

  for (const value of ["v1.26.30", "1.26.30.1", "1.abc.30"]) {
    it(`不正な形式${value}を拒否する`, () => {
      const error = captureError(() => resolveMinecraftVersion(value));
      expect(error).toBeInstanceOf(MinecraftVersionConfigError);
      if (error instanceof MinecraftVersionConfigError) {
        expect(error.code).toBe("INVALID_MINECRAFT_VERSION");
      }
    });
  }

  it("ライブラリ未対応のバージョンを接続前に拒否する", () => {
    const error = captureError(() => resolveMinecraftVersion("1.26.40"));
    expect(error).toBeInstanceOf(MinecraftVersionConfigError);
    if (error instanceof MinecraftVersionConfigError) {
      expect(error.code).toBe("UNSUPPORTED_MINECRAFT_VERSION");
    }
  });

  it("設定エラーのログ項目へ入力値や例外を渡さない", () => {
    const error = new MinecraftVersionConfigError(
      "UNSUPPORTED_MINECRAFT_VERSION",
      "1.26.40",
    );
    expect(minecraftVersionErrorLogFields(error)).toEqual({
      code: "UNSUPPORTED_MINECRAFT_VERSION",
      configuredVersion: "1.26.40",
    });
    expect(minecraftVersionErrorLogFields(new Error("secret"))).toBeUndefined();
  });
});
