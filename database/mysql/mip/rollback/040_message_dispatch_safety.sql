DROP TABLE IF EXISTS mip_message_dispatch_safety_rollback_guard;

CREATE TABLE mip_message_dispatch_safety_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_message_dispatch_safety_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_message_dispatch_safety_rollback_guard (guard_id)
SELECT 1 FROM mip_message_campaign_dispatches LIMIT 1;

-- Delivery outcomes are safety evidence; rolling back while any exist would erase that evidence.
INSERT INTO mip_message_dispatch_safety_rollback_guard (guard_id)
SELECT 1 FROM mip_delivery_tasks LIMIT 1;

DROP TABLE mip_message_dispatch_safety_rollback_guard;

ALTER TABLE mip_message_campaigns
  DROP CHECK mip_message_campaigns_active_dispatch_ck,
  DROP FOREIGN KEY mip_message_campaigns_active_dispatch_fk,
  DROP KEY mip_message_campaigns_active_dispatch_fk_idx,
  DROP KEY mip_message_campaigns_active_dispatch_uk,
  DROP COLUMN active_dispatch_id;

DROP TABLE IF EXISTS mip_message_campaign_dispatches;

ALTER TABLE mip_delivery_tasks
  DROP CHECK mip_delivery_tasks_outcome_state_ck,
  DROP CHECK mip_delivery_tasks_attempts_ck,
  DROP CHECK mip_delivery_tasks_retry_ck,
  DROP CHECK mip_delivery_tasks_outcome_ck,
  DROP KEY mip_delivery_tasks_safe_retry_idx,
  DROP COLUMN outcome_updated_at,
  DROP COLUMN retry_disposition,
  DROP COLUMN last_outcome;
