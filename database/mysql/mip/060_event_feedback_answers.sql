ALTER TABLE mip_event_feedback
  ADD COLUMN answers_json JSON NULL AFTER body;
