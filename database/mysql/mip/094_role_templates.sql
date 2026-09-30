-- Expand authorization readers before allowing template binding writes.
ALTER TABLE mip_admin_roles
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN base_role_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE KEY mip_admin_roles_app_role_uk (app_id, role_id),
  ADD UNIQUE KEY mip_admin_roles_app_name_uk (app_id, role_name),
  ADD CONSTRAINT mip_admin_roles_template_ck CHECK (
    (app_id IS NULL AND base_role_key IS NULL)
    OR (app_id IS NOT NULL AND base_role_key IS NOT NULL AND base_role_key IN ('PLATFORM_OPERATIONS', 'PLATFORM_FINANCE', 'BRANCH_ADMIN', 'EVENT_OWNER', 'EVENT_MANAGER', 'EVENT_STAFF') AND is_system = 0 AND JSON_TYPE(capabilities) = 'ARRAY')
  );
ALTER TABLE mip_admin_role_bindings
  ADD COLUMN role_template_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT mip_admin_bindings_template_fk FOREIGN KEY (app_id, role_template_id)
    REFERENCES mip_admin_roles (app_id, role_id) ON DELETE RESTRICT,
  ADD CONSTRAINT mip_admin_bindings_template_owner_ck CHECK (role_template_id IS NULL OR role_key <> 'PLATFORM_OWNER');
