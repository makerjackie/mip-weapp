-- Runtime completion of the 061-063 contract. Existing ownerless tasks retain
-- their legacy immediate reward behavior; configured tasks require review.
ALTER TABLE mip_task_cards
  MODIFY COLUMN assigned_owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY COLUMN period_start_at DATETIME(3) NULL,
  ADD COLUMN period_end_at DATETIME(3) NULL,
  ADD COLUMN applicable_servers_json JSON NULL;

ALTER TABLE mip_task_completions
  DROP CHECK mip_task_completions_submission_status_ck,
  DROP INDEX mip_task_completions_once_uk,
  ADD COLUMN occurrence_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'once',
  ADD UNIQUE KEY mip_task_completions_once_uk (app_id, task_id, user_id, occurrence_key),
  DROP CHECK mip_task_completions_result_ck,
  DROP CHECK mip_task_completions_growth_pair_ck,
  MODIFY COLUMN reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN assigned_owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN reward_config_snapshot_json JSON NULL,
  ADD COLUMN star_level_snapshot TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN reviewed_at DATETIME(3) NULL,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT mip_task_completions_submission_status_ck CHECK (
    submission_status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETRY_PENDING',
      'pending_review', 'approved', 'rejected', 'reward_failed')
  ),
  ADD CONSTRAINT mip_task_completions_result_ck CHECK (result_status IN ('PENDING', 'SUCCESS', 'FAILED')),
  ADD CONSTRAINT mip_task_completions_growth_pair_ck CHECK (
    (result_status = 'SUCCESS' AND (
      (reward_experience = 0 AND growth_entry_id IS NULL)
      OR (reward_experience > 0 AND growth_entry_id IS NOT NULL)
    )) OR (result_status IN ('PENDING', 'FAILED') AND growth_entry_id IS NULL)
  );

-- Old imported rows without a provable tenant stay inaccessible (app_id NULL).
-- New writes always carry the trusted caller app_id and UUID identifiers.
ALTER TABLE mip_task_submission_reviews
  MODIFY COLUMN submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN reviewed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN result_json JSON NULL,
  ADD KEY mip_task_submission_reviews_app_idx (app_id, submission_id, created_at, review_id);

ALTER TABLE mip_task_assignments
  DROP CHECK mip_task_assignments_assign_mode_ck,
  MODIFY COLUMN weekly_start_at DATETIME(3) NULL,
  MODIFY COLUMN weekly_end_at DATETIME(3) NULL,
  ADD COLUMN next_delivery_at DATETIME(3) NULL,
  ADD CONSTRAINT mip_task_assignments_assign_mode_ck CHECK (
    assign_mode IN ('ALL', 'SELECTED', 'WEEKLY', 'single', 'batch', 'weekly')
  );
