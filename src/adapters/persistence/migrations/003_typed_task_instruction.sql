ALTER TABLE task_queue
  ADD COLUMN instruction_version SMALLINT UNSIGNED NULL AFTER max_attempts,
  ADD COLUMN instruction_json JSON NULL AFTER instruction_version,
  ADD COLUMN execution_phase ENUM('not_started', 'delivery_started', 'verified') NOT NULL DEFAULT 'not_started' AFTER instruction_json,
  ADD CONSTRAINT task_queue_instruction_pair_chk CHECK (
    (instruction_version IS NULL AND instruction_json IS NULL) OR
    (instruction_version IS NOT NULL AND instruction_json IS NOT NULL)
  )
