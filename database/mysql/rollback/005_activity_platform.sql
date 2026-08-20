DROP TABLE IF EXISTS member_checkin_credentials;
DROP TABLE IF EXISTS member_event_photos;
DROP TABLE IF EXISTS member_event_reservations;
DROP TABLE IF EXISTS member_event_managers;
DROP TABLE IF EXISTS member_follows;

ALTER TABLE member_registrations
  DROP CHECK member_registrations_status_ck,
  DROP CHECK member_registrations_form_version_ck,
  DROP COLUMN answer_snapshot,
  DROP COLUMN form_version,
  ADD CONSTRAINT member_registrations_status_ck CHECK (
    status IN ('REGISTERED', 'CANCELLED', 'ATTENDED')
  );

ALTER TABLE member_events
  DROP FOREIGN KEY member_events_poster_fk,
  DROP CHECK member_events_form_version_ck,
  DROP COLUMN poster_asset_id,
  DROP COLUMN album_requires_review,
  DROP COLUMN album_enabled,
  DROP COLUMN form_version,
  DROP COLUMN registration_schema,
  DROP COLUMN notices;

ALTER TABLE member_profiles
  DROP CHECK member_profiles_version_ck,
  DROP COLUMN profile_version,
  DROP COLUMN skills,
  DROP COLUMN interests,
  DROP COLUMN industry,
  DROP COLUMN role_title,
  DROP COLUMN organization;

ALTER TABLE member_media_assets
  DROP CHECK member_media_assets_kind_ck,
  ADD CONSTRAINT member_media_assets_kind_ck CHECK (
    kind IN ('avatar', 'event-cover', 'brand')
  );
