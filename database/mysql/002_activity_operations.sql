-- Append-only activity fulfillment fields for cancel convergence, roster, check-in, and optimistic concurrency.
-- Does not recreate registration_deadline, cover_asset_id, or address (already present in 001).
-- Leaves location as the compatibility display field; venue_name is the structured venue label.

ALTER TABLE member_events
  ADD COLUMN venue_name VARCHAR(120) NOT NULL DEFAULT '' AFTER location,
  ADD COLUMN cancellation_policy VARCHAR(1000) NOT NULL DEFAULT '' AFTER address,
  ADD COLUMN cancelled_at DATETIME(3) NULL AFTER status,
  ADD COLUMN cancelled_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER cancelled_at,
  ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_by,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason,
  ADD CONSTRAINT member_events_version_ck CHECK (version > 0);

ALTER TABLE member_registrations
  ADD COLUMN ticket_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER status,
  ADD COLUMN attended_at DATETIME(3) NULL AFTER registered_at,
  ADD COLUMN attended_by VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attended_at,
  ADD COLUMN cancelled_at DATETIME(3) NULL AFTER attended_by,
  ADD COLUMN cancelled_by_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER cancelled_at,
  ADD COLUMN cancellation_reason VARCHAR(500) NULL AFTER cancelled_by_type,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER cancellation_reason,
  ADD CONSTRAINT member_registrations_version_ck CHECK (version > 0),
  ADD CONSTRAINT member_registrations_cancelled_by_type_ck CHECK (
    cancelled_by_type IS NULL OR cancelled_by_type IN ('MEMBER', 'EVENT', 'SYSTEM')
  ),
  ADD UNIQUE KEY member_registrations_ticket_uk (app_id, ticket_code),
  ADD KEY member_registrations_roster_idx (app_id, event_id, status, registered_at, id);
