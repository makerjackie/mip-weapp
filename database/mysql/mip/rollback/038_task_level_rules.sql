DROP TABLE IF EXISTS mip_task_level_rules_rollback_guard;

CREATE TABLE mip_task_level_rules_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_task_level_rules_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_task_level_rules_rollback_guard (guard_id)
SELECT 1 FROM mip_task_level_rules LIMIT 1;

DROP TABLE mip_task_level_rules_rollback_guard;

DROP TABLE IF EXISTS mip_task_level_rules;
