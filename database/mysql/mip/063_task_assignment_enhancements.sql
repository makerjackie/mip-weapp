-- M02: Enhance mip_task_assignments with assign mode, recipients, weekly
-- scheduling window, and task version snapshot.

ALTER TABLE mip_task_assignments
  ADD COLUMN assign_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ALL' AFTER status,
  ADD COLUMN recipients_json JSON NULL AFTER assign_mode,
  ADD COLUMN weekly_deliver_at VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER recipients_json,
  ADD COLUMN weekly_start_at VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER weekly_deliver_at,
  ADD COLUMN weekly_end_at VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER weekly_start_at,
  ADD COLUMN task_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER version,
  ADD KEY mip_task_assignments_mode_idx (app_id, task_id, assign_mode, status, id),
  ADD CONSTRAINT mip_task_assignments_assign_mode_ck CHECK (
    assign_mode IN ('ALL', 'SELECTED', 'WEEKLY')
  );
