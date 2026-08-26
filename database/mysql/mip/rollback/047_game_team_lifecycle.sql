-- Execute this rollback in one MySQL session. The guard rejects a rollback
-- that would discard a configured team capacity.
DROP TEMPORARY TABLE IF EXISTS mip_game_team_lifecycle_rollback_guard;

CREATE TEMPORARY TABLE mip_game_team_lifecycle_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_game_team_lifecycle_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_game_team_lifecycle_rollback_guard (guard_id)
SELECT 1
FROM mip_game_teams
WHERE member_limit <> 100
LIMIT 1;

DROP TEMPORARY TABLE mip_game_team_lifecycle_rollback_guard;

ALTER TABLE mip_game_teams
  DROP CHECK mip_game_teams_member_limit_ck,
  DROP COLUMN member_limit;
