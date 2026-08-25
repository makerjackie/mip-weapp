DROP TABLE IF EXISTS mip_profile_identity_status_rollback_guard;

CREATE TABLE mip_profile_identity_status_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_profile_identity_status_rollback_guard (guard_id) VALUES (1);

-- Reverting the character set would reject or corrupt non-ASCII identity status values.
INSERT INTO mip_profile_identity_status_rollback_guard (guard_id)
SELECT 1
FROM mip_profiles
WHERE identity_status IS NOT NULL
  AND CHAR_LENGTH(identity_status) <> LENGTH(identity_status)
LIMIT 1;

DROP TABLE mip_profile_identity_status_rollback_guard;

ALTER TABLE mip_profiles
  MODIFY COLUMN identity_status VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL;
