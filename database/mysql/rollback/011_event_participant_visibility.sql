ALTER TABLE member_event_reservations
  DROP COLUMN share_profile;

ALTER TABLE member_registrations
  DROP INDEX member_registrations_participant_visibility_idx,
  DROP COLUMN share_profile;
