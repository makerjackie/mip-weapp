-- Keep compatible metadata and foreign keys when rolling back application consumers.
-- This rollback intentionally preserves leaders, ordering, and all historical business data.
SELECT id FROM mip_city_branches LIMIT 0;
