-- Compatibility rollback. The former fine-grained roles cannot be recovered
-- exactly after they have been consolidated, so manager/staff presets map to
-- the closest safe legacy roles.

ALTER TABLE member_event_managers
  DROP CHECK member_event_managers_role_ck;

UPDATE member_event_managers
SET role = CASE role
  WHEN 'EVENT_MANAGER' THEN 'EDITOR'
  WHEN 'EVENT_STAFF' THEN 'CHECKIN_STAFF'
  ELSE role
END
WHERE role IN ('EVENT_MANAGER', 'EVENT_STAFF');

ALTER TABLE member_event_managers
  ADD CONSTRAINT member_event_managers_role_ck CHECK (
    role IN ('EVENT_OWNER', 'EDITOR', 'ROSTER_MANAGER', 'CHECKIN_STAFF', 'ALBUM_MODERATOR')
  );
