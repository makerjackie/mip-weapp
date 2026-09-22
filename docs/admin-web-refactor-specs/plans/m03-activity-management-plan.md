# M03 活动管理增强 实现计划

- 优先级：P0（FR-006 活动反馈）+ P1（FR-015 签到码 / FR-017 手机端预览 / FR-018 报名联动 / FR-016 统计下钻 Wave 2）
- 波次：Wave 1（FR-006 / FR-015 / FR-017 / FR-018 独立可并行）+ Wave 2（FR-016 依赖 FR-006）
- 模块：M03
- 范围：`admin-web/` 活动详情、活动编辑表单、活动行操作、活动 mutation 表单定义，以及 `packages/admin-contracts` 契约扩展
- 关联规格：[../03-activity-management.md](../03-activity-management.md)

## 1. 目标和范围

在现有活动详情 `loadEventDetail`（`admin-web/src/modules/admin-details.ts:210-342`，含 活动信息 → 参与情况 → 互动数据 → 财务数据 → 反馈数据 → 报名名单 → 待审核相册 七个 section）与活动 mutation 表单（`admin-web/src/modules/admin-event-mutation-forms.ts`，10 个 action）的基础上，补齐五项能力：

1. **FR-006（P0）**：活动详情新增独立「活动反馈」section，反馈明细列表 + 异步四步导出。现状 `feedbackSection`（`admin-details.ts:357-369`）仅展示 5 个聚合指标，无明细。
2. **FR-015（P1）**：每场活动生成唯一签到二维码，活动详情和列表行操作均可下载。现状无签到码入口。
3. **FR-017（P1）**：活动编辑表单新增「预览」按钮，以手机尺寸弹层展示小程序活动详情页效果，纯前端、不产生业务数据。现状 `event-edit-form-page.tsx`（48 行）无预览入口，`IndependentFormPageConfig`（`independent-form-page.tsx:87-97`）无预览槽位。
4. **FR-018（P1）**：报名管理扩展补录 / 取消 / 标记异常。现状 `eventRegistrationRowActions`（`admin-row-operations.ts:55-75`）仅支持 审核 / 签到 / 撤销签到。
5. **FR-016（P1，Wave 2）**：统计下钻，扩展 `events.insights.get` 出参 + 新增 `events.hearts.list`，依赖 FR-006 反馈数据源。

非目标：

- 不改写小程序端报名 / 签到 / 支付链路，扫码签到幂等由服务端 `events.checkIn` 保证。
- 不在本计划重新定义退费规则，FR-018 取消报名对付费活动沿用现有退款 action。
- 不新建独立路由页面承载反馈列表；反馈作为活动详情 section 内的分页表，复用 `AdminDetailPagerKey` 分页模型。
- 不改 `independent-form-page.tsx` 的提交 / 校验主流程，仅在 `IndependentFormPageConfig` 增加可选预览槽位。

## 2. 实现步骤（按 FR 顺序，每步具体到文件、函数、行号）

### 步骤 2.1 FR-006 契约扩展 — `packages/admin-contracts`

文件：`packages/admin-contracts/src/generated/admin-operation-contract.ts`

- 在 events action 清单（第 201-457 行区间，QUERY 段约 201-297、MUTATION 段约 361-457）追加：
  - QUERY：`mip.admin.events.feedbacks.list`，入参 `{ eventId, cursor?, limit?, filters? }`，出参 `{ items, nextCursor }`；`items[].` 字段含 `feedbackId / userId / nickname / submittedAt / rating / wouldRecommend / capabilityRoles[] / referralResources / joinMipIntent / learnMoreChannels[] / joinRoster`。
  - MUTATION：`mip.admin.events.feedbacks.export`，入参 `{ eventId, filters? }`，接入异步四步导出（create→prepare→reserve→complete），出参为 `{ ticketId }`，与 `admin-sensitive-export.ts` 的四步工作流对齐。
- 同步更新 `admin-contracts` 生成入口（`packages/admin-contracts/src/index.ts`）的类型导出，确保 `AdminOperationAction` 联合类型包含两个新 action。

注意：契约文件为生成产物，改动前确认生成脚本来源（见 `packages/admin-contracts` 的 build 脚本）；若存在 source schema，改 source 后重新生成，不手改生成文件。

