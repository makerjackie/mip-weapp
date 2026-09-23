-- Application rollback keeps workflow facts and tenant isolation intact.
-- Old handlers ignore the appended columns. Removing review/reward facts or
-- converting UUID identities back to integers is intentionally unsupported.
SELECT 1 FROM mip_task_cards LIMIT 0;
