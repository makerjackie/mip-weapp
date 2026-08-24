CREATE TABLE IF NOT EXISTS mip_task_cards (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  reward_experience INT UNSIGNED NOT NULL DEFAULT 0,
  attachment_required TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  published_at DATETIME(3) NULL,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  KEY mip_task_cards_public_idx (app_id, status, published_at DESC, id),
  KEY mip_task_cards_updated_idx (app_id, updated_at DESC, id),
  CONSTRAINT mip_task_cards_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_cards_reward_ck CHECK (reward_experience <= 1000000),
  CONSTRAINT mip_task_cards_attachment_ck CHECK (attachment_required IN (0, 1)),
  CONSTRAINT mip_task_cards_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'DELETED')),
  CONSTRAINT mip_task_cards_version_ck CHECK (version >= 1),
  CONSTRAINT mip_task_cards_publication_ck CHECK (
    (status = 'DRAFT' AND published_at IS NULL)
    OR (status IN ('PUBLISHED', 'UNPUBLISHED') AND published_at IS NOT NULL)
    OR status = 'DELETED'
  ),
  CONSTRAINT mip_task_cards_deleted_ck CHECK (
    (status = 'DELETED' AND deleted_at IS NOT NULL)
    OR (status <> 'DELETED' AND deleted_at IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_task_completions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_version BIGINT UNSIGNED NOT NULL,
  task_name_snapshot VARCHAR(100) NOT NULL,
  task_content_snapshot TEXT NOT NULL,
  attachment_asset_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reward_experience INT UNSIGNED NOT NULL DEFAULT 0,
  growth_entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  result_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SUCCESS',
  result_message VARCHAR(300) NULL,
  completed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_task_completions_once_uk (app_id, task_id, user_id),
  UNIQUE KEY mip_task_completions_growth_uk (app_id, growth_entry_id),
  KEY mip_task_completions_user_idx (app_id, user_id, completed_at DESC, id),
  KEY mip_task_completions_task_idx (app_id, task_id, completed_at DESC, id),
  KEY mip_task_completions_result_idx (app_id, result_status, completed_at DESC, id),
  CONSTRAINT mip_task_completions_task_fk FOREIGN KEY (app_id, task_id)
    REFERENCES mip_task_cards (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_completions_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_completions_attachment_fk FOREIGN KEY (app_id, attachment_asset_id)
    REFERENCES mip_media_assets (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_completions_growth_fk FOREIGN KEY (app_id, growth_entry_id)
    REFERENCES mip_growth_entries (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_task_completions_result_ck CHECK (result_status IN ('SUCCESS', 'FAILED')),
  CONSTRAINT mip_task_completions_reward_ck CHECK (reward_experience <= 1000000),
  CONSTRAINT mip_task_completions_growth_pair_ck CHECK (
    (result_status = 'SUCCESS' AND (
      (reward_experience = 0 AND growth_entry_id IS NULL)
      OR (reward_experience > 0 AND growth_entry_id IS NOT NULL)
    ))
    OR (result_status = 'FAILED' AND growth_entry_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
