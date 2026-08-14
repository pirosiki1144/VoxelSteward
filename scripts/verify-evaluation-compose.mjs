import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const composeFiles = [
  "-f",
  "compose.yaml",
  "-f",
  "compose.mysql.yaml",
  "-f",
  "compose.dev.yaml",
];
const productionOverlay = readFileSync("compose.prod.yaml", "utf8");
if (
  productionOverlay.includes("evaluation-minecraft") ||
  productionOverlay.includes("runtime-evaluation") ||
  productionOverlay.includes("evaluation-world")
) {
  throw new Error(
    "production overlay must not include Minecraft evaluation services",
  );
}
const temporaryDirectory = mkdtempSync(join(tmpdir(), "voxelsteward-eval-"));
const environmentFile = join(temporaryDirectory, "check.env");
writeFileSync(
  environmentFile,
  "BOT_ACCOUNT_ID=compose-check\nVOXEL_EVALUATION_ID=default\nMYSQL_DATABASE=compose_check\nMYSQL_USER=compose_check\nMYSQL_PASSWORD=compose_check\nMYSQL_ROOT_PASSWORD=compose_check\n",
);

const render = (profile) =>
  JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        ...composeFiles,
        "--env-file",
        environmentFile,
        "--profile",
        profile,
        "config",
        "--format",
        "json",
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    ),
  );

execFileSync(
  "docker",
  [
    "compose",
    ...composeFiles,
    "--env-file",
    environmentFile,
    "--profile",
    "evaluation",
    "config",
    "--quiet",
  ],
  { stdio: "inherit" },
);

const offline = render("evaluation");
const offlineService = offline.services?.["local-evaluation"];
if (
  offlineService === undefined ||
  offlineService.network_mode !== "none" ||
  offlineService.restart !== "no" ||
  offlineService.environment?.EVALUATION_MODE !== "local"
) {
  throw new Error("offline evaluation safety settings are incomplete");
}
if (
  offlineService.volumes?.some((volume) => volume.target === "/auth/profiles")
) {
  throw new Error("offline evaluation must not mount authentication volume");
}

const minecraft = render("evaluation-minecraft");
const minecraftService = minecraft.services?.minecraft;
const evaluationRuntime = minecraft.services?.["runtime-evaluation"];
const worldVolume = minecraft.volumes?.["evaluation-world"];
const authVolume = minecraft.volumes?.["evaluation-auth-profiles"];
if (minecraftService === undefined || evaluationRuntime === undefined) {
  throw new Error("Minecraft evaluation services are incomplete");
}
if (
  !minecraftService.image.startsWith("itzg/minecraft-bedrock-server@sha256:") ||
  minecraftService.environment?.VERSION !== "1.26.43.1" ||
  minecraftService.environment?.LEVEL_NAME !== "VoxelStewardLocal" ||
  minecraftService.environment?.GAMEMODE !== "survival" ||
  minecraftService.environment?.DIFFICULTY !== "normal" ||
  minecraftService.environment?.HARDCORE !== "false" ||
  !minecraftService.environment?.CUSTOM_SERVER_PROPERTIES.includes(
    "showcoordinates=true",
  ) ||
  evaluationRuntime.environment?.MINECRAFT_HOST !== "minecraft" ||
  minecraftService.restart !== "no" ||
  evaluationRuntime.restart !== "no" ||
  evaluationRuntime.depends_on?.minecraft?.condition !== "service_healthy" ||
  worldVolume?.name !== "voxelsteward-evaluation-world-default" ||
  authVolume?.name !== "voxelsteward-evaluation-auth-default"
) {
  throw new Error("Minecraft evaluation settings are incomplete");
}
if (
  minecraftService.volumes?.some(
    (volume) =>
      volume.target === "/auth/profiles" || volume.source === "mysql-data",
  )
) {
  throw new Error(
    "Minecraft evaluation must not reuse runtime or MySQL volumes",
  );
}

process.stdout.write(
  "evaluation Compose safety and local-world checks passed\n",
);
rmSync(temporaryDirectory, { recursive: true, force: true });
