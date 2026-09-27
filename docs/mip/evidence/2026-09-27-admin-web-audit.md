# 2026-09-27 admin-web 完整审计报告

> 范围：`admin-web/`（React 管理后台 + 同源 BFF）。方法：通读管理后台文档与源码，4 个只读 Agent 分区审计，关键结论逐行源码复核。
> 结论：**未发现 P0（数据泄露 / 越权写入 / 资金错误）**。服务端授权、版本、幂等契约大体被尊重。问题集中在"看起来能用、实际不生效"的筛选，以及常用运营功能的缺失。
> 部署事实：你新的 `app.tcloudbase.com` 入口由 `admin-web/cloudbase/index.ts` 复用 `admin-web/server/admin-bff.ts`，**CloudBase 与 Cloudflare 同一份前端/BFF 代码**，修一次两端生效。

## 一、需求理解

`admin-web/` 是唯一完整运营后台：纯客户端 React + 同源 BFF；浏览器不得计算会员、资格、金额、权限、审计等服务端事实，不得接触密钥。依赖方向 `app/route-pages → features → modules/services → 同源 BFF → mip-admin-api`。15 个可见一级页；复杂表单走独立页；交互统一走 `FilterBar / DataTable / MutationDialog / ConfirmDialog / DetailDrawer / StatusTag`；写操作原样保留 action、幂等键、`expectedVersion`、capability。本次审计即检查这些规范在实现中的漂移。

## 二、发现清单

### A. 真 bug

| ID | 严重度 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- | --- |
| BUG-01 | P1 | 列表高级筛选（时间/金额/多维度）实际不生效 | `use-core-page-query.ts:81-99` 只保留路由声明的 key，而 `filterDimensions` 仅 `admin-read-contracts.ts:45` 声明、**无任何路由赋值**，filters 全被丢弃；字段名/单位亦与服务端不符（`dateRange`/`amountMin` vs `createdFrom`/`minCents`） | 筛选看似可用、URL 变化、重新请求，但结果不变且无报错 |
| BUG-02 | P1 | 改状态或按回车会清空时间/金额/维度筛选 | `filter-bar.tsx:151,157` 只回传表单字段（q/status），绕过 `:122` 的 filters 合并 | 操作员丢失筛选条件，导出/操作范围被静默放大 |
| BUG-03 | P1 | 活动反馈导出永远失败 | 客户端发 `EVENT_FEEDBACK`+`eventId`（`admin-sensitive-export.ts:123-129`），BFF 只允许 `USERS`/`ORDERS`（`server/admin-bff.ts:1067-1078`）；真正契约 `events.feedbacks.export` 全仓未被调用 | 已上线的能力对任何账号都是坏的 |
| BUG-04 | P1 | 独立表单页版本冲突后无法恢复；成功后不刷新列表 | `independent-form-page.tsx:188-194` 冲突只 `setError`，不刷新 `expectedVersion`；成功不 `invalidateQueries` | 冲突后重试永远失败，只能整页刷新；返回的列表可能是旧的 |
| BUG-05 | P2 | 独立表单校验失败只有一句通用文案，无字段级提示 | `independent-form-page.tsx:179-181`；内容页丢弃 validator 的 per-field errors（如 `knowledge-edit-form-page.tsx:33`） | 时间倒置、价格/UUID 非法时操作员不知道改哪 |
| BUG-06 | P2 | DataTable 对格式化金额/日期排序错误 | `data-table.tsx:46-57` 仅当原值可 `Number()` 才数值比较；`¥1,234.00`、`2026/9/1` 退化为文本比较 | 金额、日期、报名数排序错乱 |
| BUG-07 | P2 | 确认弹窗提交中"取消"按钮仍可点 | `confirm-dialog.tsx:21-23` 仅锁遮罩/键盘（`:24-25`），取消按钮无 `disabled` | 提交在途可退回可编辑弹窗，产生重复/困惑流程 |
| BUG-08 | P2 | operations/governance 改筛选会重置每页条数并丢弃 filters | `route-pages.tsx:158-161,269` 重建 search 时只带 q/status | 选 100 条/页后改状态变回 20 |
| BUG-09 | P2 | WebP 支持声明不一致 | 上传器 `asset-uploader.tsx:33,171-173` 允许 WebP，模块/BFF 只收 PNG/JPEG（`admin-media-upload.ts:82-93`） | 选了 WebP 才报"只支持 PNG/JPEG" |
| BUG-10 | P2 | 编辑时素材上传器不回显已有图片 | `asset-uploader.tsx:58,158` 预览只来自本地新上传，不回填表单值；单图输入还 `readOnly` | 编辑封面/案例/知识封面时只见 assetId，无法核对已存素材 |
| BUG-11 | P2 | 任务列表出现非专业列名与内部 UUID | `admin-task-management.ts:132` 列名"笨笨老大"、`:764` 回退到 `assignedOwnerId`（服务端只回 id） | 主列表展示内部 UUID，违反文案规范 |
| BUG-12 | P2 | 概览"待审核任务"永远空、"增长趋势"永久空 | `overview-model.ts:57-63,99-109` 只保留 `AVAILABLE`，而服务端返回 `NOT_PROVIDED`；趋势硬编码不可用 | 两张卡是死数据 |
| BUG-13 | P2 | OperationsReadPage 在 `page` 为空时渲染空白无提示 | `operations-read-page.tsx:84-86`（governance 有 `EmptyState`） | 违反空/错状态区分规范 |
| BUG-14 | P2 | 后台账号创建的用户选择器上限 100 且无搜索/分页 | `operation-model.ts:142-147` | 用户超过 100 就无法指定为管理员（**未逐行复核**） |
| BUG-15 | P2 | 移动端首帧可能闪桌面壳 | `responsive-app-shell.tsx:32` 依赖 `Grid.useBreakpoint()`，首帧返回 `{}` → `mobile=false` | 390px 首绘短暂渲染 184px 侧栏，威胁无横向溢出承诺（**未逐行复核**） |

