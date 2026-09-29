-- Runtime rollback must retain this additive schema and template-aware readers.
-- Dropping template columns would silently expand permissions for bound accounts.
SELECT role_id FROM mip_admin_roles WHERE app_id IS NOT NULL LIMIT 0;
