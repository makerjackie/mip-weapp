-- M02: Add submission review workflow to mip_task_completions and create
-- mip_task_submission_reviews for audit-trail review records.

ALTER TABLE mip_task_completions
  ADD COLUMN submission_status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SUBMITTED' AFTER result_status,
  ADD COLUMN review_remark TEXT NULL AFTER result_message,
  ADD COLUMN reviewed_by_user_id BIGINT UNSIGNED NULL AFTER review_remark,
  ADD COLUMN reward_result_json JSON NULL AFTER reward_experience,
  ADD COLUMN retry_log_json JSON NULL AFTER reward_result_json,
  ADD KEY mip_task_completions_submission_idx (app_id, submission_status, completed_at DESC, id),
  ADD CONSTRAINT mip_task_completions_submission_status_ck CHECK (
    submission_status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETRY_PENDING')
  );

CREATE TABLE IF NOT EXISTS mip_task_submission_reviews (
  review_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  submission_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  remark TEXT NULL,
  reviewed_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (review_id),
  KEY mip_task_submission_reviews_submission_idx (submission_id, created_at),
  KEY mip_task_submission_reviews_task_idx (task_id, created_at),
  KEY mip_task_submission_reviews_user_idx (user_id, created_at),
  CONSTRAINT mip_task_submission_reviews_action_ck CHECK (
    action IN ('APPROVE', 'REJECT', 'REQUEST_RETRY')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
