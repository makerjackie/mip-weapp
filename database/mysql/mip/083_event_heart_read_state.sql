-- The recipient's read state is independent of the heart relationship/version.
ALTER TABLE mip_event_hearts
  ADD COLUMN received_read_at DATETIME(3) NULL,
  ADD KEY mip_event_hearts_received_unread_idx (app_id, target_user_id, status, received_read_at, updated_at);

ALTER TABLE mip_event_checkins
  ADD KEY mip_event_checkins_user_active_idx (app_id, user_id, status, event_id, checked_in_at);
