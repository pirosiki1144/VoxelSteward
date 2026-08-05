import { spawnSync } from "node:child_process";
import process from "node:process";

const compose = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    "/dev/null",
    "-f",
    "compose.yaml",
    "-f",
    "compose.verification.yaml",
    "config",
    "--format",
    "json",
  ],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
);

if (compose.status !== 0) {
  process.stderr.write(
    "verification runtime Compose configuration is invalid\n",
  );
  process.exit(1);
}

let configuration;
try {
  configuration = JSON.parse(compose.stdout);
} catch {
  process.stderr.write(
    "verification runtime Compose configuration is not JSON\n",
  );
  process.exit(1);
}

const runtime = configuration.services?.runtime;
const environment = runtime?.environment;
const authMount = runtime?.volumes?.find(
  (volume) => volume.target === "/auth/profiles",
);
const authVolume = configuration.volumes?.[authMount?.source];
const checks = [
  [runtime !== undefined, "runtime service is missing"],
  [runtime?.restart === "no", 'runtime restart policy must be "no"'],
  [runtime?.read_only === true, "runtime root filesystem must be read-only"],
  [runtime?.user === "node", "runtime must use the non-root node user"],
  [environment?.BOT_MODE === "normal", "BOT_MODE must be fixed to normal"],
  [
    environment?.MYSQL_PERSISTENCE_ENABLED === "true",
    "MySQL persistence must be enabled",
  ],
  [
    authMount?.source === "auth-profiles",
    "the runtime authentication mount must be preserved",
  ],
  [
    authVolume?.name === "voxel-steward-auth-default",
    "the existing account-scoped authentication volume must be preserved",
  ],
];

const failed = checks.find(([passed]) => !passed);
if (failed !== undefined) {
  process.stderr.write(`verification runtime check failed: ${failed[1]}\n`);
  process.exit(1);
}

process.stdout.write("verification runtime Compose configuration is valid\n");
