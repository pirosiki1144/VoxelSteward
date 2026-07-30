import type { StateChangeEvent, TaskState } from "../../domain/state/index.js";
import type {
  NotificationMessage,
  NotificationSeverity,
  NotificationType,
} from "../../ports/notification-port.js";

interface Template {
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
}

const messageFrom = (
  event: StateChangeEvent,
  template: Template,
): NotificationMessage =>
  Object.freeze({
    notificationId: `state:${event.revision}:${template.type}`,
    sourceRevision: event.revision,
    type: template.type,
    severity: template.severity,
    occurredAt: event.occurredAt,
    title: template.title,
    body: template.body,
  });

const taskTemplate = (
  before: TaskState,
  after: TaskState,
): Template | undefined => {
  if (before === after) return undefined;
  if (after === "preparing") {
    return {
      type: "task_preparing",
      severity: "info",
      title: "作業準備を開始",
      body: "作業の準備状態へ移行しました。",
    };
  }
  if (after === "running") {
    return before === "paused"
      ? {
          type: "task_resumed",
          severity: "info",
          title: "作業を再開",
          body: "一時停止していた作業を再開しました。",
        }
      : {
          type: "task_started",
          severity: "info",
          title: "作業を開始",
          body: "準備が完了し、作業を開始しました。",
        };
  }
  if (after === "paused") {
    return {
      type: "task_paused",
      severity: "warning",
      title: "作業を一時停止",
      body: "作業を一時停止しました。",
    };
  }
  if (after === "completed") {
    return {
      type: "task_completed",
      severity: "info",
      title: "作業が完了",
      body: "作業が正常に完了しました。",
    };
  }
  if (after === "failed") {
    return {
      type: "task_failed",
      severity: "error",
      title: "作業が失敗",
      body: "作業を正常に完了できませんでした。",
    };
  }
  if (after === "stopped") {
    return {
      type: "task_stopped",
      severity: "warning",
      title: "作業を停止",
      body: "作業を安全に停止しました。",
    };
  }
  return undefined;
};

export const mapStateChangeToNotification = (
  event: StateChangeEvent,
): NotificationMessage | undefined => {
  const { before, after } = event;
  const errorChanged =
    before.lastError?.code !== after.lastError?.code ||
    before.lastError?.message !== after.lastError?.message ||
    before.lastError?.occurredAt !== after.lastError?.occurredAt;
  let template: Template | undefined;

  if (
    !before.minecraft.otherPlayerDetected &&
    after.minecraft.otherPlayerDetected
  ) {
    template = {
      type: "other_player_safety_stop",
      severity: "critical",
      title: "他プレイヤー検知による安全停止",
      body: "他プレイヤーを検知したため、安全切断を開始しました。",
    };
  } else if (errorChanged && after.lastError?.code === "reconnect_exhausted") {
    template = {
      type: "reconnect_exhausted",
      severity: "error",
      title: "再接続上限に到達",
      body: "再接続の上限回数に到達したため、通常運転を終了します。",
    };
  } else if (errorChanged && after.lastError !== undefined) {
    template = {
      type: "runtime_failed",
      severity: "error",
      title: "通常運転で回復不能なエラー",
      body: "回復不能なエラーにより通常運転を終了します。",
    };
  } else if (
    before.stopReason !== after.stopReason &&
    (after.stopReason === "signal_sigint" ||
      after.stopReason === "signal_sigterm" ||
      after.stopReason === "stop_requested")
  ) {
    template = {
      type: "stop_requested",
      severity: "info",
      title: "通常運転の停止要求",
      body: "シグナルまたは明示的な停止要求を受け付けました。",
    };
  } else if (
    before.runtime !== "reconnecting" &&
    after.runtime === "reconnecting"
  ) {
    template = {
      type: "reconnect_started",
      severity: "warning",
      title: "Minecraftへ再接続",
      body: "一時的な切断後の再接続処理を開始しました。",
    };
  } else if (
    before.minecraft.connection === "disconnected" &&
    after.minecraft.connection === "connecting"
  ) {
    template = {
      type: "minecraft_connecting",
      severity: "info",
      title: "Minecraftへ接続開始",
      body: "Minecraftへの読み取り専用接続を開始しました。",
    };
  } else if (
    before.minecraft.connection === "connecting" &&
    after.minecraft.connection === "connected"
  ) {
    template = {
      type: "minecraft_connected",
      severity: "info",
      title: "Minecraftへ接続完了",
      body: "Minecraftへのloginが完了しました。",
    };
  } else if (
    !before.minecraft.spawnCompleted &&
    after.minecraft.spawnCompleted
  ) {
    template = {
      type: "minecraft_spawned",
      severity: "info",
      title: "Minecraftでspawn完了",
      body: "spawnが完了し、読み取り専用の待機状態へ移行しました。",
    };
  } else if (
    before.minecraft.connection !== "disconnected" &&
    after.minecraft.connection === "disconnected" &&
    (after.runtime === "connecting" || after.runtime === "ready")
  ) {
    template = {
      type: "minecraft_disconnected",
      severity: "warning",
      title: "Minecraft接続が一時切断",
      body: "Minecraftとの接続が一時的に切断されました。",
    };
  } else if (
    before.runtime !== "stopped" &&
    after.runtime === "stopped" &&
    after.stopReason !== "other_player_detected"
  ) {
    template = {
      type: "runtime_stopped",
      severity: "info",
      title: "通常運転を終了",
      body: "通常運転を安全に終了しました。",
    };
  } else {
    template = taskTemplate(before.task.state, after.task.state);
  }

  return template === undefined ? undefined : messageFrom(event, template);
};
