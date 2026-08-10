import { pathToFileURL } from "node:url";

import {
  parseOperatorLogCommand,
  type OperatorLogCommand,
} from "./application/operator-log/index.js";
import type { OperationalLogRepository } from "./ports/operational-log-repository.js";
import {
  createOperatorLogBinding,
  type OperatorLogBinding,
} from "./runtime/operator-log-binding.js";
import { loadPersistenceConfig } from "./runtime/persistence-config.js";

type Writer = (record: Readonly<Record<string, unknown>>) => void;
const stdout: Writer = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

const records = async (
  repository: OperationalLogRepository,
  command: OperatorLogCommand,
): Promise<readonly Readonly<Record<string, unknown>>[]> => {
  if (command.action === "runs") {
    return (await repository.listRuns(command.limit)).map((run) => ({
      event: "operator_log.run",
      ...run,
    }));
  }
  if (command.action === "status") {
    const run = await repository.findRun(command.runId);
    return [
      run === undefined
        ? { event: "operator_log.not_found" }
        : { event: "operator_log.status", ...run },
    ];
  }
  if (command.action === "history") {
    return (
      await repository.listHistory(
        command.runId,
        command.afterRevision,
        command.limit,
      )
    ).map((entry) => ({ event: "operator_log.history", ...entry }));
  }
  return (await repository.listCheckpoints(command.runId, command.limit)).map(
    (checkpoint) => ({
      event: "operator_log.checkpoint",
      ...checkpoint,
    }),
  );
};

export const runOperatorLog = async (
  argv: readonly string[],
  options: Readonly<{
    createBinding?: () => OperatorLogBinding;
    write?: Writer;
  }> = {},
): Promise<0 | 1> => {
  let binding: OperatorLogBinding | undefined;
  const write = options.write ?? stdout;
  try {
    const command = parseOperatorLogCommand(argv);
    binding =
      options.createBinding?.() ??
      createOperatorLogBinding(loadPersistenceConfig());
    const output = await records(binding.repository, command);
    for (const record of output) write(record);
    return output.some(({ event }) => event === "operator_log.not_found")
      ? 1
      : 0;
  } catch (error) {
    const candidate =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined;
    const code =
      candidate === "INVALID_OPERATOR_LOG_COMMAND" ||
      candidate === "OPERATOR_LOG_DATABASE_UNAVAILABLE" ||
      candidate === "OPERATIONAL_LOG_UNAVAILABLE"
        ? candidate
        : "OPERATOR_LOG_FAILED";
    write({
      event: "operator_log.error",
      code,
    });
    return 1;
  } finally {
    await binding?.close().catch(() => undefined);
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  process.exitCode = await runOperatorLog(process.argv.slice(2));
}
