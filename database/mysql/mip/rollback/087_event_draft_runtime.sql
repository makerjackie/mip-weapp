ALTER TABLE mip_event_drafts
  DROP FOREIGN KEY mip_event_drafts_event_uid_fk,
  DROP FOREIGN KEY mip_event_drafts_owner_fk,
  DROP KEY mip_event_drafts_owner_latest_idx,
  DROP COLUMN version,
  DROP COLUMN event_uid,
  DROP COLUMN operator_user_id,
  DROP COLUMN app_id;