### 步骤 2.2 FR-006 详情加载扩展 — `admin-details.ts`

文件：`admin-web/src/modules/admin-details.ts`

- `AdminDetailOptions`（第 28-37 行）：新增 `includeEventFeedback?: boolean`，与 `includeEventAlbum` 同级。同时新增 `eventFeedback?: { cursor?: string | null; limit?: number }` 分页参数，仿照 `eventRoster`（第 34 行）。
- `AdminDetailPagerKey`（第 39 行）：在 `'eventRoster' | 'taskMembers' | 'taskCompletions' | 'gameMembers'` 联合中追加 `'eventFeedback'`。
- `loadEventDetail`（第 210-342 行）：
  - 第 222-236 行 `Promise.all`：新增第 5 个并行请求——当 `options.includeEventFeedback` 为真时调用 `request('mip.admin.events.feedbacks.list', { eventId, limit, cursor })`，否则 `Promise.resolve({ items: [], nextCursor: null })`。
  - 第 244 行后新增 `const feedbackList = pageRecords(feedbackListValue)`、`const feedbackPage = record(feedbackListValue)`。
  - 第 292 行 `sections.push(financialSection(financials), feedbackSection(feedback))` 保持不变（聚合指标 section 保留）；在其后、报名名单 section（第 293-318 行）之前插入新的「活动反馈明细」section，仅当 `options.includeEventFeedback` 为真时 push：
    - rows 映射 `feedbackList` 每条为 `{ feedbackId, nickname, submittedAt, rating, wouldRecommend, capabilityRoles, joinMipIntent, rowActions: feedbackRowActions(eventId, item) }`。
    - columns 声明 `[['nickname','反馈用户'],['submittedAt','提交时间'],['rating','评分'],['wouldRecommend','推荐'],['capabilityRoles','能力角色'],['joinMipIntent','加入意愿']]`。
    - pager 复用 `eventFeedback` key，`nextCursor` 取自 `feedbackPage.nextCursor`，placeholder `活动反馈`。
  - 第 340 行 `source` 返回对象：新增 `feedbackList`、`feedbackPage` 字段，供详情页 actions 组件读取（`admin-detail-actions.tsx` 通过 `view.source` 取值）。
- 新增 `feedbackRowActions(eventIdValue, feedback)` 工厂函数（放本文件末尾或 `admin-row-operations.ts`，建议放 `admin-row-operations.ts` 以集中行操作，见步骤 2.9）：返回导出单条反馈的行操作，或返回空数组（明细导出走 section 级按钮，单条无操作）。本计划中明细 section 不提供单条行操作，`feedbackRowActions` 仅作为占位返回 `[]`，便于后续扩展反馈回复。

### 步骤 2.3 FR-006 反馈导出接入异步四步工作流 — `admin-sensitive-export.ts` + `sensitive-export-button.tsx`

文件：`admin-web/src/modules/admin-sensitive-export.ts`

- 第 11 行 `SensitiveExportKind`：从 `'users' | 'orders'` 扩展为 `'users' | 'orders' | 'eventFeedbacks'`。
- 第 123 行 `exportType: workflow.input.kind === 'users' ? 'USERS' : 'ORDERS'`：改为 switch / 三元映射，`eventFeedbacks` → `'EVENT_FEEDBACKS'`，并把 `eventId` 透传进 create 步骤 payload（需在 `SensitiveExportInput` 第 15-19 行新增 `eventId?: string`，当 `kind === 'eventFeedbacks'` 时必填）。
- 第 345 行 `includesPhone` 归一化：`eventFeedbacks` 默认不带手机号，保持 `false`；若后续需要反馈用户手机号，由 capability 控制。
- 第 385 行 `exportKey`：前缀仍用 `mip-`，`eventFeedbacks` 生成的 `fileName` 走 `fileNamePattern`（第 7 行），格式 `mip-event-feedbacks-<TS>.xlsx`，符合现有正则。

文件：`admin-web/src/features/admin-runtime/sensitive-export-button.tsx`

- 该组件现用于 users / orders 导出。FR-006 在活动详情页的「导出反馈」按钮复用此组件，传入 `kind: 'eventFeedbacks'`、`eventId`、`filters`（来自反馈 section 当前筛选）。若该组件 props 未暴露 `eventId`，新增可选 `eventId?: string` 透传。

