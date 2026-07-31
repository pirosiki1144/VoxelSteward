CREATE TABLE IF NOT EXISTS runtime_runs (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  started_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS state_snapshots (
  run_id CHAR(36) NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  snapshot_json JSON NOT NULL,
  CONSTRAINT fk_state_snapshots_run FOREIGN KEY (run_id) REFERENCES runtime_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS state_history (
  run_id CHAR(36) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  cause VARCHAR(64) NOT NULL,
  changed_fields_json JSON NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  PRIMARY KEY (run_id, revision),
  CONSTRAINT fk_state_history_run FOREIGN KEY (run_id) REFERENCES runtime_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS task_checkpoints (
  run_id CHAR(36) NOT NULL,
  task_id VARCHAR(128) NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  task_type VARCHAR(128) NOT NULL,
  task_state VARCHAR(32) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  checkpoint_json JSON NOT NULL,
  PRIMARY KEY (run_id, task_id),
  CONSTRAINT fk_task_checkpoints_run FOREIGN KEY (run_id) REFERENCES runtime_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notification_outbox (
  run_id CHAR(36) NOT NULL,
  notification_id VARCHAR(191) NOT NULL,
  source_revision BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body VARCHAR(2000) NOT NULL,
  delivery_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  delivered_at DATETIME(3) NULL,
  last_error_code VARCHAR(64) NULL,
  PRIMARY KEY (run_id, notification_id),
  KEY idx_notification_outbox_pending (delivery_status, occurred_at),
  CONSTRAINT fk_notification_outbox_run FOREIGN KEY (run_id) REFERENCES runtime_runs(run_id) ON DELETE CASCADE
) ENGINE=InnoDB;
