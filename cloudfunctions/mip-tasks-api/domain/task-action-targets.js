'use strict'

// MIW-97：PAGE_JUMP 目标页白名单（DEF-15 防御收口）。
// 与 admin-web 构建期过滤（admin-web/src/modules/admin-task-management.ts 的
// TASK_JUMP_TARGET_OPTIONS）同源同口径：取自 config/runtime-pages.json 路由，
// 排除 packages/admin/ 前缀与必须带 query 才可达的页面，存储口径剥前导 /、禁 query。
// 云函数无法读取仓库配置文件，故以常量承载；tests/mip-task-action-whitelist.test.ts
// 按同一过滤规则派生期望集合并与这里逐项比对，配置漂移时测试红提示同步本文件。
const TASK_JUMP_TARGET_WHITELIST = [
  'pages/index/index',
  'packages/member/announcements/index',
  'pages/events/index',
  'pages/profile/index',
  'packages/member/mip-visibility-settings/index',
  'packages/member/orders/index',
  'packages/member/privacy/index',
  'packages/member/bind-phone/index',
  'packages/member/privacy-settings/index',
  'packages/member/privacy-policy/index',
  'packages/member/user-agreement/index',
  'packages/member/help/index',
  'packages/member/about/index',
  'pages/opportunities/index',
  'packages/member/mip-profile/index',
  'packages/member/mip-branches/index',
  'packages/member/mip-events/mine/index',
  'packages/member/mip-events/check-in/index',
  'packages/member/mip-opportunities/editor/index',
  'packages/member/mip-opportunity-settings/index',
  'packages/member/mip-cooperation/editor/index',
  'packages/member/mip-cases/editor/index',
  'packages/member/mip-cases/city-selector/index',
  'packages/member/mip-growth/index',
  'packages/member/mip-experience-details/index',
  'packages/member/mip-badges/index',
  'packages/member/mip-card/index',
  'packages/member/mip-card-edit/index',
  'packages/member/mip-tasks/index',
  'packages/member/mip-notifications/index',
  'packages/member/mip-received/index',
  'packages/member/mip-hearts/index',
  'packages/member/mip-blocked/index',
  'packages/member/mip-ai/voice/index',
]

function isTaskJumpTargetAllowed(actionTarget) {
  return TASK_JUMP_TARGET_WHITELIST.includes(actionTarget)
}

module.exports = { TASK_JUMP_TARGET_WHITELIST, isTaskJumpTargetAllowed }
