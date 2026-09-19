-- M08/P1: Create mip_videos for the independent video management module.

CREATE TABLE IF NOT EXISTS mip_videos (
  video_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cover_asset_id VARCHAR(128) NULL,
  jump_url VARCHAR(512) NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (video_id),
  KEY mip_videos_status_idx (status, sort_order, updated_at),
  KEY mip_videos_sort_idx (sort_order, status),
  CONSTRAINT mip_videos_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