### 步骤 2.4 FR-006 详情页 actions 接入导出按钮 — `admin-detail-actions.tsx`

文件：`admin-web/src/features/admin-runtime/admin-detail-actions.tsx`

- 第 54-75 行 `route === 'events'` 分支：
  - 在现有按钮（编辑 / 发布 / 下架 / 归档 / 克隆 / 标签 / 发布提醒）之后，当 `record(view.source?.feedbackList)` 非空或 `event.access === 'GRANTED'` 时，push 一个 `<SensitiveExportButton kind="eventFeedbacks" eventId={id} ... />`（或等价 button 触发导出工作流），label `导出反馈`，capability `events.feedbacks.export`（新能力，需在 `admin-operation-provider` 能力清单中声明）。
  - 需在该文件顶部 import `SensitiveExportButton`（若未引入）。

### 步骤 2.5 FR-006 详情页调用方传入 `includeEventFeedback`

需定位活动详情页的 loader 调用点（`use-admin-detail.ts` 或 `core-pages` 中活动详情路由）。`loadEventDetail` 的 `options` 由调用方传入，需在活动详情路由的 options 中设置 `includeEventFeedback: true` 并透传 `eventFeedback` 分页参数（来自 URL search 的 `cursor`）。

- `admin-web/src/features/admin-runtime/use-admin-detail.ts`：定位构造 `AdminDetailOptions` 的位置，为 `route === 'events'` 时追加 `includeEventFeedback: true` 与 `eventFeedback: { cursor, limit: 20 }`。
- 若分页 cursor 由 `AdminDetailPagerKey` 驱动（第 39 行），确保 `eventFeedback` key 的 cursor 从 URL search 解析（与 `eventRoster` 同路径，见 `use-core-page-query.ts` 的 pager cursor 处理）。

### 步骤 2.6 FR-015 签到二维码契约 + 下载

文件：`packages/admin-contracts/src/generated/admin-operation-contract.ts`

- QUERY 段新增 `mip.admin.events.checkinQrcode.get`，入参 `{ eventId }`，出参 `{ qrCodeAssetId, downloadUrl, format, generatedAt }`。

文件：`admin-web/src/modules/admin-event-mutation-forms.ts`

- 第 4-15 行 `EVENT_MUTATION_ACTIONS`：本 FR 不新增 mutation action（二维码获取是 QUERY），但若需要「重新生成二维码」mutation，追加 `mip.admin.events.checkinQrcode.regenerate`（P1 可选，本计划先不做，仅 get）。

文件：`admin-web/src/features/admin-runtime/admin-detail-actions.tsx`

- 第 54-75 行 events 分支：新增 `签到二维码` 按钮，点击后调用 `request('mip.admin.events.checkinQrcode.get', { eventId: id })`，拿到 `downloadUrl` 后触发浏览器下载（`window.open` 或 `<a download>`）。按钮 capability 为 `events.checkin.manage` 或 `events.write`（见规格第 65 行）。loading 态用本地 state（参考第 89-105 行 task 导出按钮的 `taskExporting` 模式）。

文件：活动列表行操作（`admin-row-operations.ts` 或列表页行操作组件）

- 在活动列表行操作中追加「下载签到码」入口，复用同一 QUERY action。需定位活动列表的行操作渲染点（`operations-pages` 或 `core-list-pages` 的 rowActions）。本计划在 `admin-row-operations.ts` 新增 `eventRowActions(eventId)` 工厂返回 `[{ action: 'mip.admin.events.checkinQrcode.get', label: '签到码', ... }]`，供列表页调用。

### 步骤 2.7 FR-017 手机端预览弹层

文件：`admin-web/src/features/form-pages/independent-form-page.tsx`

