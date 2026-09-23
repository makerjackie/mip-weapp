ALTER TABLE mip_event_registrations
  ADD COLUMN registration_source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'USER',
  ADD COLUMN imported_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN imported_at DATETIME(3) NULL,
  ADD COLUMN import_reason VARCHAR(120) NULL,
  ADD COLUMN role_mark VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN abnormal_reason VARCHAR(120) NULL,
  ADD COLUMN abnormal_marked_at DATETIME(3) NULL,
  ADD COLUMN abnormal_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD CONSTRAINT mip_event_registrations_source_ck CHECK (registration_source IN ('USER', 'ADMIN_IMPORT')),
  ADD CONSTRAINT mip_event_registrations_role_mark_ck CHECK (role_mark IS NULL OR role_mark IN ('GUEST', 'MEMBER', 'PLAYER')),
  ADD CONSTRAINT mip_event_registrations_import_actor_fk FOREIGN KEY (app_id, imported_by_user_id)
    REFERENCES mip_users (app_id, id),
  ADD CONSTRAINT mip_event_registrations_abnormal_actor_fk FOREIGN KEY (app_id, abnormal_by_user_id)
    REFERENCES mip_users (app_id, id);
