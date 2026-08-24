CREATE TABLE IF NOT EXISTS mip_blind_box_catalogs (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  rules_text TEXT NOT NULL,
  redemption_rules_text TEXT NOT NULL,
  draw_cost_coin INT UNSIGNED NOT NULL DEFAULT 5,
  daily_draw_limit INT UNSIGNED NOT NULL DEFAULT 20,
  pity_threshold INT UNSIGNED NOT NULL DEFAULT 10,
  pity_min_rarity VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'RARE',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_blind_box_catalogs_key_uk (app_id, catalog_key),
  KEY mip_blind_box_catalogs_status_idx (app_id, status, updated_at DESC, id),
  CONSTRAINT mip_blind_box_catalogs_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_catalogs_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_catalogs_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')),
  CONSTRAINT mip_blind_box_catalogs_pity_rarity_ck CHECK (
    pity_min_rarity IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')
  ),
  CONSTRAINT mip_blind_box_catalogs_rules_ck CHECK (
    CHAR_LENGTH(TRIM(rules_text)) > 0 AND CHAR_LENGTH(TRIM(redemption_rules_text)) > 0
  ),
  CONSTRAINT mip_blind_box_catalogs_limits_ck CHECK (
    draw_cost_coin BETWEEN 1 AND 100000
    AND daily_draw_limit BETWEEN 1 AND 100
    AND pity_threshold BETWEEN 1 AND 100
  ),
  CONSTRAINT mip_blind_box_catalogs_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_blind_box_cards (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  rarity VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  weight INT UNSIGNED NOT NULL,
  stock_total INT UNSIGNED NOT NULL,
  stock_remaining INT UNSIGNED NOT NULL,
  display_order INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_blind_box_cards_catalog_id_uk (app_id, catalog_id, id),
  UNIQUE KEY mip_blind_box_cards_key_uk (app_id, catalog_id, card_key),
  KEY mip_blind_box_cards_catalog_idx (
    app_id, catalog_id, status, display_order, rarity, id
  ),
  CONSTRAINT mip_blind_box_cards_catalog_fk FOREIGN KEY (app_id, catalog_id)
    REFERENCES mip_blind_box_catalogs (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_cards_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_cards_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_cards_rarity_ck CHECK (rarity IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')),
  CONSTRAINT mip_blind_box_cards_status_ck CHECK (status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED')),
  CONSTRAINT mip_blind_box_cards_weight_ck CHECK (weight BETWEEN 1 AND 1000000),
  CONSTRAINT mip_blind_box_cards_stock_ck CHECK (stock_remaining <= stock_total),
  CONSTRAINT mip_blind_box_cards_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_blind_box_user_states (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  draw_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  pity_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_draw_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id, catalog_id),
  KEY mip_blind_box_user_states_catalog_idx (app_id, catalog_id, pity_count DESC, user_id),
  CONSTRAINT mip_blind_box_user_states_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_user_states_catalog_fk FOREIGN KEY (app_id, catalog_id)
    REFERENCES mip_blind_box_catalogs (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_user_states_pity_ck CHECK (pity_count <= 100),
  CONSTRAINT mip_blind_box_user_states_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_blind_box_draws (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  coin_entry_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cost_coin INT UNSIGNED NOT NULL,
  balance_after BIGINT NOT NULL,
  card_name_snapshot VARCHAR(100) NOT NULL,
  card_summary_snapshot VARCHAR(500) NOT NULL DEFAULT '',
  rarity_snapshot VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  weight_snapshot INT UNSIGNED NOT NULL,
  total_weight_snapshot BIGINT UNSIGNED NOT NULL,
  random_roll BIGINT UNSIGNED NOT NULL,
  catalog_version_snapshot BIGINT UNSIGNED NOT NULL,
  pity_threshold_snapshot INT UNSIGNED NOT NULL,
  pity_min_rarity_snapshot VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pity_before INT UNSIGNED NOT NULL,
  pity_after INT UNSIGNED NOT NULL,
  pity_triggered TINYINT(1) NOT NULL DEFAULT 0,
  inventory_quantity_after INT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_blind_box_draws_request_uk (app_id, user_id, request_id),
  UNIQUE KEY mip_blind_box_draws_coin_entry_uk (app_id, coin_entry_id),
  KEY mip_blind_box_draws_user_idx (app_id, user_id, created_at DESC, id),
  KEY mip_blind_box_draws_catalog_idx (app_id, catalog_id, created_at DESC, id),
  CONSTRAINT mip_blind_box_draws_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_draws_catalog_fk FOREIGN KEY (app_id, catalog_id)
    REFERENCES mip_blind_box_catalogs (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_draws_card_fk FOREIGN KEY (app_id, catalog_id, card_id)
    REFERENCES mip_blind_box_cards (app_id, catalog_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_draws_coin_entry_fk FOREIGN KEY (app_id, coin_entry_id)
    REFERENCES mip_growth_entries (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_draws_rarity_ck CHECK (
    rarity_snapshot IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')
    AND pity_min_rarity_snapshot IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')
  ),
  CONSTRAINT mip_blind_box_draws_cost_ck CHECK (
    cost_coin BETWEEN 1 AND 100000 AND balance_after >= 0
    AND weight_snapshot >= 1 AND total_weight_snapshot >= weight_snapshot
    AND random_roll < total_weight_snapshot
  ),
  CONSTRAINT mip_blind_box_draws_pity_ck CHECK (
    pity_threshold_snapshot BETWEEN 1 AND 100
    AND pity_before <= 100 AND pity_after <= 100
  ),
  CONSTRAINT mip_blind_box_draws_snapshot_ck CHECK (
    catalog_version_snapshot >= 1 AND inventory_quantity_after >= 1
  ),
  CONSTRAINT mip_blind_box_draws_trigger_ck CHECK (pity_triggered IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_blind_box_inventory (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  catalog_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  first_acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_acquired_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id, card_id),
  KEY mip_blind_box_inventory_catalog_idx (app_id, user_id, catalog_id, last_acquired_at DESC, card_id),
  CONSTRAINT mip_blind_box_inventory_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_inventory_card_fk FOREIGN KEY (app_id, catalog_id, card_id)
    REFERENCES mip_blind_box_cards (app_id, catalog_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_blind_box_inventory_quantity_ck CHECK (quantity >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
