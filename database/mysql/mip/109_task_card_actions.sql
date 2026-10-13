-- MIW-84：任务点击动作后台可配置（PAGE_JUMP 跳转页面 / SHARE 触发分享）。
-- 等级任务移除「进入详情页提交+管理员核验」入口后，点击去向由运营按任务配置；
-- NULL（含全部存量 mock 数据）= 未配置，玩家端整卡不可点，不做数据回填（产品裁决 2026-10-14）。
-- action_target 存储口径与 config/runtime-pages.json 一致（不带前导 /，禁 query），
-- 仅 action_type='PAGE_JUMP' 时有值；tab 页由小程序端按 app.json 清单分流 switchTab。
ALTER TABLE mip_task_cards
  ADD COLUMN action_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN action_target VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL;
