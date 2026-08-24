ALTER TABLE mip_growth_accounts
  MODIFY experience_balance BIGINT NOT NULL DEFAULT 0;

ALTER TABLE mip_growth_entries
  DROP CHECK mip_growth_entries_balance_ck;

CREATE TABLE IF NOT EXISTS mip_event_checkin_transitions (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registration_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transition_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkin_version BIGINT UNSIGNED NOT NULL,
  registration_version BIGINT UNSIGNED NOT NULL,
  reversal_of_transition_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  actor_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revoke_reason VARCHAR(120) NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY mip_event_checkin_transitions_app_id_uk (app_id, id),
  UNIQUE KEY mip_event_checkin_transitions_version_uk (app_id, checkin_id, checkin_version),
  UNIQUE KEY mip_event_checkin_transitions_reversal_uk (app_id, reversal_of_transition_id),
  KEY mip_event_checkin_transitions_registration_idx (
    app_id, registration_id, registration_version, id
  ),
  KEY mip_event_checkin_transitions_event_idx (app_id, event_id, occurred_at DESC, id),
  CONSTRAINT mip_event_checkin_transitions_checkin_fk FOREIGN KEY (app_id, checkin_id)
    REFERENCES mip_event_checkins (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_registration_fk FOREIGN KEY (app_id, registration_id)
    REFERENCES mip_event_registrations (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_event_fk FOREIGN KEY (app_id, event_id)
    REFERENCES mip_events (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_user_fk FOREIGN KEY (app_id, user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_actor_fk FOREIGN KEY (app_id, actor_user_id)
    REFERENCES mip_users (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_reversal_fk FOREIGN KEY (
    app_id, reversal_of_transition_id
  ) REFERENCES mip_event_checkin_transitions (app_id, id) ON DELETE RESTRICT,
  CONSTRAINT mip_event_checkin_transitions_type_ck CHECK (
    transition_type IN ('CHECKED_IN', 'REVOKED')
  ),
  CONSTRAINT mip_event_checkin_transitions_source_ck CHECK (source IN ('USER_SCAN', 'ADMIN')),
  CONSTRAINT mip_event_checkin_transitions_version_ck CHECK (
    checkin_version >= 1 AND registration_version >= 1
  ),
  CONSTRAINT mip_event_checkin_transitions_reversal_pair_ck CHECK (
    (
      transition_type = 'CHECKED_IN'
      AND reversal_of_transition_id IS NULL
      AND revoke_reason IS NULL
    )
    OR (
      transition_type = 'REVOKED'
      AND reversal_of_transition_id IS NOT NULL
      AND NULLIF(TRIM(revoke_reason), '') IS NOT NULL
    )
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO mip_event_checkin_transitions (
  id, app_id, checkin_id, registration_id, event_id, user_id,
  transition_type, checkin_version, registration_version,
  reversal_of_transition_id, actor_user_id, source, revoke_reason, occurred_at
)
SELECT
  COALESCE(
    (
      SELECT outbox.id
      FROM mip_outbox_events outbox
      WHERE outbox.app_id = checkin.app_id
        AND outbox.aggregate_type = 'EVENT_REGISTRATION'
        AND outbox.aggregate_id = checkin.registration_id
        AND outbox.event_type = 'event.checked_in'
        AND outbox.source_version = CASE
          WHEN checkin.status = 'ACTIVE' THEN registration.version
          ELSE GREATEST(registration.version - 1, 1)
        END
      ORDER BY outbox.created_at DESC, outbox.id DESC
      LIMIT 1
    ),
    UUID()
  ),
  checkin.app_id,
  checkin.id,
  checkin.registration_id,
  checkin.event_id,
  checkin.user_id,
  'CHECKED_IN',
  CASE WHEN checkin.status = 'ACTIVE' THEN checkin.version ELSE GREATEST(checkin.version - 1, 1) END,
  CASE
    WHEN checkin.status = 'ACTIVE' THEN registration.version
    ELSE GREATEST(registration.version - 1, 1)
  END,
  NULL,
  CASE WHEN checkin.source = 'USER_SCAN' THEN checkin.user_id ELSE NULL END,
  checkin.source,
  NULL,
  checkin.checked_in_at
FROM mip_event_checkins checkin
INNER JOIN mip_event_registrations registration
  ON registration.app_id = checkin.app_id
 AND registration.id = checkin.registration_id;

INSERT INTO mip_event_checkin_transitions (
  id, app_id, checkin_id, registration_id, event_id, user_id,
  transition_type, checkin_version, registration_version,
  reversal_of_transition_id, actor_user_id, source, revoke_reason, occurred_at
)
SELECT
  UUID(),
  checkin.app_id,
  checkin.id,
  checkin.registration_id,
  checkin.event_id,
  checkin.user_id,
  'REVOKED',
  checkin.version,
  registration.version,
  recorded.id,
  checkin.revoked_by_user_id,
  'ADMIN',
  COALESCE(NULLIF(TRIM(checkin.revoke_reason), ''), '历史签到撤销'),
  COALESCE(checkin.revoked_at, checkin.updated_at)
FROM mip_event_checkins checkin
INNER JOIN mip_event_registrations registration
  ON registration.app_id = checkin.app_id
 AND registration.id = checkin.registration_id
INNER JOIN mip_event_checkin_transitions recorded
  ON recorded.app_id = checkin.app_id
 AND recorded.checkin_id = checkin.id
 AND recorded.transition_type = 'CHECKED_IN'
WHERE checkin.status = 'REVOKED';