- 第 87-97 行 `IndependentFormPageConfig`：新增可选 `preview?: { render: (values: OperationValues) => React.ReactNode; capability?: string }`。不强制所有表单页提供。
- 第 163-184 行渲染区：当 `config.preview` 存在且（无 capability 或 `hasCapability` 通过）时，在 `PageHeader.actions`（第 168 行）追加一个 `预览` Button，点击 `setPreviewOpen(true)`，渲染 `<Modal>` 或 `<Drawer>` 宽度 375px，内容为 `config.preview.render(form.getFieldsValue())`。关闭后表单值保留（Modal 不 unmount 表单）。
- 注意：预览读取的是 `form.getFieldsValue()`（未保存草稿值），不触发任何写 action，报名按钮在预览组件内为禁用态。

文件：`admin-web/src/features/form-pages/event-edit-form-page.tsx`

- 第 28-41 行 `formConfig`：新增 `preview: { render: (values) => <EventMobilePreview values={values} />, capability: config.capability }`。
- 第 47 行 `return <IndependentFormPage ... />` 传入更新后的 config。

新建文件：`admin-web/src/features/form-pages/event-mobile-preview.tsx`

- 纯前端组件，接收 `values: OperationValues`，按手机端活动详情页布局渲染：封面（`coverAssetId` → 缩略图）/ 标签（`eventTypeKey`）/ 活动名称（`title`）/ 起止时间（`startsAt` / `endsAt`）/ 场地（`venueName` + `address`）/ 费用（`accessType` + `priceCents`）/ 参与人（`capacity`）/ 活动介绍（`description` + `contentMedia`）/ 报名须知（`notices`）/ 报名按钮（禁用，点击提示「预览模式不可报名」）。
- 图文按 375px 宽等比缩放，复用现有 `OperationFields` 的 asset 渲染或直接 `<img>`。
- 不依赖任何服务端 action。

### 步骤 2.8 FR-018 报名联动契约 + mutation 配置

文件：`packages/admin-contracts/src/generated/admin-operation-contract.ts`

- MUTATION 段新增 3 个 action：
  - `mip.admin.events.participants.import`，入参 `{ eventId, userId, roleMark?, reason? }`，`roleMark` 枚举 `MEMBER / GUEST / PLAYER`。
  - `mip.admin.events.participants.cancel`，入参 `{ eventId, registrationId, expectedVersion, reason }`。
  - `mip.admin.events.participants.markAbnormal`，入参 `{ eventId, registrationId, expectedVersion, reason }`。

文件：`admin-web/src/modules/admin-event-mutation-forms.ts`

- 第 4-15 行 `EVENT_MUTATION_ACTIONS`：追加 3 个 action 字符串。
- 第 109 行 `EVENT_MUTATION_CONFIGS`：追加 3 个 config 条目：
  - `participants.import`：fields `eventId(text,required) / userId(text,required) / roleMark(select, options MEMBER/GUEST/PLAYER) / reason(textarea,maxLength 120)`，capability `events.registrations.manage`。
  - `participants.cancel`：fields `eventId / registrationId / expectedVersion / reason(textarea,required,maxLength 120)`，capability `events.registrations.manage`。
  - `participants.markAbnormal`：fields 同 cancel，capability `events.registrations.manage`。
- 第 74-107 行 `eventSaveFields`：不新增签到码 / 预览字段（签到码走 QUERY，预览走前端）。

### 步骤 2.9 FR-018 行操作扩展 — `admin-row-operations.ts`

文件：`admin-web/src/modules/admin-row-operations.ts`

- 第 1-35 行 `AdminRowOperationAction` 联合类型：追加 `'mip.admin.events.participants.import' | 'mip.admin.events.participants.cancel' | 'mip.admin.events.participants.markAbnormal'`（以及 FR-006 的 `feedbacks.export` 若作为行级操作，本计划放 section 级，不加入行操作）。
- 第 55-75 行 `eventRegistrationRowActions`：
  - 现状按 `status` 分支返回单一操作。改为返回数组，在现有操作基础上追加：
    - `REGISTERED`：除「签到」外，追加「取消报名」「标记异常」（均需 `expectedVersion`）。
    - `ATTENDED`：除「撤销签到」外，追加「标记异常」。
    - `PENDING_REVIEW`：保持仅「审核」，不追加取消（审核拒绝已覆盖）。
    - 新增通用「补录报名」不挂在行操作（无已有 registrationId），走详情页或列表页顶部按钮（见步骤 2.10）。
  - 取消 / 标记异常的 `values` 含 `{ eventId, registrationId, expectedVersion, reason }`，`reason` 留空由弹窗收集（MutationDialog 会按 fields 渲染 textarea）。
