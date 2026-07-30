export type NotificationType =
  | "minecraft_connecting"
  | "minecraft_connected"
  | "minecraft_spawned"
  | "minecraft_disconnected"
  | "reconnect_started"
  | "runtime_stopped"
  | "stop_requested"
  | "runtime_failed"
  | "reconnect_exhausted"
  | "other_player_safety_stop"
  | "task_preparing"
  | "task_started"
  | "task_paused"
  | "task_resumed"
  | "task_completed"
  | "task_failed"
  | "task_stopped";

export type NotificationSeverity = "info" | "warning" | "error" | "critical";

export interface NotificationMessage {
  readonly notificationId: string;
  readonly sourceRevision: number;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly occurredAt: string;
  readonly title: string;
  readonly body: string;
}

export interface NotificationPort {
  send(message: NotificationMessage): Promise<void>;
}
