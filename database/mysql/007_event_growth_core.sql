-- Activity growth core: approval, waitlist, editable registrations,
-- online/hybrid venues, geolocation, and member-visible change history.

ALTER TABLE member_events
  ADD COLUMN registration_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'AUTO' AFTER form_version,
  ADD COLUMN waitlist_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER registration_mode,
  ADD COLUMN event_mode VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'OFFLINE' AFTER album_requires_review,
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude,
  ADD COLUMN online_url VARCHAR(500) NULL AFTER longitude,
  ADD CONSTRAINT member_events_registration_mode_ck CHECK (
    registration_mode IN ('AUTO', 'APPROVAL')
  ),
  ADD CONSTRAINT member_events_event_mode_ck CHECK (
    event_mode IN ('OFFLINE', 'ONLINE', 'HYBRID')
  ),
  ADD CONSTRAINT member_events_location_coordinates_ck CHECK (
    (latitude IS NULL AND longitude IS NULL)
    OR (
      latitude BETWEEN -90 AND 90
      AND longitude BETWEEN -180 AND 180
    )
  );

ALTER TABLE member_registrations
  DROP CHECK member_registrations_status_ck,
  MODIFY COLUMN status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin
    NOT NULL DEFAULT 'REGISTERED',
  ADD COLUMN waitlisted_at DATETIME(3) NULL AFTER attended_by,
  ADD COLUMN reviewed_at DATETIME(3) NULL AFTER waitlisted_at,
  ADD COLUMN reviewed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER reviewed_at,
  ADD COLUMN review_reason VARCHAR(300) NULL AFTER reviewed_by,
  ADD CONSTRAINT member_registrations_status_ck CHECK (
    status IN (
      'PENDING_REVIEW',
      'WAITLISTED',
      'REGISTERED',
      'CANCELLATION_PENDING',
      'CANCELLED',
      'REJECTED',
      'ATTENDED'
    )
  ),
  ADD KEY member_registrations_waitlist_idx (
    app_id, event_id, status, waitlisted_at, registered_at, id
  );

CREATE TABLE IF NOT EXISTS member_event_changes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_version INT UNSIGNED NOT NULL,
  change_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  summary VARCHAR(300) NOT NULL,
  changed_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT member_event_changes_event_fk
    FOREIGN KEY (app_id, event_id)
    REFERENCES member_events (app_id, id) ON DELETE CASCADE,
  CONSTRAINT member_event_changes_version_ck CHECK (event_version > 0),
  CONSTRAINT member_event_changes_type_ck CHECK (
    change_type IN ('CONTENT', 'SCHEDULE', 'VENUE', 'REGISTRATION', 'STATUS')
  ),
  KEY member_event_changes_feed_idx (app_id, event_id, created_at DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
