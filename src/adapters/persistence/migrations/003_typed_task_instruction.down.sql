ALTER TABLE task_queue
  DROP CHECK task_queue_instruction_pair_chk,
  DROP COLUMN execution_phase,
  DROP COLUMN instruction_json,
  DROP COLUMN instruction_version
