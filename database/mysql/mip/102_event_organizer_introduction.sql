-- 后台「主办方介绍」图文内容列（小程序需求 C1：活动详情需展示活动介绍、主办方介绍、报名须知）。
-- 与 description 同为 TEXT，由运营在管理后台编辑、小程序「主办方」Tab 原样展示；
-- 未配置时为 NULL，详情页回退到空态文案。仅描述性内容，不参与任何运行时判定。
ALTER TABLE mip_events
  ADD COLUMN organizer_introduction TEXT NULL AFTER description;
