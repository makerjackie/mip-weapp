-- M08/P1: Create mip_business_cards, mip_card_templates, and mip_card_history
-- for the business card management module.

CREATE TABLE IF NOT EXISTS mip_business_cards (
  card_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  card_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fields JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (card_id),
  KEY mip_business_cards_type_idx (card_type, status, updated_at),
  KEY mip_business_cards_status_idx (status, updated_at),
  CONSTRAINT mip_business_cards_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT mip_business_cards_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_card_templates (
  template_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  card_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  template_schema JSON NOT NULL,
  status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (template_id),
  KEY mip_card_templates_type_idx (card_type, status, updated_at),
  CONSTRAINT mip_card_templates_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT mip_card_templates_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_card_history (
  history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  card_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  snapshot JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (history_id),
  KEY mip_card_history_card_idx (card_id, created_at),
  KEY mip_card_history_operator_idx (operator_id, created_at),
  CONSTRAINT mip_card_history_action_ck CHECK (
    action IN ('CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE', 'ARCHIVE')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
