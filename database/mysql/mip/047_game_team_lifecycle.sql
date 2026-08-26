ALTER TABLE mip_game_teams
  ADD COLUMN member_limit TINYINT UNSIGNED NOT NULL DEFAULT 100 AFTER summary,
  ADD CONSTRAINT mip_game_teams_member_limit_ck CHECK (member_limit BETWEEN 1 AND 100);
