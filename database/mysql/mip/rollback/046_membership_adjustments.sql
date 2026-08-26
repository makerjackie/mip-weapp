-- Execute this rollback in one MySQL session. The temporary guard rejects any
-- rollback that would discard an adjustment or an entitlement backed by one.
DROP TEMPORARY TABLE IF EXISTS mip_membership_adjustments_rollback_guard;

CREATE TEMPORARY TABLE mip_membership_adjustments_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_membership_adjustments_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_membership_adjustments_rollback_guard (guard_id)
SELECT 1 FROM mip_membership_adjustments LIMIT 1;

INSERT INTO mip_membership_adjustments_rollback_guard (guard_id)
SELECT 1
FROM mip_membership_entitlements
WHERE source_type <> 'ORDER'
LIMIT 1;

INSERT INTO mip_membership_adjustments_rollback_guard (guard_id)
SELECT 1
FROM mip_membership_entitlements
WHERE order_id IS NULL OR plan_id IS NULL
LIMIT 1;

INSERT INTO mip_membership_adjustments_rollback_guard (guard_id)
SELECT 1
FROM mip_membership_entitlements
WHERE source_adjustment_id IS NOT NULL
LIMIT 1;

DROP TEMPORARY TABLE mip_membership_adjustments_rollback_guard;

ALTER TABLE mip_membership_entitlements
  DROP FOREIGN KEY mip_membership_entitlements_adjustment_fk,
  DROP CHECK mip_membership_entitlements_source_pair_ck,
  DROP CHECK mip_membership_entitlements_source_type_ck,
  DROP INDEX mip_membership_entitlements_adjustment_user_idx,
  DROP INDEX mip_membership_entitlements_adjustment_uk,
  DROP COLUMN source_adjustment_id,
  DROP COLUMN source_type,
  MODIFY COLUMN order_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY COLUMN plan_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

DROP TABLE IF EXISTS mip_membership_adjustments;
DROP TABLE IF EXISTS mip_membership_chains;