### B. 明显功能缺失

| ID | 严重度 | 缺口 | 证据 |
| --- | --- | --- | --- |
| MISS-01 | P1 | **批量操作完全未接**：规范要求报名审核/内容审核/公告发布下架/任务成员分配支持多选批量，`DataTable` 已有 `selectable/batchActions`，但全仓无任何调用 | `INTERACTION_SPEC.md:72-79`；`data-table.tsx:99-157` 无调用者 |
| MISS-02 | P1 | 公告只能新建，不能编辑/预览正文 | `governance-pages.tsx:95,122`；`admin-row-operations.ts:183-213` 无 save；列表不含 body |
| MISS-03 | P2 | 消息模板不能编辑 | `admin-row-operations.ts:215-235` 仅 activate/archive；`admin-read-pages.ts:386-399` 无 detail |
| MISS-04 | P1 | 多处关键字段要手输 UUID：成长调整/授勋/撤销、消息收件人、知识分类、服务器 scope、活动补录报名 | `content-mutation-forms.ts:307,369,377,384,404-410,590`；`admin-event-mutation-forms.ts:233-238` |
| MISS-05 | P2 | Banner 列表/详情不渲染图片 | `admin-banner-management.ts:73-84,108-115`；`detail-drawer.tsx:45` 只渲染文本 |
| MISS-06 | P2 | 社区举报无详情/证据视图，却要求必填处理原因 | `admin-read-special-pages.ts:191-206` |
| MISS-07 | P2 | `users.phone.read` 能力无任何 UI 消费者（列表/详情恒 `includePhone:false`） | `admin-details.ts:101,236`；`admin-read-pages.ts:171` |
| MISS-08 | P2 | 概览"最近待办"跳向无筛选列表，数量无法被处理 | `overview-page.tsx:117` |

### C. 体验 / 规范一致性

| ID | 严重度 | 问题 | 证据 |
| --- | --- | --- | --- |
| UX-01 | P2 | 排序图标用 `⇅` 字符，规范要求 `CaretUpOutlined`/`CaretDownOutlined` | `data-table.tsx:1,65-69`；`INTERACTION_SPEC.md:17` |
| UX-02 | P2 | 未知状态一律显示蓝色"处理中" | `status-tag.tsx:18`；`DESIGN.md:99` |
| UX-03 | P2 | `humanizeError` 未命中时直接显示原始服务端文案/错误码 | `humanize-error.ts:48` |
| UX-04 | P2 | 列表写后刷新无进度（只有 `isPending` 当 loading） | `use-admin-read-page.ts:26` |
| UX-05 | P2 | operations 行操作不按 capability 过滤；demo 模式下仍可点 | `operations-read-page.tsx:139-157`；`banner-management-page.tsx:20-25`；`growth-badges-page.tsx:16-34` |
| UX-06 | P2 | `AUTH_REQUIRED` 不自动打开登录，只显示被动"请先登录" | `session-provider.tsx:210-222`；`responsive-app-shell.tsx:142-145`；`ARCHITECTURE.md:99` |
| UX-07 | P2 | `logout` 失败被吞：先清本地会话，`logout()` 抛错则 Cookie/D1 会话仍在，也无提示 | `session-provider.tsx:193-199`；`responsive-app-shell.tsx:96` |
| UX-08 | P2 | `DetailDrawer` 错误无重试；刷新时清空已有内容 | `detail-drawer.tsx:35-37` |
| UX-09 | P2 | 独立表单无表单内提交控件，回车不提交（键盘可达性弱） | `independent-form-page.tsx:222-234` |

