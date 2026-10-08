# 2026-10-08 活动详情页模块与底部按钮口径修复（MIW-53）

客户反馈：从「我的-活动-待参与/已参与」进入活动详情，页面与设计稿不一致——出现了设计稿没有的模块，底部 sticky 也多了不该有的黄色按钮。同日第三段口径：「主办方」Tab 应展示后台配置的主办方介绍富文本（小程序需求 C1/TC-C-01），而非主办方资料卡。

## 口径（客户 2026-10-08 口述 + figma 页面「活动」核对）

- 底部 sticky（fixed action）只有两种状态：
  1. 未报名且可报名：客服胶囊 + 转发胶囊 + 黄色「立刻报名」（figma 3319_5944「活动-首页-详情 (未签到)」）；
  2. 其余一切状态（已报名、待支付、审核中、候补、已签到、已结束/已取消、暂不可报名）：仅客服 + 转发两枚胶囊平分宽度，无任何黄色主按钮（figma 1818_17142「活动详情（以签到）」）。
- 活动反馈/与你互动的入口已在参与人模块内，底部不再重复。
- 整页删除「邀请来源」「活动签到」「活动变更」三个模块（含已报名态；活动变更为同日追认口径）。报名可能性完全由服务端 `canRegister` 决定（`status==='PUBLISHED' && 无有效报名 && 时间窗内`），客户端不再自行推导 disabled 文案。
- 扫码签到链路（J0-01/J0-02）不受影响：扫码直达详情页仍自动签到；自动签到失败时提示改为「重新扫描现场活动码进入本页重试」（原「确认现场签到」主按钮随两态口径废止）。check-in 页面仍从报名完成页、支付结果页、订单详情页可达。
- 「主办方」Tab（同日追加口径，小程序需求 C1：查看活动详情 → 展示活动基础信息、活动介绍（图文）、主办方介绍、报名须知；TC-C-01 验收：主办方介绍与后台配置一致）：
  - 迁移 102 为 `mip_events` 增加 `organizer_introduction TEXT NULL`；
  - 后台活动表单新增「主办方介绍」多行文本（≤2 万字，与活动介绍同 `contentSafety` 审核通道；复制活动/复制为草稿时随源带出，回读进编辑表单与移动端预览卡）；
  - `mip-events-api` 详情投影未配置时不下发该键；
  - 小程序「主办方」Tab 与「活动介绍」同用 `eventRichTextNodes` 富文本通道原样渲染（解析器支持内联图片即满足图文口径），未配置回退「暂无主办方介绍」；旧的主办方资料卡（头像/昵称/一句话介绍/跳转公开档案）从本页删除；
  - 范围裁定：走 TEXT 富文本通道（图文经富文本内联图片表达），不引入第二个媒体 asset-list 表——与「活动介绍」能力对齐，如需「主办方介绍媒体」独立图集再另行立项。

## 改动

- `src/packages/member/mip-events/detail/index.wxml`：删除邀请来源卡片、活动签到行与活动变更卡片；底部 sticky 主按钮加 `wx:if="{{primaryAction}}"`，客服/转发胶囊按 `primaryAction` 在 120rpx 定宽与 `flex-1` 平分之间切换；ORGANIZER 分支改为主办方介绍富文本 + 空态。
- `src/packages/member/mip-events/detail/index.ts`：`primaryAction()` 收敛为 `canRegister ? 立刻报名 : null`；删除订单回查（openOrder）、签到页跳转（openCheckIn）、`event.changes` 归一化及 interact/registration/disabled 分支；`refreshCheckInIntent` 不再驱动主按钮；删除 `openOrganizer` 与 organizer 云文件归一化，新增 `organizerIntroductionNodes`。服务端/管理端的变更记录能力不动，仅会员端详情页不再展示。
- `src/modules/mip-events/types.ts` / `dto.ts`：`MipEventDetail.organizerIntroduction?`（≤5 万字透传校验，未配置缺省）。
- 云函数：`mip-admin-api`（`normalizeEventDraft`、`repositories/events.js` 读写与复制、`event-copy.js`、`lib/content-safety.js` 审核字段）与 `mip-events-api`（`event-service.js` 详情投影）。
- admin-web：`admin-event-mutation-forms.ts`（字段声明 + draft 构建 + 校验）、`event-form-loader.ts`（回填）、`event-mobile-preview.tsx`（预览卡）。
- 数据库：`database/mysql/mip/102_event_organizer_introduction.sql` + rollback + `migrations.lock.json`。
- 测试同步：`event-registration-experience`（两态口径 + 模块删除反断言 + 主办方 Tab 结构断言）、`mip-event-public-catalog-contract`（DTO 透传/缺省/上限）、`mip-free-event-vertical`、`mip-event-detail-auto-checkin`（重扫码提示）、`mip-event-feedback-page`（去除旧 ATTENDED→interact 优先级断言）、`mip-admin-api`（clone/repository/module/service 七处 + 新增落库与回读用例）、`mip-events-api`（详情投影）、`admin-event-mutation-forms.test.ts`（draft 归一与上限）。
- `docs/mip/COVERAGE_MATRIX.md` 活动详情行与活动管理行同步两态口径、模块删除与主办方介绍事实。

## 验证

- `pnpm typecheck`、`pnpm test`（256 文件 / 1543 测试）、`pnpm verify`（构建、服务端合同、docs facts）、`mip-admin-api` node:test 743 项、`mip-events-api` 159 项、admin-web 合同 238 项全部通过。
- 本机开发者工具整页截图（`scripts/fullpage-shot.mjs`，注入 fixture 造数，产物在 `.tmp/miw53/`，未入库）：
  - 已报名态：fixture 故意带 `invitationAttribution` 与 `canCheckIn: true`，页面未渲染这两个模块，底部仅客服+转发双胶囊 —— 与 figma 1818_17142 一致。
  - 未报名态：客服+转发+黄色立刻报名 —— 与 figma 3319_5944 一致。
  - 主办方 Tab 已配置态（`detail-organizer-configured-fullpage.png`）：fixture 注入 `organizerIntroduction` 富文本，「主办方」Tab 高亮，`rich-text` 原样渲染标题、段落、内联图片与联系方式（模拟器无网络，内联图片显示占位图标）。
  - 主办方 Tab 未配置态（`detail-organizer-guest-fullpage.png`）：显示「暂无主办方介绍。」空态，底栏为客服+转发+黄色立刻报名（未报名态两态口径不受影响）。
- 局限：截图为模拟器注入数据，非真机；正式环境真实报名态（含待支付、候补）需真机复核。主办方介绍的后台配置→小程序展示完整链路仅本地合同级验证，需 `mip-admin-api`/`mip-events-api`/admin-web 重新部署并应用迁移 102 后在真实后台配置一轮复核。
