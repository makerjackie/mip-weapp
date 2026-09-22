-- M03: Event feedback export — adds index for feedback export queries.
--
-- Structured event feedback data is already persisted in
-- mip_event_feedback.answers_json (added in migration 060). The admin-web
-- feedback export action reads answers_json directly and projects the
-- structured questionnaire fields at query time. This migration adds
-- an index on event_id + submitted_at to support paginated export queries.
ALTER TABLE mip_event_feedback
  ADD INDEX idx_event_submitted (event_id, submitted_at);
