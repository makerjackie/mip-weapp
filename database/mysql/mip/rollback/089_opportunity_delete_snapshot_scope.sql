ALTER TABLE mip_opportunity_delete_snapshots
  DROP KEY mip_opportunity_delete_snapshots_tenant_uk,
  DROP COLUMN source_version,
  DROP COLUMN deleted_by_user_id,
  DROP COLUMN opportunity_uid,
  DROP COLUMN app_id;
