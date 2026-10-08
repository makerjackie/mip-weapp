# 2026-10-08 活动详情页模块与底部按钮口径修复（MIW-53）

客户反馈：从「我的-活动-待参与/已参与」进入活动详情，页面与设计稿不一致——出现了设计稿没有的模块，底部 sticky 也多了不该有的黄色按钮。

## 口径（客户 2026-10-08 口述 + figma 页面「活动」核对）

- 底部 sticky（fixed action）只有两种状态：
  1. 未报名且可报名：客服胶囊 + 转发胶囊 + 黄色「立刻报名」（figma 3319_5944「活动-首页-详情 (未签到)」）；
  2. 其余一切状态（已报名、待支付、审核中、候补、已签到、已结束/已取消、暂不可报名）：仅客服 + 转发两枚胶囊平分宽度，无任何黄色主按钮（figma 1818_17142「活动详情（以签到）」）。
- 活动反馈/与你互动的入口已在参与人模块内，底部不再重复。
- 整页删除「邀请来源」「活动签到」「活动变更」三个模块（含已报名态；活动变更为同日追认口径）。报名可能性完全由服务端 `canRegister` 决定（`status==='PUBLISHED' && 无有效报名 && 时间窗内`），客户端不再自行推导 disabled 文案。
- 扫码签到链路（J0-01/J0-02）不受影响：扫码直达详情页仍自动签到；自动签到失败时提示改为「重新扫描现场活动码进入本页重试」（原「确认现场签到」主按钮随两态口径废止）。check-in 页面仍从报名完成页、支付结果页、订单详情页可达。

## 改动

- `src/packages/member/mip-events/detail/index.wxml`：删除邀请来源卡片、活动签到行与活动变更卡片；底部 sticky 主按钮加 `wx:if="{{primaryAction}}"`，客服/转发胶囊按 `primaryAction` 在 120rpx 定宽与 `flex-1` 平分之间切换。
- `src/packages/member/mip-events/detail/index.ts`：`primaryAction()` 收敛为 `canRegister ? 立刻报名 : null`；删除订单回查（openOrder）、签到页跳转（openCheckIn）、`event.changes` 归一化及 interact/registration/disabled 分支；`refreshCheckInIntent` 不再驱动主按钮。服务端/管理端的变更记录能力不动，仅会员端详情页不再展示。
- 测试同步：`event-registration-experience`（订单链接/紧凑结构断言改两态口径 + 模块删除反断言）、`mip-free-event-vertical`、`mip-event-detail-auto-checkin`（重扫码提示）、`mip-event-feedback-page`（去除旧 ATTENDED→interact 优先级断言）。
- `docs/mip/COVERAGE_MATRIX.md` 活动详情行同步两态口径与模块删除事实。

## 验证

- `pnpm typecheck`、`pnpm test`（256 文件 / 1541 测试）、`pnpm verify`（构建、服务端合同 697 sources、docs facts）全部通过。
- 本机开发者工具整页截图（`scripts/fullpage-shot.mjs`，注入 fixture 造数，产物在 `.tmp/miw53/`，未入库）：
  - 已报名态：fixture 故意带 `invitationAttribution` 与 `canCheckIn: true`，页面未渲染这两个模块，底部仅客服+转发双胶囊 —— 与 figma 1818_17142 一致。
  - 未报名态：客服+转发+黄色立刻报名 —— 与 figma 3319_5944 一致。
- 局限：截图为模拟器注入数据，非真机；正式环境真实报名态（含待支付、候补）需真机复核。仅改动小程序端，无云函数与 Web 后台变更。