- 新增 `eventFeedbackRowActions`（步骤 2.2 提及）：占位返回 `[]`。
- 新增 `eventRowActions(eventIdValue)`（FR-015 列表行签到码下载）：返回 `[{ action: 'mip.admin.events.checkinQrcode.get', label: '签到码', targetId: eventId, values: { eventId } }]`。

### 步骤 2.10 FR-018 补录报名入口 — `admin-detail-actions.tsx`

文件：`admin-web/src/features/admin-runtime/admin-detail-actions.tsx`

- 第 54-75 行 events 分支：新增 `补录报名` 按钮，触发 `participants.import` 的 MutationDialog / form page。capability `events.registrations.manage`。补录不触发支付，服务端标记来源为「后台补录」。

### 步骤 2.11 FR-016 统计下钻契约扩展（Wave 2）

文件：`packages/admin-contracts/src/generated/admin-operation-contract.ts`

- 扩展 `mip.admin.events.insights.get` 出参类型：新增 `visitCount / shareCount / heartTotalCount / composition.normalMemberCount`（普通用户数）。保持现有字段（`participation.* / composition.* / invitations.* / hearts.* / financials.* / feedback.*`）不变，向后兼容。
- QUERY 段新增 `mip.admin.events.hearts.list`，入参 `{ eventId, cursor?, limit?, filters? }`，出参 `{ items, nextCursor }`；`items[].` 含 `voterUserId / targetUserId / eventId / createdAt / relationStatus`。

### 步骤 2.12 FR-016 详情加载与下钻 section（Wave 2）

文件：`admin-web/src/modules/admin-details.ts`

- `AdminDetailOptions`：新增 `includeEventHearts?: boolean` 与 `eventHearts?: { cursor?: string | null; limit?: number }`。
- `AdminDetailPagerKey`：追加 `'eventHearts'`。
- `loadEventDetail` 第 222-236 行 `Promise.all`：新增 hearts.list 并行请求。
- 第 281-290 行「互动数据」section：在现有 metrics 基础上追加 `访问量 / 分享量 / 总心动次数 / 普通用户数`，字段取自扩展后的 insights。
- 第 292 行后插入「心动明细」section（仅当 `includeEventHearts`），rows 映射 hearts.list，columns `[['voter','心动人'],['target','被心动'],['createdAt','时间'],['relationStatus','关系状态']]`，pager key `eventHearts`。
- 下钻入口：反馈人数指标卡片可点击跳转反馈 section（锚点或 expand），心动次数卡片点击展开心动明细 section。本计划先用 section 平铺 + pager，指标卡片点击行为为可选增强（P1 可延后）。
- 反馈率 / 签到率分母为 0 时显示 `—`：`feedbackSection`（第 357-369 行）与「参与情况」section（第 269-280 行）的 `basisPoints` 调用需处理 `NaN`，在 `basisPoints` 工具函数中增加零分母保护（返回 `—`）。

## 3. 新建文件列表

| 文件 | 用途 |
|---|---|
| `admin-web/src/features/form-pages/event-mobile-preview.tsx` | FR-017 手机端预览弹层组件，纯前端，接收表单草稿值渲染 375px 宽活动详情预览 |
| `admin-web/src/modules/admin-event-feedback.test.ts`（可选） | FR-006 反馈明细 section 映射与分页 cursor 的单元测试 |
| `admin-web/src/modules/admin-event-mutation-forms.test.ts`（已存在，扩展） | FR-018 新增 3 个 action config 的字段断言 |

不新建独立路由页面。反馈 / 心动明细均作为活动详情 section，复用 `AdminDetailPagerKey` 分页。

## 4. 修改文件列表