### D. 安全 / 边界

| ID | 严重度 | 问题 | 证据 |
| --- | --- | --- | --- |
| SEC-01 | P2 | BFF 未执行契约 `forwardIdempotencyKey` 策略，客户端幂等键被无条件转发 | `server/admin-bff.ts:457-493`；`server/admin-mutation-contract.ts:20-44` 从不读取该字段 |
| SEC-02 | P2 | `MIP_WEB_ALLOWED_ORIGIN` 未配置时回退 `Host`，严格同源保证依赖代理行为 | `server/admin-bff.ts:731-754` |
| SEC-03 | P2 | 手机号导出复选框未按 `users.phone.read` 预检，走到最后才失败 | `sensitive-export-button.tsx:52,118-122`；服务端 `domain/exports.js:66-67` |
| SEC-04 | P2 | 任务完成导出消费未校验的浏览器 blob（无大小/魔数/哈希） | `admin-task-management.ts:622-648`；对比 `admin-sensitive-export.ts:222-269` |
| SEC-05 | P3 | 客户端重新实现关键字/状态/筛选匹配，与服务端双重事实源 | `admin-read-formatters.ts:73-88` 被广泛调用 |

### E. 测试盲区

- `admin-sensitive-export.test.ts:77-79` 固化了错误的导出契约，`server/admin-bff.test.ts:932` 只断言通用拒绝，两边都抓不到 BUG-03。
- `admin-read-pages.test.ts:327-349` 固化了服务端忽略的筛选字段名（`city`/`eventType`）。

## 三、筛选修复方向（已与需求方确认）

采用**客户端适配现有服务端契约**：按 `mip-admin-api` 已有字段名与单位（`createdFrom`/`createdTo`、`priceMinCents`/`priceMaxCents`/`amountMinCents` 等）重做前端筛选，由服务端声明各路由支持的 `filterDimensions`，服务端不改。这样能同时修掉 BUG-01/02/08 并让导出范围承诺成真。

## 四、做得好、不要回退的部分

1. **敏感导出完整性管线**：仅 HTTPS、长度 + ZIP 魔数 + SHA-256、一次性令牌、拒绝 `objectKey`/`fileId`（`admin-sensitive-export.ts:222-269,312-331`）。
2. **mutation 安全**：顶层幂等键、服务端版本、冲突草稿保留（`admin-operation-provider.tsx:73-146`、`operation-model.ts:243-303`）。
3. **BFF 加密与会话**：AES-GCM 密封 Cookie、三个 HMAC 信任域隔离、常量时间比较、单次挑战消费（`server/admin-bff.ts:102,681-685,1117-1175`）。
4. **上传纵深防御**：声明类型 vs 嗅探类型 + 魔数，BFF 独立限额（`admin-media-upload.ts:62-93`、`server/admin-media-upload.ts:65-203`）。

## 五、建议排期

- **第 1 批 · 正确性回归（P1，低风险高收益）**：BUG-01/02/03/04/05/08 + 客户端适配服务端筛选契约；补 BFF/契约测试，修掉固化了错误契约的单测。门禁：`pnpm admin:web:verify`。
- **第 2 批 · 常用功能补齐**：MISS-01（批量操作含 DataTable 二次确认契约）、MISS-02/03（可编辑）、MISS-04（UUID→选择器）、MISS-05/06、BUG-12、UX-04/05、SEC-03。
- **第 3 批 · 规范与边界收口**：BUG-06/09/10/11、UX-01/02/03/06/07/08/09、SEC-01/02/04、BUG-14/15。

## 六、证据边界

- 本报告为**静态源码审计**，未在真实环境触发。除报告中标注"未逐行复核"的两条外，关键结论均已在源码行核对。
- 真机/生产才能确认：CloudBase 网关下登录/退出/改密、可信 IP 限流、源站 origin 防护、上传/导出真实闭环、手机号导出门禁、390px 真机重排。按仓库规则这些须单独取得证据。
- 未上传微信体验版，未改动任何代码或线上资源。

