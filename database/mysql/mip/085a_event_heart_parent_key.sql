-- The append-only heart transition table references (app_id, id).
-- Keep the parent key app-scoped before the history foreign key is created.
ALTER TABLE mip_event_hearts
  ADD UNIQUE KEY mip_event_hearts_app_id_uk (app_id, id);
