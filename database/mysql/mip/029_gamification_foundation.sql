CREATE TABLE IF NOT EXISTS mip_game_seasons (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  rules_text TEXT NOT NULL,
  rules_json JSON NOT NULL,
  period_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'DRAFT',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_game_seasons_key_uk (app_id, season_key),
  KEY mip_game_seasons_status_idx (app_id, status, starts_at DESC, id),
  CONSTRAINT mip_game_seasons_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_seasons_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_seasons_period_ck CHECK (period_kind IN ('HALF_YEAR', 'YEAR', 'CUSTOM')),
  CONSTRAINT mip_game_seasons_status_ck CHECK (status IN ('DRAFT', 'ACTIVE', 'CLOSED')),
  CONSTRAINT mip_game_seasons_dates_ck CHECK (starts_at < ends_at),
  CONSTRAINT mip_game_seasons_version_ck CHECK (version >= 1),
  CONSTRAINT mip_game_seasons_rules_text_ck CHECK (CHAR_LENGTH(TRIM(rules_text)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_game_teams (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  name VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_game_teams_season_id_uk (app_id, season_id, id),
  UNIQUE KEY mip_game_teams_name_uk (app_id, season_id, name),
  KEY mip_game_teams_branch_idx (app_id, season_id, branch_id, status, id),
  CONSTRAINT mip_game_teams_season_fk FOREIGN KEY (app_id, season_id)
    REFERENCES mip_game_seasons (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_teams_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_teams_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_teams_updater_fk FOREIGN KEY (app_id, updated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_teams_status_ck CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT mip_game_teams_name_ck CHECK (CHAR_LENGTH(TRIM(name)) > 0),
  CONSTRAINT mip_game_teams_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_game_team_memberships (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  team_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'MEMBER',
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'ACTIVE',
  active_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin
    GENERATED ALWAYS AS (CASE WHEN status = 'ACTIVE' THEN user_id ELSE NULL END) STORED,
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_game_team_memberships_active_uk (app_id, season_id, active_user_id),
  KEY mip_game_team_memberships_team_idx (app_id, season_id, team_id, status, joined_at, user_id),
  CONSTRAINT mip_game_team_memberships_team_fk FOREIGN KEY (app_id, season_id, team_id)
    REFERENCES mip_game_teams (app_id, season_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_team_memberships_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_team_memberships_role_ck CHECK (role IN ('CAPTAIN', 'MEMBER')),
  CONSTRAINT mip_game_team_memberships_status_ck CHECK (status IN ('ACTIVE', 'LEFT')),
  CONSTRAINT mip_game_team_memberships_dates_ck CHECK (
    (status = 'ACTIVE' AND left_at IS NULL)
    OR (status = 'LEFT' AND left_at IS NOT NULL AND left_at >= joined_at)
  ),
  CONSTRAINT mip_game_team_memberships_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_game_weekly_matches (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  team_a_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  team_b_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  team_a_score BIGINT NULL,
  team_b_score BIGINT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'SCHEDULED',
  finalized_at DATETIME(3) NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_game_weekly_matches_pair_uk (app_id, season_id, week_start, team_a_id, team_b_id),
  KEY mip_game_weekly_matches_period_idx (app_id, season_id, status, week_start DESC, id),
  CONSTRAINT mip_game_weekly_matches_season_fk FOREIGN KEY (app_id, season_id)
    REFERENCES mip_game_seasons (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_weekly_matches_team_a_fk FOREIGN KEY (app_id, season_id, team_a_id)
    REFERENCES mip_game_teams (app_id, season_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_weekly_matches_team_b_fk FOREIGN KEY (app_id, season_id, team_b_id)
    REFERENCES mip_game_teams (app_id, season_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_weekly_matches_creator_fk FOREIGN KEY (app_id, created_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_weekly_matches_teams_ck CHECK (team_a_id < team_b_id),
  CONSTRAINT mip_game_weekly_matches_dates_ck CHECK (DATEDIFF(week_end, week_start) = 6),
  CONSTRAINT mip_game_weekly_matches_status_ck CHECK (status IN ('SCHEDULED', 'FINALIZED')),
  CONSTRAINT mip_game_weekly_matches_result_ck CHECK (
    (status = 'SCHEDULED' AND team_a_score IS NULL AND team_b_score IS NULL AND finalized_at IS NULL)
    OR (status = 'FINALIZED' AND team_a_score IS NOT NULL AND team_b_score IS NOT NULL AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT mip_game_weekly_matches_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_game_ranking_snapshots (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  season_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ranking_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  period_start DATETIME(3) NOT NULL,
  period_end DATETIME(3) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CURRENT',
  generated_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  generated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (app_id, id),
  UNIQUE KEY mip_game_ranking_snapshots_app_id_uk (app_id, season_id, ranking_type, period_key, id),
  KEY mip_game_ranking_snapshots_current_idx (app_id, season_id, ranking_type, status, generated_at DESC, id),
  CONSTRAINT mip_game_ranking_snapshots_season_fk FOREIGN KEY (app_id, season_id)
    REFERENCES mip_game_seasons (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_snapshots_generator_fk FOREIGN KEY (app_id, generated_by_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_snapshots_type_ck CHECK (
    ranking_type IN ('TEAM_HALF_YEAR', 'TEAM_YEAR', 'INDIVIDUAL_SEASON', 'INDIVIDUAL_ALL_TIME')
  ),
  CONSTRAINT mip_game_ranking_snapshots_status_ck CHECK (status IN ('CURRENT', 'ARCHIVED')),
  CONSTRAINT mip_game_ranking_snapshots_dates_ck CHECK (period_start < period_end),
  CONSTRAINT mip_game_ranking_snapshots_version_ck CHECK (version >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_game_ranking_entries (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  snapshot_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  rank_no INT UNSIGNED NOT NULL,
  subject_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  team_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  branch_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  display_name_snapshot VARCHAR(100) NOT NULL,
  score BIGINT NOT NULL,
  level_number INT UNSIGNED NULL,
  level_label VARCHAR(80) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, snapshot_id, rank_no),
  UNIQUE KEY mip_game_ranking_entries_team_uk (app_id, snapshot_id, team_id),
  UNIQUE KEY mip_game_ranking_entries_user_uk (app_id, snapshot_id, user_id),
  KEY mip_game_ranking_entries_branch_idx (app_id, snapshot_id, branch_id, rank_no),
  CONSTRAINT mip_game_ranking_entries_snapshot_fk FOREIGN KEY (app_id, snapshot_id)
    REFERENCES mip_game_ranking_snapshots (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_entries_team_fk FOREIGN KEY (app_id, team_id)
    REFERENCES mip_game_teams (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_entries_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_entries_branch_fk FOREIGN KEY (app_id, branch_id)
    REFERENCES mip_city_branches (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_game_ranking_entries_subject_ck CHECK (
    (subject_type = 'TEAM' AND team_id IS NOT NULL AND user_id IS NULL)
    OR (subject_type = 'USER' AND user_id IS NOT NULL AND team_id IS NULL)
  ),
  CONSTRAINT mip_game_ranking_entries_rank_ck CHECK (rank_no >= 1),
  CONSTRAINT mip_game_ranking_entries_level_ck CHECK (
    (level_number IS NULL AND level_label IS NULL)
    OR (level_number IS NOT NULL AND level_number >= 1 AND level_label IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
