import { pathToFileURL } from "node:url";

import { TaskQueueService } from "./application/task-queue/index.js";
import { parseOperatorTaskCommand } from "./application/operator-task/index.js";
import { taskRecoveryDisposition } from "./domain/task-queue/index.js";
import { createOperatorTaskBinding } from "./runtime/operator-task-binding.js";
import { loadPersistenceConfig } from "./runtime/persistence-config.js";

const write = (record: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};

export const runOperatorTask = async (
  argv: readonly string[],
): Promise<0 | 1> => {
  let binding:
    Awaited<ReturnType<typeof createOperatorTaskBinding>> | undefined;
  try {
    const command = parseOperatorTaskCommand(argv);
    binding = await createOperatorTaskBinding(loadPersistenceConfig());
    const service = new TaskQueueService(binding.repository);
    if (command.action === "enqueue") {
      const { item } = await service.dispatch({
        type: "task.enqueue",
        instruction: command.instruction,
      });
      write({
        event: "operator_task.enqueued",
        taskId: item?.taskId,
        status: item?.status,
      });
      return 0;
    }
    if (command.action === "cancel") {
      const { item } = await service.dispatch({
        type: "task.cancel",
        taskId: command.taskId,
      });
      write({
        event: "operator_task.cancelled",
        taskId: item?.taskId,
        status: item?.status,
      });
      return 0;
    }
    const item = await service.find(command.taskId);
    write(
      item === undefined
        ? { event: "operator_task.not_found" }
        : {
            event: "operator_task.status",
            taskId: item.taskId,
            taskType: item.taskType,
            status: item.status,
            attempts: item.attempts,
            recovery: taskRecoveryDisposition(item),
          },
    );
    return item === undefined ? 1 : 0;
  } catch (error) {
    write({
      event: "operator_task.error",
      code:
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "OPERATOR_TASK_FAILED",
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
  process.exitCode = await runOperatorTask(process.argv.slice(2));
}
