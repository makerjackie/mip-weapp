-- Structural rollback only. It fails closed while any knowledge/content facts remain.
DROP TABLE IF EXISTS mip_knowledge_content_rollback_guard;

CREATE TABLE mip_knowledge_content_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_knowledge_content_rollback_guard (guard_id) VALUES (1);

INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_orders WHERE order_type = 'CONTENT' LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_sources LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_categories LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_contents LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_products LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_entitlements LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_content_comment_settings LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_content_comments LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_content_comment_reports LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_ingestion_runs LIMIT 1;
INSERT INTO mip_knowledge_content_rollback_guard (guard_id)
SELECT 1 FROM mip_knowledge_ingestion_items LIMIT 1;

DROP TABLE mip_knowledge_content_rollback_guard;

ALTER TABLE mip_orders
  DROP CHECK mip_orders_type_ck,
  DROP CHECK mip_orders_plan_pair_ck,
  ADD CONSTRAINT mip_orders_type_ck CHECK (order_type IN ('MEMBERSHIP', 'EVENT')),
  ADD CONSTRAINT mip_orders_plan_pair_ck CHECK (
    (order_type = 'MEMBERSHIP' AND membership_plan_id IS NOT NULL AND resource_id IS NULL)
    OR (order_type = 'EVENT' AND membership_plan_id IS NULL AND resource_id IS NOT NULL)
  );

DROP TABLE IF EXISTS mip_knowledge_ingestion_items;
DROP TABLE IF EXISTS mip_knowledge_ingestion_runs;
DROP TABLE IF EXISTS mip_content_comment_reports;
DROP TABLE IF EXISTS mip_content_comments;
DROP TABLE IF EXISTS mip_content_comment_settings;
DROP TABLE IF EXISTS mip_knowledge_entitlements;
DROP TABLE IF EXISTS mip_knowledge_products;
DROP TABLE IF EXISTS mip_knowledge_contents;
DROP TABLE IF EXISTS mip_knowledge_categories;
DROP TABLE IF EXISTS mip_knowledge_sources;
