-- MIW-49 之后超级案例以 projects JSON 数组为权威结构（迁移 096），
-- 服务端读取对 projects 为 NULL 的旧平铺行做单项目回退。本迁移把仍为 NULL
-- 的存量行按 mip-opportunities-api normalizeProjects 的单项目包装语义补齐为
-- 等价 JSON，使存量数据与新格式一致。region 仅存在于新格式、平铺行没有对应
-- 列，保持缺省；startedOn 统一为 YYYY-MM-DD 字符串。
UPDATE mip_super_cases
SET projects = JSON_ARRAY(JSON_OBJECT(
  'projectName', project_name,
  'summary', summary,
  'startedOn', DATE_FORMAT(started_on, '%Y-%m-%d'),
  'responsibility', responsibility,
  'cityTagId', city_tag_id,
  'caseType', case_type,
  'description', description
))
WHERE projects IS NULL;
