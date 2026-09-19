-- M02: Extend mip_task_cards with star level, purpose, completion criteria,
-- scheduling, assigned owner, reward config, and attachment template.

ALTER TABLE mip_task_cards
  ADD COLUMN star_level TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER reward_experience,
  ADD COLUMN reward_config_json JSON NULL AFTER star_level,
  ADD COLUMN purpose TEXT NULL AFTER content,
  ADD COLUMN completion_criteria TEXT NULL AFTER purpose,
  ADD COLUMN period_start_at DATE NULL AFTER ends_at,
  ADD COLUMN weekly_deliver_at VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER period_start_at,
  ADD COLUMN assigned_owner_id BIGINT UNSIGNED NULL AFTER created_by_user_id,
  ADD COLUMN attachment_template_asset_id VARCHAR(128) NULL AFTER template_asset_id,
  ADD KEY mip_task_cards_star_level_idx (app_id, status, star_level, published_at DESC, id),
  ADD KEY mip_task_cards_owner_idx (app_id, assigned_owner_id, status, id),
  ADD CONSTRAINT mip_task_cards_star_level_ck CHECK (star_level <= 5);
