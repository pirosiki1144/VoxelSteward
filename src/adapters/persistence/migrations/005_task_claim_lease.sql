ALTER TABLE task_queue
  ADD COLUMN claim_owner VARCHAR(64) NULL AFTER claimed_at,
  ADD COLUMN claim_expires_at DATETIME(3) NULL AFTER claim_owner,
  ADD INDEX task_queue_lease_idx (status, claim_expires_at)
