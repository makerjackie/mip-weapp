DROP TABLE IF EXISTS mip_task_submission_reviews;

ALTER TABLE mip_task_completions
  DROP CHECK mip_task_completions_submission_status_ck,
  DROP KEY mip_task_completions_submission_idx,
  DROP COLUMN retry_log_json,
  DROP COLUMN reward_result_json,
  DROP COLUMN reviewed_by_user_id,
  DROP COLUMN review_remark,
  DROP COLUMN submission_status;
