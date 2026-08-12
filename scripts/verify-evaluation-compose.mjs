import { execFileSync } from "node:child_process";
import process from "node:process";

const compose = [
  "-f",
  "compose.yaml",
  "-f",
  "compose.evaluation.yaml",
  "--env-file",
  "/dev/null",
  "--profile",
  "evaluation",
  "config",
  "--quiet",
];

execFileSync("docker", ["compose", ...compose], {
  stdio: "inherit",
});

const minecraftCompose = [
  "-f",
  "compose.yaml",
  "-f",
  "compose.evaluation.yaml",
  "--env-file",
  "/dev/null",
  "--profile",
  "evaluation-minecraft",
  "config",
];
const minecraftRendered = execFileSync(
  "docker",
  ["compose", ...minecraftCompose],
  {
    encoding: "utf8",
  },
);
const requiredMinecraftServices = [
  "bds-evaluation:",
  "mysql-evaluation:",
  "runtime-evaluation:",
];
if (
  !requiredMinecraftServices.every((value) => minecraftRendered.includes(value))
) {
  throw new Error("Minecraft evaluation Compose services are incomplete");
}
const requiredMinecraftSettings = [
  "condition: service_healthy",
  "voxel-steward-evaluation-world-",
  "voxel-steward-evaluation-auth-",
  "MINECRAFT_HOST: bds-evaluation",
  "MYSQL_HOST: mysql-evaluation",
];
if (
  !requiredMinecraftSettings.every((value) => minecraftRendered.includes(value))
) {
  throw new Error("Minecraft evaluation isolation settings are incomplete");
}

const rendered = execFileSync(
  "docker",
  [
    "compose",
    "-f",
    "compose.yaml",
    "-f",
    "compose.evaluation.yaml",
    "--env-file",
    "/dev/null",
    "--profile",
    "evaluation",
    "config",
  ],
  { encoding: "utf8" },
);

const required = [
  "local-evaluation:",
  "network_mode: none",
  "EVALUATION_MODE: local",
];
if (!required.every((value) => rendered.includes(value))) {
  throw new Error("Evaluation Compose safety settings are incomplete");
}
const evaluationBlock =
  rendered.match(
    /\x20{2}local-evaluation:[\s\S]*?(?=\n\x20{2}[a-z][^\x20]*:)/,
  )?.[0] ?? "";
if (
  !evaluationBlock.includes("restart: 'no'") ||
  !evaluationBlock.includes("network_mode: none")
) {
  throw new Error(
    "Evaluation service restart or network safety setting is incomplete",
  );
}
if (evaluationBlock.includes("target: /auth/profiles")) {
  throw new Error("Evaluation service must not mount authentication volume");
}
process.stdout.write("evaluation compose safety checks passed\n");
