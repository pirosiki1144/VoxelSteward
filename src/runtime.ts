import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { NotificationSubscriber } from "./application/notifications/index.js";
import { StatePersistenceSubscriber } from "./application/persistence/index.js";
import { toSafeNotificationDeliveryFailure } from "./adapters/notifications/discord-webhook-notification-port.js";
import { toSafePersistenceFailure } from "./adapters/persistence/mysql-state-persistence-repository.js";
import { createStateStore } from "./domain/state/index.js";
import { InstanceLock } from "./infrastructure/instance-lock.js";
import { createLogger } from "./infrastructure/logger.js";
import type { Logger } from "./infrastructure/logger.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { runCleanupSteps } from "./runtime/cleanup.js";
import {
  createDisabledRuntimeBlockOperationBinding,
  type RuntimeBlockOperationBinding,
} from "./runtime/block-operation-binding.js";
import { loadNotificationConfig } from "./runtime/notification-config.js";
import { loadPersistenceConfig } from "./runtime/persistence-config.js";
import {
  createDisabledRuntimeMovementBinding,
  type RuntimeMovementBinding,
} from "./runtime/movement-binding.js";
import {
  createRuntimePersistenceBinding,
  type RuntimePersistenceBinding,
} from "./runtime/persistence-binding.js";
import {
  createRuntimeNotificationBinding,
  type RuntimeNotificationBinding,
} from "./runtime/notification-port-factory.js";
import { RuntimeSupervisor } from "./runtime/supervisor.js";
import {
  createDisabledRuntimeWorldObservationBinding,
  type RuntimeWorldObservationBinding,
} from "./runtime/world-observation-binding.js";

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

const main = async (): Promise<void> => {
  let lock: InstanceLock | undefined;
  let notifications: NotificationSubscriber | undefined;
  let notificationBinding: RuntimeNotificationBinding | undefined;
  let persistence: StatePersistenceSubscriber | undefined;
  let persistenceBinding: RuntimePersistenceBinding | undefined;
  let runtimeLogger: Logger | undefined;
  let movementBinding: RuntimeMovementBinding | undefined;
  let blockOperationBinding: RuntimeBlockOperationBinding | undefined;
  let worldObservationBinding: RuntimeWorldObservationBinding | undefined;
  let removeSignals = (): void => undefined;
  try {
    const notificationConfig = loadNotificationConfig();
    const persistenceConfig = loadPersistenceConfig();
    const config = loadRuntimeConfig();
    movementBinding = createDisabledRuntimeMovementBinding();
    blockOperationBinding = createDisabledRuntimeBlockOperationBinding();
    worldObservationBinding = createDisabledRuntimeWorldObservationBinding();
    const logger = createLogger(config.mode, config.logLevel);
    runtimeLogger = logger;
    notificationBinding = createRuntimeNotificationBinding(notificationConfig);
    lock = new InstanceLock(config.authProfilesFolder, config.accountId);
    await lock.acquire();
    persistenceBinding =
      await createRuntimePersistenceBinding(persistenceConfig);

    const stateStore = createStateStore({
      onSubscriberError: () => {
        logger.log("error", { event: "runtime.state_subscriber_failed" });
      },
    });
    notifications = new NotificationSubscriber(notificationBinding.port, {
      onNotificationError: (error, message) => {
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
      },
    });
    notifications.subscribe(stateStore);
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
    const supervisor = new RuntimeSupervisor(
      config,
      () => new BedrockReadonlyConnection(config, logger),
      logger,
      undefined,
      stateStore,
    );
    const onSigint = () => {
      logger.log("info", { event: "signal.received", signal: "SIGINT" });
      supervisor.requestStop("signal_sigint");
    };
    const onSigterm = () => {
      logger.log("info", { event: "signal.received", signal: "SIGTERM" });
      supervisor.requestStop("signal_sigterm");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    removeSignals = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    const result = await supervisor.run();
    process.exitCode = result.exitCode;
  } catch (error) {
    const logger = createLogger("normal", "info");
    logger.log("error", {
      event: "runtime.error",
      reason: "startup_error",
      error: error instanceof Error ? error.message : "unknown startup error",
      outcome: "abnormal",
      exitCode: 1,
    });
    logger.log("error", {
      event: "runtime.finished",
      reason: "startup_error",
      outcome: "abnormal",
      exitCode: 1,
    });
    process.exitCode = 1;
  } finally {
    await runCleanupSteps(
      [
        { name: "notifications", run: () => notifications?.close() },
        {
          name: "notification_binding",
          run: () => notificationBinding?.close(),
        },
        { name: "signals", run: removeSignals },
        { name: "movement_binding", run: () => movementBinding?.close() },
        {
          name: "block_operation_binding",
          run: () => blockOperationBinding?.close(),
        },
        {
          name: "world_observation_binding",
          run: () => worldObservationBinding?.close(),
        },
        { name: "persistence", run: () => persistence?.close() },
        {
          name: "persistence_flush",
          run: () =>
            persistence === undefined
              ? Promise.resolve()
              : flushPersistence(persistence),
        },
        {
          name: "persistence_binding",
          run: () => persistenceBinding?.close(),
        },
        { name: "instance_lock", run: () => lock?.release() },
      ],
      (resource) => {
        runtimeLogger?.log("error", {
          event: "runtime.cleanup_failed",
          resource,
        });
      },
    );
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  await main();
}
