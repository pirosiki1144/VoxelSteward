ALTER TABLE notification_outbox
  DROP INDEX idx_notification_outbox_claim,
  DROP COLUMN lease_expires_at,
  DROP COLUMN lease_owner,
  DROP COLUMN next_attempt_at,
  DROP COLUMN max_delivery_attempts,
  ADD KEY idx_notification_outbox_pending (delivery_status, occurred_at);
