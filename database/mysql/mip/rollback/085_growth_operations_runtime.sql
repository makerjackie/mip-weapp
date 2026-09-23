-- Preserve financial history and quarantined legacy records on application rollback.
-- The additive schema remains compatible with the previous application.
SELECT 1 FROM mip_contribution_rules LIMIT 0;
