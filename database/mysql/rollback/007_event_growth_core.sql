DROP TABLE IF EXISTS member_event_changes;

ALTER TABLE member_registrations
  DROP KEY member_registrations_waitlist_idx,
  DROP CHECK member_registrations_status_ck,
  DROP COLUMN review_reason,
  DROP COLUMN reviewed_by,
  DROP COLUMN reviewed_at,
  DROP COLUMN waitlisted_at,
  ADD CONSTRAINT member_registrations_status_ck CHECK (
    status IN ('REGISTERED', 'CANCELLATION_PENDING', 'CANCELLED', 'ATTENDED')
  );

ALTER TABLE member_events
  DROP CHECK member_events_location_coordinates_ck,
  DROP CHECK member_events_event_mode_ck,
  DROP CHECK member_events_registration_mode_ck,
  DROP COLUMN online_url,
  DROP COLUMN longitude,
  DROP COLUMN latitude,
  DROP COLUMN event_mode,
  DROP COLUMN waitlist_enabled,
  DROP COLUMN registration_mode;
