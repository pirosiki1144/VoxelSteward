import { spawnSync } from "node:child_process";
import process from "node:process";

const composeEnvironment = {
  ...process.env,
  BOT_ACCOUNT_ID: "compose-check",
  VOXEL_ENV_FILE: "/dev/null",
  MYSQL_DATABASE: "voxel_steward_check",
  MYSQL_USER: "voxel_check",
  MYSQL_PASSWORD: "voxel_check_password",
  MYSQL_ROOT_PASSWORD: "voxel_root_check_password",
};

const compose = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    "/dev/null",
    "-f",
    "compose.yaml",
    "-f",
    "compose.mysql.yaml",
    "-f",
    "compose.stg.yaml",
    "--profile",
    "scheduled",
    "config",
    "--format",
    "json",
  ],
  {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    env: composeEnvironment,
  },
);

if (compose.status !== 0) {
  process.stderr.write("staging runtime Compose configuration is invalid\n");
  process.exit(1);
}

let configuration;
try {
  configuration = JSON.parse(compose.stdout);
} catch {
  process.stderr.write("staging runtime Compose configuration is not JSON\n");
  process.exit(1);
}

const runtime = configuration.services?.runtime;
const scheduledRuntime = configuration.services?.["scheduled-runtime"];
const mysql = configuration.services?.mysql;
const environment = runtime?.environment;
const scheduledEnvironment = scheduledRuntime?.environment;
const authMount = runtime?.volumes?.find(
  (volume) => volume.target === "/auth/profiles",
);
const authVolume = configuration.volumes?.[authMount?.source];
const checks = [
  [runtime !== undefined, "runtime service is missing"],
  [mysql !== undefined, "mysql service is missing"],
  [scheduledRuntime !== undefined, "scheduled-runtime service is missing"],
  [runtime?.restart === "no", 'runtime restart policy must be "no"'],
  [runtime?.read_only === true, "runtime root filesystem must be read-only"],
  [runtime?.user === "node", "runtime must use the non-root node user"],
  [
    scheduledRuntime?.restart === "no",
    'scheduled-runtime restart policy must be "no"',
  ],
  [
    scheduledRuntime?.read_only === true,
    "scheduled-runtime root filesystem must be read-only",
  ],
  [
    scheduledRuntime?.user === "node",
    "scheduled-runtime must use the non-root node user",
  ],
  [environment?.BOT_MODE === "normal", "BOT_MODE must be fixed to normal"],
  [
    scheduledEnvironment?.BOT_MODE === "normal",
    "scheduled-runtime BOT_MODE must be fixed to normal",
  ],
  [
    environment?.MYSQL_PERSISTENCE_ENABLED === "true",
    "MySQL persistence must be enabled",
  ],
  [environment?.MYSQL_HOST === "mysql", "runtime must use mysql service"],
  [environment?.MYSQL_PORT === "3306", "runtime must use mysql port"],
  [
    scheduledEnvironment?.MYSQL_PERSISTENCE_ENABLED === "true",
    "scheduled-runtime MySQL persistence must be enabled",
  ],
  [
    authMount?.source === "auth-profiles",
    "the runtime authentication mount must be preserved",
  ],
  [
    authVolume?.name === "voxel-steward-stg-auth-compose-check",
    "the staging account-scoped authentication volume must be isolated",
  ],
  [
    scheduledRuntime?.volumes?.some(
      (volume) =>
        volume.target === "/auth/profiles" && volume.source === "auth-profiles",
    ),
    "the scheduled-runtime authentication mount must be preserved",
  ],
];

const failed = checks.find(([passed]) => !passed);
if (failed !== undefined) {
  process.stderr.write(`staging runtime check failed: ${failed[1]}\n`);
  process.exit(1);
}

process.stdout.write("staging runtime Compose configuration is valid\n");
