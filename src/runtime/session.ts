import { toSafeNotificationDeliveryFailure } from "../adapters/notifications/discord-webhook-notification-port.js";
import { toSafePersistenceFailure } from "../adapters/persistence/mysql-state-persistence-repository.js";
import {
  NotificationSubscriber,
  OutboxDispatcher,
} from "../application/notifications/index.js";
import { StatePersistenceSubscriber } from "../application/persistence/index.js";
import { SafetyControlledTaskQueue } from "../application/safety/index.js";
import { ReadonlyTaskExecutor } from "../application/task-executor/index.js";
import {
  auditTaskRecovery,
  TaskQueueService,
} from "../application/task-queue/index.js";
import { DefaultWorkSafetyPolicy } from "../domain/safety/index.js";
import type {
  ScheduleIntent,
  SchedulePhase,
} from "../domain/scheduler/index.js";
import { createStateStore, type StateStore } from "../domain/state/index.js";
import { InstanceLock } from "../infrastructure/instance-lock.js";
import type { Logger } from "../infrastructure/logger.js";
import type {
  ConnectionFactory,
  RuntimeConfig,
  RuntimeResult,
} from "./types.js";
import type { RuntimeStopReason } from "./types.js";
import type { NotificationConfig } from "./notification-config.js";
import type { PersistenceConfig } from "./persistence-config.js";
import { runCleanupSteps } from "./cleanup.js";
import {
  createDisabledRuntimeBlockOperationBinding,
  type RuntimeBlockOperationBinding,
} from "./block-operation-binding.js";
import {
  createDisabledRuntimeMovementBinding,
  type RuntimeMovementBinding,
} from "./movement-binding.js";
import {
  createRuntimeNotificationBinding,
  type RuntimeNotificationBinding,
} from "./notification-port-factory.js";
import {
  createRuntimePersistenceBinding,
  type RuntimePersistenceBinding,
} from "./persistence-binding.js";
import { RuntimeSupervisor } from "./supervisor.js";
import {
  createDisabledRuntimeWorldObservationBinding,
  type RuntimeWorldObservationBinding,
} from "./world-observation-binding.js";

const flushPersistence = async (
  persistence: StatePersistenceSubscriber,
): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      persistence.flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export interface RuntimeSession {
  readonly stateStore: StateStore;
  run(): Promise<RuntimeResult>;
  requestStop(
    reason: Extract<
      RuntimeStopReason,
      | "schedule_window_ended"
      | "signal_sigint"
      | "signal_sigterm"
      | "stop_requested"
    >,
  ): void;
  recordScheduleIntent(intent: ScheduleIntent, phase: SchedulePhase): void;
  close(): Promise<void>;
}

export interface RuntimeSessionOptions {
  readonly config: RuntimeConfig;
  readonly notificationConfig: NotificationConfig;
  readonly persistenceConfig: PersistenceConfig;
  readonly logger: Logger;
  readonly createConnection: ConnectionFactory;
}

