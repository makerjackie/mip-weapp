-- Structural rollback only after exporting lifecycle facts.
DROP TEMPORARY TABLE IF EXISTS mip_player_lifecycle_rollback_guard;

CREATE TEMPORARY TABLE mip_player_lifecycle_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_player_lifecycle_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_player_lifecycle_rollback_guard (guard_id)
SELECT 1 FROM mip_player_lifecycles LIMIT 1;

INSERT INTO mip_player_lifecycle_rollback_guard (guard_id)
SELECT 1 FROM mip_player_number_sequences LIMIT 1;

DROP TEMPORARY TABLE mip_player_lifecycle_rollback_guard;

DROP TABLE IF EXISTS mip_player_lifecycles;
DROP TABLE IF EXISTS mip_player_number_sequences;
