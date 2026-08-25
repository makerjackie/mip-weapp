DROP TABLE IF EXISTS mip_message_templates_rollback_guard;

CREATE TABLE mip_message_templates_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_message_templates_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_message_templates_rollback_guard (guard_id)
SELECT 1 FROM mip_message_templates LIMIT 1;

DROP TABLE mip_message_templates_rollback_guard;

DROP TABLE IF EXISTS mip_message_template_revisions;
DROP TABLE IF EXISTS mip_message_templates;
