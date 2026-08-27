DROP TEMPORARY TABLE IF EXISTS mip_badge_categories_rollback_guard;

CREATE TEMPORARY TABLE mip_badge_categories_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_badge_categories_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_badge_categories_rollback_guard (guard_id)
SELECT 1
FROM mip_badges
WHERE category <> 'IDENTITY'
LIMIT 1;

DROP TEMPORARY TABLE mip_badge_categories_rollback_guard;

ALTER TABLE mip_badges
  DROP CHECK mip_badges_category_ck,
  DROP KEY mip_badges_category_idx,
  DROP COLUMN category;
