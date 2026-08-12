import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import process from "node:process";
import { join } from "node:path";

const root = process.cwd();
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "voxel-steward-compose-"),
);

const runConfiguration = (project, overlays, envFile) => {
  const files = overlays.flatMap((overlay) => ["-f", overlay]);
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "--env-file",
      envFile,
      "-f",
      "compose.yaml",
      ...files,
      "config",
      "--format",
      "json",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`${project} Compose configuration is invalid`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${project} Compose configuration is not JSON`);
  }
};

try {
  const base = readFileSync(join(root, "compose.yaml"), "utf8");
  if (base.includes("path: .env")) {
    throw new Error("base Compose must not reference a fixed .env file");
  }
  const developmentOverlay = readFileSync(
    join(root, "compose.dev.yaml"),
    "utf8",
  );
  const productionOverlay = readFileSync(
    join(root, "compose.prod.yaml"),
    "utf8",
  );
  if (
    !developmentOverlay.includes("VOXEL_ENV_FILE") ||
    !productionOverlay.includes("VOXEL_ENV_FILE") ||
    !developmentOverlay.includes("required: true") ||
    !productionOverlay.includes("required: true")
  ) {
    throw new Error("environment overlays must require explicit env files");
  }

  const developmentEnv = join(temporaryDirectory, "dev.env");
  const stagingEnv = join(temporaryDirectory, "stg.env");
  const productionEnv = join(temporaryDirectory, "prod.env");
  const values = (path) =>
    [
      "MINECRAFT_HOST=compose-check.invalid",
      "MINECRAFT_PORT=19132",
      "BOT_ACCOUNT_ID=compose-check",
      "MYSQL_PERSISTENCE_ENABLED=true",
      "MYSQL_DATABASE=voxel_steward_check",
      "MYSQL_USER=voxel_check",
      "MYSQL_PASSWORD=voxel_check_password",
      "MYSQL_ROOT_PASSWORD=voxel_root_check_password",
      "DISCORD_NOTIFICATIONS_ENABLED=false",
      `VOXEL_ENV_FILE=${path}`,
    ].join("\n");
  writeFileSync(developmentEnv, `${values(developmentEnv)}\n`);
  writeFileSync(stagingEnv, `${values(stagingEnv)}\n`);
  writeFileSync(productionEnv, `${values(productionEnv)}\n`);

  const development = runConfiguration(
    "voxelsteward-dev-check",
    ["compose.mysql.yaml", "compose.dev.yaml"],
    developmentEnv,
  );
  const staging = runConfiguration(
    "voxelsteward-stg-check",
    ["compose.mysql.yaml", "compose.stg.yaml"],
    stagingEnv,
  );
  const production = runConfiguration(
    "voxelsteward-prod-check",
    ["compose.mysql.yaml", "compose.prod.yaml"],
    productionEnv,
  );
  const developmentRuntime = development.services?.runtime;
  const productionRuntime = production.services?.runtime;
  const developmentMysql = development.services?.mysql;
  const productionMysql = production.services?.mysql;
  const stagingMysql = staging.services?.mysql;
  const stagingRuntime = staging.services?.runtime;
  const developmentVolume = development.volumes?.["auth-profiles"];
  const productionVolume = production.volumes?.["auth-profiles"];
  const checks = [
    [
      developmentRuntime?.environment?.VOXEL_ENV === "development",
      "development identity missing",
    ],
    [
      stagingRuntime?.environment?.VOXEL_ENV === "staging",
      "staging identity missing",
    ],
    [
      productionRuntime?.environment?.VOXEL_ENV === "production",
      "production identity missing",
    ],
    [
      developmentVolume?.name !== productionVolume?.name,
      "development and production volumes must differ",
    ],
    [
      developmentMysql?.image === productionMysql?.image,
      "development and production must use the same pinned MySQL image",
    ],
    [
      developmentRuntime?.environment?.MYSQL_HOST === "mysql" &&
        productionRuntime?.environment?.MYSQL_HOST === "mysql" &&
        developmentRuntime?.environment?.MYSQL_PORT === "3306" &&
        productionRuntime?.environment?.MYSQL_PORT === "3306",
      "runtime must use the environment-local MySQL service",
    ],
    [
      developmentMysql?.volumes?.[0]?.source === "mysql-data" &&
        productionMysql?.volumes?.[0]?.source === "mysql-data" &&
        development.volumes?.["mysql-data"]?.name ===
          "voxelsteward-dev-check_mysql-data" &&
        production.volumes?.["mysql-data"]?.name ===
          "voxelsteward-prod-check_mysql-data",
      "MySQL volume must be isolated by Compose project",
    ],
    [
      developmentMysql?.volumes?.some(
        (volume) =>
          volume.target === "/docker-entrypoint-initdb.d" &&
          volume.read_only === true &&
          volume.source.endsWith("/docker/mysql/init"),
      ),
      "MySQL initialization scripts must be mounted read-only",
    ],
    [
      stagingMysql?.image === developmentMysql?.image &&
        stagingRuntime?.environment?.MYSQL_DATABASE === "voxel_steward_check" &&
        stagingRuntime?.environment?.MYSQL_USER === "voxel_check" &&
        stagingRuntime?.environment?.MYSQL_HOST === "mysql",
      "staging must use the pinned MySQL service with its configured credentials",
    ],
    [
      developmentVolume?.name !== staging.volumes?.["auth-profiles"]?.name,
      "development and staging authentication volumes must differ",
    ],
    [
      staging.volumes?.["mysql-data"]?.name !==
        development.volumes?.["mysql-data"]?.name &&
        staging.volumes?.["mysql-data"]?.name !==
          production.volumes?.["mysql-data"]?.name,
      "development, staging, and production MySQL volumes must differ",
    ],
  ];
  const failed = checks.find(([passed]) => !passed);
  if (failed !== undefined)
    throw new Error(`environment Compose check failed: ${failed[1]}`);
  process.stdout.write(
    "development, staging, and production use isolated project-scoped resources\n",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
