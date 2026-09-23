-- New UUID/app-scoped drafts coexist with legacy BIGINT drafts; old rows remain quarantined.
ALTER TABLE mip_event_drafts
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN operator_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN event_uid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1,
  ADD KEY mip_event_drafts_owner_latest_idx (app_id, operator_user_id, updated_at, draft_id),
  ADD CONSTRAINT mip_event_drafts_owner_fk FOREIGN KEY (app_id, operator_user_id)
    REFERENCES mip_users (app_id, id),
  ADD CONSTRAINT mip_event_drafts_event_uid_fk FOREIGN KEY (app_id, event_uid)
    REFERENCES mip_events (app_id, id);
