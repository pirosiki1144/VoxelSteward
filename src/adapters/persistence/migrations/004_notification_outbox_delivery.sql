ALTER TABLE notification_outbox
  ADD COLUMN max_delivery_attempts INT UNSIGNED NULL AFTER delivery_attempts,
  ADD COLUMN next_attempt_at DATETIME(3) NULL AFTER max_delivery_attempts,
  ADD COLUMN lease_owner VARCHAR(128) NULL AFTER next_attempt_at,
  ADD COLUMN lease_expires_at DATETIME(3) NULL AFTER lease_owner,
  DROP INDEX idx_notification_outbox_pending,
  ADD KEY idx_notification_outbox_claim
    (delivery_status, next_attempt_at, lease_expires_at, occurred_at, source_revision);