export const createRuntimeSession = async (
  options: RuntimeSessionOptions,
): Promise<RuntimeSession> => {
  const { config, logger } = options;
  let notifications: NotificationSubscriber | undefined;
  let outboxDispatcher: OutboxDispatcher | undefined;
  let notificationBinding: RuntimeNotificationBinding | undefined;
  let persistence: StatePersistenceSubscriber | undefined;
  let persistenceBinding: RuntimePersistenceBinding | undefined;
  let movementBinding: RuntimeMovementBinding | undefined;
  let blockOperationBinding: RuntimeBlockOperationBinding | undefined;
  let worldObservationBinding: RuntimeWorldObservationBinding | undefined;
  let taskExecutor: ReadonlyTaskExecutor | undefined;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await runCleanupSteps(
      [
        { name: "outbox_dispatcher", run: () => outboxDispatcher?.stop() },
        { name: "task_executor", run: () => taskExecutor?.close() },
        { name: "notifications", run: () => notifications?.close() },
        {
          name: "persistence_flush",
          run: () =>
            persistence === undefined
              ? Promise.resolve()
              : flushPersistence(persistence),
        },
        { name: "persistence", run: () => persistence?.close() },
        {
          name: "notification_binding",
          run: () => notificationBinding?.close(),
        },
        { name: "movement_binding", run: () => movementBinding?.close() },
        {
          name: "block_operation_binding",
          run: () => blockOperationBinding?.close(),
        },
        {
          name: "world_observation_binding",
          run: () => worldObservationBinding?.close(),
        },
        {
          name: "persistence_binding",
          run: () => persistenceBinding?.close(),
        },
      ],
      (resource) => {
        logger.log("error", { event: "runtime.cleanup_failed", resource });
      },
    );
  };

  try {
    movementBinding = createDisabledRuntimeMovementBinding();
    blockOperationBinding = createDisabledRuntimeBlockOperationBinding();
    worldObservationBinding = createDisabledRuntimeWorldObservationBinding();
    notificationBinding = createRuntimeNotificationBinding(
      options.notificationConfig,
    );
    persistenceBinding = await createRuntimePersistenceBinding(
      options.persistenceConfig,
    );
    if (persistenceBinding.taskQueueRepository !== undefined) {
      const recoveredLeases =
        await persistenceBinding.taskQueueRepository.recoverExpiredClaims(
          new Date().toISOString(),
        );
      const recovery = await auditTaskRecovery(
        persistenceBinding.taskQueueRepository,
      );
      logger.log("info", {
        event: "persistence.task_recovery_audited",
        claimable: recovery.claimable,
        manualReview: recovery.manualReview,
        terminal: recovery.terminal,
        recoveredLeases,
      });
    }
    const stateStore = createStateStore({
      onSubscriberError: () => {
        logger.log("error", { event: "runtime.state_subscriber_failed" });
      },
    });
    const reportNotificationError = (
      error: unknown,
      message:
        | {
            readonly notificationId: string;
            readonly sourceRevision: number;
            readonly type: string;
          }
        | undefined,
    ): void => {
      const failure = toSafeNotificationDeliveryFailure(error);
      logger.log("error", {
        event: "notification.delivery_failed",
        code: failure.code,
        classification: failure.classification,
        attempts: failure.attempts,
        ...(failure.status === undefined ? {} : { status: failure.status }),
        ...(message === undefined
          ? {}
          : {
              notificationId: message.notificationId,
              sourceRevision: message.sourceRevision,
              notificationType: message.type,
            }),
      });
    };
    notifications = new NotificationSubscriber(notificationBinding.port, {
      onNotificationError: reportNotificationError,
    });
    if (!persistenceBinding.enabled) notifications.subscribe(stateStore);
    persistence = new StatePersistenceSubscriber(
      persistenceBinding.repository,
      persistenceBinding.runId,
      {
        onError: (error, event, attempts) => {
          const failure = toSafePersistenceFailure(error);
          logger.log("error", {
            event: "persistence.write_failed",
            code: failure.code,
            retryable: failure.retryable,
            revision: event.revision,
            attempts,
          });
        },
      },
    );
    persistence.subscribe(stateStore);
    if (persistenceBinding.taskQueueRepository !== undefined) {
      const taskQueue = new TaskQueueService(
        persistenceBinding.taskQueueRepository,
      );
      taskExecutor = new ReadonlyTaskExecutor({
        queue: taskQueue,
        safeQueue: new SafetyControlledTaskQueue(
          taskQueue,
          stateStore,
          new DefaultWorkSafetyPolicy(),
        ),
        stateStore,
        onError: (code) => {
          logger.log("error", { event: "task_executor.error", code });
        },
      });
      taskExecutor.start();
    }
    if (persistenceBinding.outboxRepository !== undefined) {
      outboxDispatcher = new OutboxDispatcher(
        persistenceBinding.outboxRepository,
        notificationBinding.port,
        {
          workerId: persistenceBinding.runId,
          toSafeErrorCode: (error) =>
            toSafeNotificationDeliveryFailure(error).code,
          onError: (error, record) =>
            reportNotificationError(error, record?.message),
        },
      );
      outboxDispatcher.start();
    }
    const supervisor = new RuntimeSupervisor(
      config,
      options.createConnection,
      logger,
      undefined,
      stateStore,
    );
    return {
      stateStore,
      run: () => supervisor.run(),
      requestStop: (reason) => supervisor.requestStop(reason),
      recordScheduleIntent: (intent, phase) => {
        try {
          stateStore.dispatch({
            type: "schedule.intent.record",
            intent,
            phase,
          });
        } catch {
          logger.log("error", {
            event: "runtime.state_update_failed",
            command: "schedule.intent.record",
          });
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};

export const createLockedRuntimeSession = async (
  options: RuntimeSessionOptions,
): Promise<RuntimeSession> => {
  const lock = new InstanceLock(
    options.config.authProfilesFolder,
    options.config.accountId,
  );
  await lock.acquire();
  let session: RuntimeSession;
  try {
    session = await createRuntimeSession(options);
  } catch (error) {
    await lock.release().catch(() => undefined);
    throw error;
  }
  let closed = false;
  return {
    stateStore: session.stateStore,
    run: () => session.run(),
    requestStop: (reason) => session.requestStop(reason),
    recordScheduleIntent: (intent, phase) =>
      session.recordScheduleIntent(intent, phase),
    close: async () => {
      if (closed) return;
      closed = true;
      try {
        await session.close();
      } finally {
        await lock.release();
      }
    },
  };
};
