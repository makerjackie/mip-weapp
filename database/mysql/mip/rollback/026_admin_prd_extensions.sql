ALTER TABLE mip_admin_export_tickets
  DROP CHECK mip_admin_export_tickets_type_ck,
  ADD CONSTRAINT mip_admin_export_tickets_type_ck CHECK (
    export_type IN ('USERS', 'EVENT_ROSTER', 'EVENT_ORDERS', 'ORDERS', 'GROWTH_ENTRIES')
  );

ALTER TABLE mip_events
  DROP CHECK mip_events_archive_ck,
  DROP CHECK mip_events_status_ck,
  DROP FOREIGN KEY mip_events_archiver_fk,
  DROP COLUMN archive_reason,
  DROP COLUMN archived_by_user_id,
  DROP COLUMN archived_at,
  ADD CONSTRAINT mip_events_status_ck CHECK (
    status IN ('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'CANCELLED', 'ENDED')
  );

DROP TABLE IF EXISTS mip_growth_level_benefits;
DROP TABLE IF EXISTS mip_growth_benefits;

ALTER TABLE mip_growth_levels
  DROP KEY mip_growth_levels_sort_idx,
  DROP COLUMN display_badge,
  DROP COLUMN sort_order;

ALTER TABLE mip_opportunities
  DROP KEY mip_opportunities_deadline_idx,
  DROP COLUMN deadline_at;
