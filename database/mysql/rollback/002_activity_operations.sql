-- Rollback only the objects introduced by 002_activity_operations.sql.
-- Never drop 001 tables or columns such as member_events.address / registration_deadline / cover_asset_id.

ALTER TABLE member_registrations
  DROP INDEX member_registrations_roster_idx,
  DROP INDEX member_registrations_ticket_uk,
  DROP CHECK member_registrations_cancelled_by_type_ck,
  DROP CHECK member_registrations_version_ck,
  DROP COLUMN version,
  DROP COLUMN cancellation_reason,
  DROP COLUMN cancelled_by_type,
  DROP COLUMN cancelled_at,
  DROP COLUMN attended_by,
  DROP COLUMN attended_at,
  DROP COLUMN ticket_code;

ALTER TABLE member_events
  DROP CHECK member_events_version_ck,
  DROP COLUMN version,
  DROP COLUMN cancellation_reason,
  DROP COLUMN cancelled_by,
  DROP COLUMN cancelled_at,
  DROP COLUMN cancellation_policy,
  DROP COLUMN venue_name;
