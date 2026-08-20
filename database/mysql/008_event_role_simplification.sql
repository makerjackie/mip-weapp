-- Simplify per-event roles into three understandable presets.
-- Platform roles remain unchanged and continue to own finance, global audit,
-- and cross-event operations.

ALTER TABLE member_event_managers
  DROP CHECK member_event_managers_role_ck;

UPDATE member_event_managers
SET role = CASE role
  WHEN 'EDITOR' THEN 'EVENT_MANAGER'
  WHEN 'ROSTER_MANAGER' THEN 'EVENT_STAFF'
  WHEN 'CHECKIN_STAFF' THEN 'EVENT_STAFF'
  WHEN 'ALBUM_MODERATOR' THEN 'EVENT_STAFF'
  ELSE role
END
WHERE role IN ('EDITOR', 'ROSTER_MANAGER', 'CHECKIN_STAFF', 'ALBUM_MODERATOR');

ALTER TABLE member_event_managers
  ADD CONSTRAINT member_event_managers_role_ck CHECK (
    role IN ('EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF')
  );
