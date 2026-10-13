-- 回退任务点击动作列：删列即可（action_type 全 NULL、无数据回填，
-- 服务端旧代码读不到列即视为未配置，玩家端整卡不可点回到纯展示）。
ALTER TABLE mip_task_cards
  DROP COLUMN action_type,
  DROP COLUMN action_target;
