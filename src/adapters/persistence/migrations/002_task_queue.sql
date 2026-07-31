CREATE TABLE task_queue (
  task_id VARCHAR(64) NOT NULL PRIMARY KEY,
  task_type VARCHAR(64) NOT NULL,
  priority TINYINT UNSIGNED NOT NULL,
  status ENUM('queued', 'claimed', 'completed', 'failed', 'stopped', 'cancelled') NOT NULL,
  attempts TINYINT UNSIGNED NOT NULL,
  max_attempts TINYINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  claimed_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  INDEX task_queue_claim_idx (status, priority DESC, created_at, task_id)
) ENGINE=InnoDB
