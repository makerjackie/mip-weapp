DROP TABLE IF EXISTS mip_blind_box_rollback_guard;

CREATE TABLE mip_blind_box_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_blind_box_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_blind_box_rollback_guard (guard_id)
SELECT 1 FROM mip_blind_box_draws LIMIT 1;

DROP TABLE mip_blind_box_rollback_guard;

DROP TABLE IF EXISTS mip_blind_box_inventory;
DROP TABLE IF EXISTS mip_blind_box_draws;
DROP TABLE IF EXISTS mip_blind_box_user_states;
DROP TABLE IF EXISTS mip_blind_box_cards;
DROP TABLE IF EXISTS mip_blind_box_catalogs;
