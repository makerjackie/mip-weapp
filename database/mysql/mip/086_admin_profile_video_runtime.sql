-- Independent videos previously lacked AppID ownership. Legacy rows remain unassigned.
ALTER TABLE mip_videos
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER video_id,
  ADD COLUMN version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN content_safety_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PENDING',
  ADD KEY mip_videos_app_list_idx (app_id, updated_at DESC, video_id DESC),
  ADD CONSTRAINT mip_videos_version_ck CHECK (version >= 1);
ALTER TABLE mip_cooperation_cards
  ADD COLUMN card_real_name VARCHAR(64) NULL,
  ADD COLUMN card_game_name VARCHAR(64) NULL,
  ADD COLUMN referral_needed VARCHAR(500) NULL;
-- Append-only transitions retain cancellation targets; current votes remain mip_event_hearts.
CREATE TABLE IF NOT EXISTS mip_event_heart_history (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  heart_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voter_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_version BIGINT UNSIGNED NOT NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_heart_history_transition_uk (app_id, heart_id, source_version, status),
  KEY mip_event_heart_history_voter_idx (app_id, voter_user_id, occurred_at DESC, id DESC),
  KEY mip_event_heart_history_target_idx (app_id, target_user_id, occurred_at DESC, id DESC),
  CONSTRAINT mip_event_heart_history_status_ck CHECK (status IN ('ACTIVE', 'CANCELLED')),
  CONSTRAINT mip_event_heart_history_heart_fk FOREIGN KEY (app_id, heart_id) REFERENCES mip_event_hearts (app_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO mip_event_heart_history (id, app_id, heart_id, event_id, voter_user_id, target_user_id, status, source_version, occurred_at)
SELECT UUID(), app_id, id, event_id, voter_user_id, target_user_id, status, version, updated_at FROM mip_event_hearts;
