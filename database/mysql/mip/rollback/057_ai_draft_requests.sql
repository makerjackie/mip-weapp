-- Structural rollback only. The guard rejects discarding request history.
DROP TEMPORARY TABLE IF EXISTS mip_ai_draft_requests_rollback_guard;

CREATE TEMPORARY TABLE mip_ai_draft_requests_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_ai_draft_requests_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_ai_draft_requests_rollback_guard (guard_id)
SELECT 1 FROM mip_ai_draft_requests LIMIT 1;

DROP TEMPORARY TABLE mip_ai_draft_requests_rollback_guard;
DROP TABLE IF EXISTS mip_ai_draft_requests;
