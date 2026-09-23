ALTER TABLE mip_event_checkins DROP INDEX mip_event_checkins_user_active_idx;
ALTER TABLE mip_event_hearts
  DROP INDEX mip_event_hearts_received_unread_idx,
  DROP COLUMN received_read_at;
