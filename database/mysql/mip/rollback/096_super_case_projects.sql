-- Rollback keeps the flat mirror columns authoritative; project blocks live on
-- in backups only, matching the pre-096 single-project contract.
ALTER TABLE mip_super_cases
  DROP COLUMN projects;
