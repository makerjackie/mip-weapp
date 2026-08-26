-- Structural rollback only. It fails closed while a daily ingestion plan exists.
DROP TABLE IF EXISTS mip_knowledge_daily_ingestion_rollback_guard;

CREATE TABLE mip_knowledge_daily_ingestion_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_knowledge_daily_ingestion_rollback_guard (guard_id) VALUES (1);
INSERT INTO mip_knowledge_daily_ingestion_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_ingestion_schedules LIMIT 1;

DROP TABLE mip_knowledge_daily_ingestion_rollback_guard;
DROP TABLE IF EXISTS mip_knowledge_ingestion_schedules;
