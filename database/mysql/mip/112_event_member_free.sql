ALTER TABLE mip_events
  ADD COLUMN member_free TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_event_member_free CHECK (member_free IN (0, 1) AND (member_free = 0 OR access_type = 'PAID'));