| 文件 | 具体改动点 |
|---|---|
| `packages/admin-contracts/src/generated/admin-operation-contract.ts`（或 source schema） | 新增 7 个 action（feedbacks.list/export、checkinQrcode.get、participants.import/cancel/markAbnormal、hearts.list）；扩展 insights.get 出参字段 |
| `packages/admin-contracts/src/index.ts` | 同步导出新 action 类型到 `AdminOperationAction` 联合 |
| `admin-web/src/modules/admin-details.ts` | 第 28-37 行 `AdminDetailOptions` 加 `includeEventFeedback / eventFeedback / includeEventHearts / eventHearts`；第 39 行 `AdminDetailPagerKey` 加 `eventFeedback / eventHearts`；第 222-236 行 `Promise.all` 加反馈 / 心动并行请求；第 244 行后解析 `feedbackList / heartsList`；第 292 行后插入反馈明细 / 心动明细 section；第 340 行 `source` 加 `feedbackList / feedbackPage / heartsList`；第 357-369 行 `feedbackSection` 零分母保护 |
| `admin-web/src/modules/admin-event-mutation-forms.ts` | 第 4-15 行 `EVENT_MUTATION_ACTIONS` 加 3 个 participants action；第 109 行 `EVENT_MUTATION_CONFIGS` 加 3 个 config（import/cancel/markAbnormal），capability `events.registrations.manage` |
| `admin-web/src/modules/admin-row-operations.ts` | 第 1-35 行 `AdminRowOperationAction` 加 participants 3 action + checkinQrcode.get；第 55-75 行 `eventRegistrationRowActions` 按 status 追加取消 / 标记异常；新增 `eventFeedbackRowActions`（占位）、`eventRowActions`（签到码下载） |
| `admin-web/src/features/admin-runtime/admin-detail-actions.tsx` | 第 54-75 行 events 分支加 `导出反馈` / `签到二维码` / `补录报名` 按钮；import `SensitiveExportButton` |
| `admin-web/src/features/admin-runtime/use-admin-detail.ts` | 活动 detail options 传入 `includeEventFeedback: true / eventFeedback: { cursor, limit }`；Wave 2 加 `includeEventHearts` |
| `admin-web/src/features/form-pages/independent-form-page.tsx` | 第 87-97 行 `IndependentFormPageConfig` 加 `preview?` 槽位；第 163-184 行渲染区加预览 Modal/Drawer（375px） |
| `admin-web/src/features/form-pages/event-edit-form-page.tsx` | 第 28-41 行 `formConfig` 加 `preview.render`，引用 `EventMobilePreview` |
| `admin-web/src/modules/admin-sensitive-export.ts` | 第 11 行 `SensitiveExportKind` 加 `eventFeedbacks`；第 15-19 行 `SensitiveExportInput` 加 `eventId?`；第 123 行 create payload 映射 `EVENT_FEEDBACKS` + `eventId`；第 345 行 includesPhone 归一 |
| `admin-web/src/features/admin-runtime/sensitive-export-button.tsx` | props 加 `eventId?` 透传给 workflow input |
| `admin-web/src/modules/admin-event-mutation-forms.test.ts` | 扩展断言覆盖 3 个新 participants action config 字段 |
| `admin-web/src/modules/admin-details.test.ts` | 扩展断言覆盖反馈明细 section、心动明细 section、分页 cursor、零分母显示 |

## 5. 测试要点

1. **FR-006 反馈明细 section**：`loadEventDetail` 在 `includeEventFeedback: true` 时返回反馈明细 rows；`access !== 'GRANTED'` 时不返回明细（与聚合 `feedbackSection` 权限一致）；反馈用户为空或字段未填写时行显示 `—`。
2. **FR-006 分页**：`eventFeedback` pager 的 `nextCursor` 透传正确；URL search 的 `cursor` 变化触发重新加载（与 `eventRoster` 同路径）。
3. **FR-006 导出**：`eventFeedbacks` kind 走完 create→prepare→reserve→complete 四步；`downloadUrl` / `contentSha256` 校验通过；导出文件名匹配 `mip-event-feedbacks-*.xlsx`；敏感字段脱敏。
4. **FR-015 签到码**：`checkinQrcode.get` 返回 `downloadUrl` 后浏览器下载触发；按钮 capability 为 `events.checkin.manage` 或 `events.write`，无权限时按钮不渲染；活动列表行操作「签到码」与详情页按钮调用同一 action。
5. **FR-015 真机**：已报名用户扫码签到 → 服务端 `events.checkIn` 幂等；重复扫码提示「已签到」——需真机验证（小程序扫码链路）。
6. **FR-017 预览**：点击「预览」弹出 375px Modal；内容来自 `form.getFieldsValue()` 未保存草稿；关闭后表单值保留；报名按钮禁用且点击提示；不触发任何写 action（网络面板无 mutation 请求）。
7. **FR-018 补录**：`participants.import` payload 含 `userId / roleMark`，不含支付字段；服务端标记来源「后台补录」。
8. **FR-018 取消 / 标记异常**：行操作按 status 正确返回（REGISTERED→签到+取消+异常，ATTENDED→撤销+异常）；`expectedVersion` 透传；`reason` 必填校验。
9. **FR-018 支付联动**：付费活动支付失败不进入「已报名」——此为服务端契约，前端仅展示状态，需配合服务端测试。
10. **FR-016 统计下钻**：扩展后的 insights.get 出参向后兼容，现有 `loadEventDetail` 的参与情况 / 互动 / 财务 / 反馈 section 不破坏；零分母（签到率 / 反馈率）显示 `—`；心动明细分页 cursor 正确。
11. **回归**：现有 10 个 event mutation action 配置不变；`eventSaveFields` 不变；活动详情原有 7 个 section 顺序与字段不变。