## 七、本轮修复状态（2026-09-27）

已修复并通过 `pnpm admin:web:verify`（lint + typecheck + 181 合同测试 + 95 React 测试 + build + responsive）：

- BUG-01/02/08：`FilterBar` 按服务端字段输出 `createdFrom`/`createdTo`、`startsFrom`/`startsTo`、`priceMinCents`/`priceMaxCents`、`kind`/`accessType`/`orderType`；回车与状态切换改为合并既有筛选；路由声明 `filterDimensions`；operations/governance 保留 `limit`/`tab`/`filters`。已补 `filter-pipeline.test.ts` 合同测试。
- BUG-03：活动反馈导出改走 `mip.admin.events.feedbacks.export`（与服务端生成契约一致）。
- BUG-04/05：独立表单冲突后重新拉取并刷新 `expectedVersion`、成功后 `invalidateQueries`、字段级校验错误回填；新增冲突重试回归测试。
- BUG-06/UX-01：`DataTable` 对金额/百分比/日期做数值与时间比较；排序图标改 `CaretUp/CaretDown/Swap`。
- BUG-07：确认弹窗提交期间禁用取消与关闭。
- BUG-09：素材上传器与服务端一致，仅 PNG/JPEG。
- BUG-10：编辑时显示"已保存素材"并可清除；多图字段以可移除标签展示已有素材。
- BUG-11：任务列改"负责人"，通过 `editorOptions` 解析负责人姓名，不再显示 UUID；移除占位列名"笨笨老大"。
- BUG-12：移除服务端 `NOT_PROVIDED` 的死待办项；趋势空态改为事实说明，不以报名/付费替代玩家增长。
- BUG-13：OperationsReadPage `page` 为空时显示空态。
- BUG-14：后台账号用户选择器改为会话驱动的远程搜索（`SessionUserSelect`），不再受前 100 个用户限制。
- BUG-15：首帧用同步 viewport 判定，避免 390px 闪桌面侧栏。
- SEC-01：BFF 按生成契约的 `forwardIdempotencyKey` 决定是否透传浏览器幂等键。
- SEC-02：`MIP_WEB_ALLOWED_ORIGIN` 未配置即失败关闭，不再回退 `Host`。
- SEC-03：手机号导出复选框按 `users.phone.read` 门禁，导出范围文案改为实际的关键词/状态范围。
- SEC-04：任务完成导出增加文件名、行数、base64 规范性与 XLSX 魔数校验。
- UX-02/03/05/06/07/08：未知状态不再伪装成"处理中"；未映射机器码不透传；operations 行操作按 capability 过滤；`AUTH_REQUIRED` 自动打开登录且不覆盖既有提示；登出失败以服务端会话为准；详情抽屉错误可重试。

## 八、本轮未做（建议下一批）

- MISS-01 批量操作（报名/内容审核、公告发布下架、任务分配）仍未接入 `DataTable` 的 `selectable/batchActions`。
- MISS-02/03 公告与消息模板仍只能新建、不能编辑。
- MISS-04 UUID 手输（成长/勋章、消息收件人、知识分类、服务器 scope、活动补录报名）仍是文本输入。
- MISS-05/06 Banner 不渲染图片、举报无详情/证据视图。
- UX-04 列表写后刷新进度提示；UX-09 独立表单回车提交。
- BUG-12 的玩家增长趋势需要服务端契约提供时间序列，本轮未改服务端。

## 九、后续迭代（重构与参数化批量）

- 合并 6 处重复的 `identifier/positiveVersion/nonNegativeVersion/boundedInteger/stringList` 校验到 `modules/admin-coercions.ts`，复用共享 `record()`，消除校验漂移。
- `DataTable` 批量操作升级为可复用能力：二次确认 → 可选的共享表单（`OperationField[]`）→ 逐行执行；共享值覆盖每行 operation 值，每行独立 `expectedVersion` 与幂等键，逐行 try/catch 后汇总成功/失败/跳过。
- 抽取 `modules/admin-batch-operations.ts`（纯函数 + 执行器 + 汇总文案），供页面与测试复用；服务端仍是最终授权者，未改服务端契约（小程序端零改动）。
- 已接入的真实批量场景：运营记录 → 公告「批量发布/批量撤回（共享撤回原因）」、社区举报「批量认领/批量结案（共享处理结果与原因）」。
- 仍未做：报名/内容审核批量（行操作位于详情抽屉，需要 `DetailDrawer` 批量支持，已在评估中）；任务成员分配批量；服务端原子批量为跨端契约变更，留待单独立项。
