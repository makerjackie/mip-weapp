ALTER TABLE mip_event_registrations
  DROP FOREIGN KEY mip_event_registrations_abnormal_actor_fk,
  DROP FOREIGN KEY mip_event_registrations_import_actor_fk,
  DROP CHECK mip_event_registrations_role_mark_ck,
  DROP CHECK mip_event_registrations_source_ck,
  DROP COLUMN abnormal_by_user_id,
  DROP COLUMN abnormal_marked_at,
  DROP COLUMN abnormal_reason,
  DROP COLUMN role_mark,
  DROP COLUMN import_reason,
  DROP COLUMN imported_at,
  DROP COLUMN imported_by_user_id,
  DROP COLUMN registration_source;
