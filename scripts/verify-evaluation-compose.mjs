import { execFileSync } from "node:child_process";

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
  rendered.match(/  local-evaluation:[\s\S]*?(?=\n  [a-z][^ ]*:)/)?.[0] ?? "";
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
console.log("evaluation compose safety checks passed");
