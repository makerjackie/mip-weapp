-- M96: Super case multi-project (figma 2173_42605 editor + 2037_12261 detail).
-- Store the per-project blocks on mip_super_cases as JSON. The flat mirror
-- columns keep serving list views, read projections, and legacy writers.

ALTER TABLE mip_super_cases
  ADD COLUMN projects JSON NULL AFTER description;
