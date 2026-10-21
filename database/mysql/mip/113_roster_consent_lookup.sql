-- Latest per-user roster consent is checked before pagination and again for current visibility.
ALTER TABLE mip_event_feedback
  ADD INDEX mip_event_feedback_consent_idx (app_id, user_id, updated_at DESC, id DESC);
