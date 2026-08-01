ALTER TABLE task_queue
  DROP INDEX task_queue_lease_idx,
  DROP COLUMN claim_expires_at,
  DROP COLUMN claim_owner
