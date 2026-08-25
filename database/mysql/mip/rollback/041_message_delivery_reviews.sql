DROP TABLE IF EXISTS mip_message_delivery_reviews_rollback_guard;

CREATE TABLE mip_message_delivery_reviews_rollback_guard (
  guard_id TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (guard_id)
) ENGINE=InnoDB;

INSERT INTO mip_message_delivery_reviews_rollback_guard (guard_id) VALUES (1);

-- Review rows are durable operator evidence and must be exported before a rollback.
INSERT INTO mip_message_delivery_reviews_rollback_guard (guard_id)
SELECT 1 FROM mip_message_delivery_reviews LIMIT 1;

DROP TABLE mip_message_delivery_reviews_rollback_guard;

DROP TABLE IF EXISTS mip_message_delivery_reviews;
