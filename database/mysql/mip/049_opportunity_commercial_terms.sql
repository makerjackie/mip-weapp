CREATE TABLE IF NOT EXISTS mip_opportunity_commercial_terms (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY',
  amount_unit VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CNY_CENTS',
  min_amount_cents BIGINT UNSIGNED NULL,
  max_amount_cents BIGINT UNSIGNED NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, opportunity_id),
  KEY mip_opportunity_commercial_terms_amount_idx (app_id, min_amount_cents, max_amount_cents, opportunity_id),
  CONSTRAINT mip_opportunity_commercial_terms_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_commercial_terms_currency_ck CHECK (currency = 'CNY'),
  CONSTRAINT mip_opportunity_commercial_terms_unit_ck CHECK (amount_unit = 'CNY_CENTS'),
  CONSTRAINT mip_opportunity_commercial_terms_range_ck CHECK (
    min_amount_cents IS NULL OR max_amount_cents IS NULL OR min_amount_cents <= max_amount_cents
  ),
  CONSTRAINT mip_opportunity_commercial_terms_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_opportunity_locations (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  opportunity_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  location_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  city_tag_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, opportunity_id, location_key),
  UNIQUE KEY mip_opportunity_locations_type_city_uk (app_id, opportunity_id, location_type, city_tag_id),
  KEY mip_opportunity_locations_city_idx (app_id, city_tag_id, location_type, opportunity_id),
  KEY mip_opportunity_locations_type_idx (app_id, location_type, opportunity_id),
  CONSTRAINT mip_opportunity_locations_opportunity_fk FOREIGN KEY (app_id, opportunity_id)
    REFERENCES mip_opportunities (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_locations_city_fk FOREIGN KEY (app_id, city_tag_id)
    REFERENCES mip_tags (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_opportunity_locations_type_ck CHECK (location_type IN ('CITY', 'NATIONAL', 'REMOTE')),
  CONSTRAINT mip_opportunity_locations_city_ck CHECK (
    (location_type = 'CITY' AND city_tag_id IS NOT NULL)
    OR (location_type IN ('NATIONAL', 'REMOTE') AND city_tag_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mip_opportunity_locations (
  app_id, opportunity_id, location_key, location_type, city_tag_id, sort_order
)
SELECT app_id, id, CONCAT('CITY:', city_tag_id), 'CITY', city_tag_id, 0
FROM mip_opportunities
WHERE city_tag_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM mip_opportunity_locations location
    WHERE location.app_id = mip_opportunities.app_id
      AND location.opportunity_id = mip_opportunities.id
  );