## 6. 验收检查清单

- [ ] 契约新增 7 个 action（feedbacks.list/export、checkinQrcode.get、participants.import/cancel/markAbnormal、hearts.list）并导出类型。
- [ ] `AdminDetailOptions` 含 `includeEventFeedback / eventFeedback / includeEventHearts / eventHearts`。
- [ ] `AdminDetailPagerKey` 含 `eventFeedback / eventHearts`。
- [ ] `loadEventDetail` 并行加载反馈明细 / 心动明细，分页 cursor 透传。
- [ ] 活动详情新增「活动反馈明细」section，权限不足时显示「当前账号不可查看」。
- [ ] `SensitiveExportKind` 含 `eventFeedbacks`，导出走四步工作流，文件名 / SHA256 校验通过。
- [ ] `admin-detail-actions.tsx` events 分支含 `导出反馈 / 签到二维码 / 补录报名` 按钮。
- [ ] `EVENT_MUTATION_ACTIONS` 与 `EVENT_MUTATION_CONFIGS` 含 3 个 participants action。
- [ ] `eventRegistrationRowActions` 按 status 返回取消 / 标记异常操作。
- [ ] `IndependentFormPageConfig` 含 `preview?` 槽位；`event-edit-form-page.tsx` 接入预览。
- [ ] `event-mobile-preview.tsx` 以 375px 宽渲染活动详情，报名按钮禁用。
- [ ] `insights.get` 扩展字段向后兼容；零分母显示 `—`。
- [ ] `pnpm admin:web:verify`（typecheck + 单测 + build）通过。
- [ ] 签到码扫码签到、付费活动支付联动需真机 / 生产环境验证（记录遗留项）。

## 7. 实现顺序

**Wave 1（可并行，建议先做 FR-006 因为是 P0 且 FR-016 依赖它）**

1. FR-006（P0）
   - 步骤 2.1 契约 → 2.2 详情加载 → 2.3 导出工作流 → 2.4 详情 actions → 2.5 调用方接入 → 测试
2. FR-015（P1）
   - 步骤 2.6 契约 + 下载按钮 + 列表行操作 → 真机验证扫码幂等
3. FR-017（P1）
   - 步骤 2.7 `IndependentFormPageConfig` 扩展 → `event-mobile-preview.tsx` → `event-edit-form-page.tsx` 接入
4. FR-018（P1）
   - 步骤 2.8 契约 + mutation config → 2.9 行操作扩展 → 2.10 补录入口 → 测试

**Wave 2（依赖 Wave 1 FR-006）**

5. FR-016（P1）
   - 步骤 2.11 契约扩展 insights.get + hearts.list → 2.12 详情加载与下钻 section → 零分母保护 → 测试

每个 FR 完成后独立提交，便于回滚。FR-006 与 FR-016 因有依赖需顺序合并；FR-015 / FR-017 / FR-018 可与 FR-006 并行开发，合并时注意 `admin-details.ts` / `admin-detail-actions.tsx` / `admin-row-operations.ts` 的冲突（均按 section / 分支追加，冲突面小）。
