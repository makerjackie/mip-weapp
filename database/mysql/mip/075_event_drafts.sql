-- M08/P1: Create mip_event_drafts for the event draft auto-save module.

CREATE TABLE IF NOT EXISTS mip_event_drafts (
  draft_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  draft_data_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (draft_id),
  KEY mip_event_drafts_event_idx (event_id, updated_at),
  KEY mip_event_drafts_operator_idx (operator_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
