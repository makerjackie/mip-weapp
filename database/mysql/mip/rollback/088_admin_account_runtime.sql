-- Restoring the former global login uniqueness fails safely if apps now share a login name.
ALTER TABLE mip_admin_accounts
  DROP FOREIGN KEY mip_admin_accounts_linked_user_fk,
  DROP INDEX mip_admin_accounts_app_user_uk,
  DROP INDEX mip_admin_accounts_app_login_uk,
  ADD UNIQUE KEY mip_admin_accounts_login_uk (login_account),
  DROP COLUMN created_by_user_id, DROP COLUMN managed_scope_id, DROP COLUMN managed_scope_type,
  DROP COLUMN binding_id, DROP COLUMN linked_user_id, DROP COLUMN app_id;
