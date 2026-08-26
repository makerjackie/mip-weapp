CREATE TABLE IF NOT EXISTS mip_player_number_sequences (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  next_player_number BIGINT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id),
  CONSTRAINT mip_player_number_sequences_next_ck CHECK (next_player_number >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS mip_player_lifecycles (
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  player_number BIGINT UNSIGNED NOT NULL,
  first_player_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (app_id, user_id),
  UNIQUE KEY mip_player_lifecycles_number_uk (app_id, player_number),
  KEY mip_player_lifecycles_first_idx (app_id, first_player_at, user_id),
  CONSTRAINT mip_player_lifecycles_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_player_lifecycles_number_ck CHECK (player_number >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mip_player_lifecycles (app_id, user_id, player_number, first_player_at)
SELECT first_window.app_id,
       first_window.user_id,
       ROW_NUMBER() OVER (
         PARTITION BY first_window.app_id
         ORDER BY first_window.first_player_at, first_window.user_id
       ) AS player_number,
       first_window.first_player_at
FROM (
  SELECT app_id, user_id, MIN(starts_at) AS first_player_at
  FROM mip_membership_entitlements
  WHERE status IN ('ACTIVE', 'EXPIRED')
    AND starts_at <= UTC_TIMESTAMP(3)
  GROUP BY app_id, user_id
) first_window
ON DUPLICATE KEY UPDATE user_id = mip_player_lifecycles.user_id;

INSERT INTO mip_player_number_sequences (app_id, next_player_number)
SELECT app_id, MAX(player_number) + 1
FROM mip_player_lifecycles
GROUP BY app_id
ON DUPLICATE KEY UPDATE
  next_player_number = GREATEST(mip_player_number_sequences.next_player_number, VALUES(next_player_number));
