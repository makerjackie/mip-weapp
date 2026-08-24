DROP TABLE IF EXISTS mip_event_album_photos;

ALTER TABLE mip_events
  DROP CHECK mip_events_album_submission_policy_ck,
  DROP CHECK mip_events_album_enabled_ck,
  DROP COLUMN album_submission_policy,
  DROP COLUMN album_enabled;
