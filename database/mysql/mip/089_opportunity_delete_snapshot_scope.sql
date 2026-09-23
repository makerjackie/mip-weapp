-- Legacy BIGINT snapshot rows remain unscoped and unreachable to the UUID runtime.
ALTER TABLE mip_opportunity_delete_snapshots
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN opportunity_uid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN deleted_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN source_version BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY mip_opportunity_delete_snapshots_tenant_uk (app_id, opportunity_uid);
