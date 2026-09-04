DROP TABLE IF EXISTS mip_event_feedback_answers_rollback_guard;

CREATE TABLE mip_event_feedback_answers_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_event_feedback_answers_rollback_guard (guard_id) VALUES (1);

-- Structured feedback must be exported before removing its only persisted copy.
INSERT INTO mip_event_feedback_answers_rollback_guard (guard_id)
SELECT 1
FROM mip_event_feedback
WHERE answers_json IS NOT NULL
LIMIT 1;

DROP TABLE mip_event_feedback_answers_rollback_guard;

ALTER TABLE mip_event_feedback
  DROP COLUMN answers_json;
