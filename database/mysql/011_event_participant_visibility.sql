-- Event participant discovery is explicit and per registration.
-- A member is never listed only because they registered.

ALTER TABLE member_registrations
  ADD COLUMN share_profile TINYINT(1) NOT NULL DEFAULT 0 AFTER answer_snapshot,
  ADD KEY member_registrations_participant_visibility_idx (
    app_id, event_id, share_profile, status, registered_at, id
  );

ALTER TABLE member_event_reservations
  ADD COLUMN share_profile TINYINT(1) NOT NULL DEFAULT 0 AFTER answer_snapshot;
