-- Legacy rows lack a trusted application/user relationship and remain unreachable.
ALTER TABLE mip_admin_accounts
  ADD COLUMN app_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN linked_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN binding_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN managed_scope_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN managed_scope_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN created_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  DROP INDEX mip_admin_accounts_login_uk,
  ADD UNIQUE KEY mip_admin_accounts_app_login_uk (app_id, login_account),
  ADD UNIQUE KEY mip_admin_accounts_app_user_uk (app_id, linked_user_id),
  ADD CONSTRAINT mip_admin_accounts_linked_user_fk FOREIGN KEY (app_id, linked_user_id) REFERENCES mip_users (app_id, id);
