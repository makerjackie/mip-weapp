DROP TEMPORARY TABLE IF EXISTS mip_opportunity_commercial_terms_rollback_guard;

CREATE TEMPORARY TABLE mip_opportunity_commercial_terms_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_opportunity_commercial_terms_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_opportunity_commercial_terms_rollback_guard (guard_id)
SELECT 1
FROM mip_opportunity_commercial_terms
WHERE status <> 'ACTIVE'
LIMIT 1;

DROP TEMPORARY TABLE mip_opportunity_commercial_terms_rollback_guard;

ALTER TABLE mip_opportunity_commercial_terms
  DROP CHECK mip_opportunity_commercial_terms_status_ck,
  DROP KEY mip_opportunity_commercial_terms_status_amount_idx,
  DROP COLUMN status;
