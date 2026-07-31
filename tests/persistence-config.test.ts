import { describe, expect, it } from "vitest";

import {
  InvalidPersistenceConfigError,
  loadPersistenceConfig,
} from "../src/runtime/persistence-config.js";

describe("loadPersistenceConfig", () => {
  it.each([undefined, "false"])("%sでは無効化する", (enabled) => {
    expect(
      loadPersistenceConfig({ MYSQL_PERSISTENCE_ENABLED: enabled }),
    ).toEqual({ enabled: false });
  });

  it("無効時は他のMySQL設定を検証しない", () => {
    expect(
      loadPersistenceConfig({
        MYSQL_PERSISTENCE_ENABLED: "false",
        MYSQL_PORT: "invalid",
        MYSQL_PASSWORD: "unused",
      }),
    ).toEqual({ enabled: false });
  });

  it("有効時は厳密な設定を返す", () => {
    expect(
      loadPersistenceConfig({
        MYSQL_PERSISTENCE_ENABLED: "true",
        MYSQL_HOST: "mysql-test",
        MYSQL_DATABASE: "voxel_test",
        MYSQL_USER: "test_user",
        MYSQL_PASSWORD: "test_password",
      }),
    ).toEqual({
      enabled: true,
      host: "mysql-test",
      port: 3306,
      database: "voxel_test",
      user: "test_user",
      password: "test_password",
      connectionTimeoutMs: 5000,
    });
  });

  it.each([
    { MYSQL_PERSISTENCE_ENABLED: "TRUE" },
    { MYSQL_PERSISTENCE_ENABLED: " true" },
    { MYSQL_PERSISTENCE_ENABLED: "true" },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: "db",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: "password",
      MYSQL_PORT: "0",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: " ",
      MYSQL_DATABASE: "db",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: "password",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: " ",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: "password",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: "db",
      MYSQL_USER: " ",
      MYSQL_PASSWORD: "password",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: "db",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: " ",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: "db",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: "password",
      MYSQL_PORT: "65536",
    },
    {
      MYSQL_PERSISTENCE_ENABLED: "true",
      MYSQL_HOST: "host",
      MYSQL_DATABASE: "db",
      MYSQL_USER: "user",
      MYSQL_PASSWORD: "password",
      MYSQL_CONNECTION_TIMEOUT_MS: "NaN",
    },
  ])("不正設定を安全な固定エラーで拒否する", (environment) => {
    expect(() => loadPersistenceConfig(environment)).toThrowError(
      InvalidPersistenceConfigError,
    );
    try {
      loadPersistenceConfig(environment);
    } catch (error) {
      expect(error).toMatchObject({
        code: "INVALID_MYSQL_PERSISTENCE_CONFIG",
        message: "MySQL persistence configuration is invalid",
      });
      expect(JSON.stringify(error)).not.toContain("password");
    }
  });
});
