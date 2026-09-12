# 2026-09-12 功能审计

以下为初始审计快照。用户随后授权修复，当前修复说明见本文末尾“修复记录”；初始问题描述不表示它们仍未修复。

## 范围与结论

主审计与三个并行 Agent 检查微信小程序、会员/活动/订单支付服务端、React 管理后台及 BFF。共确认 9 项 P2 缺陷。这里的“确认”指真实源码配合本地模拟依赖复现，或完整调用链证明，不代表已在线上触发。

审计从 `b11e0fa` 的未提交工作区开始。审计期间其他任务继续修改页面、媒体及请求加载代码，因此全量检查只能作为执行时工作区证据，不是固定提交快照。本任务只新增本报告，没有修复业务代码、提交、部署或写入线上数据。

## 确认问题

### 1. 已结束活动仍可完成既有占位的支付报名

- 触发：用户创建付费报名订单，在 15 分钟占位有效期内，运营将活动改为 `ENDED`，用户随后继续支付。
- 原因：`cloudfunctions/mip-admin-api/domain/repositories/events.js` 的 `changeEventStatus` 仅在 `CANCELLED` 时清理报名/占位；`cloudfunctions/mip-payment-ledger/domain/ledger.js` 的 `getPayableOrder` 只检查占位，`applyEventPayment` 仅锁活动 ID，没有检查活动状态。
- 复现：活动为 `ENDED`、占位为有效 `ACTIVE` 时，真实 ledger 仍返回 `PAID` 并写入 `REGISTERED`。
- 影响：为已结束的活动收款并确认报名。不是正常取消活动路径，也不是已验证的真实微信扣款。
- 建议：结束活动时关闭未支付占位；发起支付检查状态；迟到支付回调根据活动和支付时间事实走退款收敛，保留幂等保护。

### 2. 后台日期转换使周赛无法创建、案例日期提前一天

- 位置：`admin-web/src/modules/admin-operation-ui.ts` 的 `normalizeSubmittedField`，`date` 与 `datetime` 一律调用 `toISOString()`。
- 周赛：DatePicker 选好日期后被转为 ISO 时间戳，`admin-game-management.ts` 的周赛构建器仅接受 `YYYY-MM-DD`，返回 `null`，无法提交。
- 案例：`features/admin-runtime/operation-model.ts` 对 UTC 字符串截取前 10 字符；上海时区选 `2026-09-14`，实际 `draft.startedOn` 为 `2026-09-13`。
- 复现：实际操作模型、日期归一化与 Day.js 在 `TZ=Asia/Shanghai` 下确认以上结果；传入原始日期字符串后周赛输入可正确构建。
- 建议：纯日期使用本地日历 `YYYY-MM-DD`，时间戳字段才转 ISO。

### 3. 后台编辑机会不回填原内容

- 位置：`admin-web/src/features/admin-runtime/operation-model.ts` 的机会编辑回填。
- 触发：机会详情 → 编辑机会。
- 原因：服务端机会 DTO 是顶层 `ownerUserId/title/valueSummary/description/roleKeys`，表单却使用 `values.draft.*`，现有回填只匹配顶层字段。
- 复现：已有机会 ID 和 `expectedVersion:4` 保留，但 `draft` 的发布人、标题、价值、正文等为空，`buildInput` 返回 `null`。
- 影响：运营必须重填；只补必填项后保存，可能把原有非必填正文、目标和标签覆盖为空。
- 建议：明确映射机会 DTO 到 `draft`，添加“打开已有内容后不改直接保存”的交互测试。

### 4. 知识评论响应丢失后重试可能重复发布

- 位置：`src/modules/mip-knowledge/module.ts` 的 `createComment`；`src/packages/member/mip-knowledge/detail/index.ts` 的 `submitComment`。
- 触发：首次提交已经入库，但响应丢失，用户点击重试。
- 原因：每次调用创建新幂等键；服务端 `cloudfunctions/mip-community-api/domain/knowledge.js` 按幂等键去重，新键会再次 INSERT。
- 复现：真实页面/模块加模拟持久层，两次点击生成 `knowledge-comment-1`、`knowledge-comment-2`，记录两条相同正文。
- 建议：未确定结果的同一提交保留幂等键；成功或明确改变提交意图后才生成新键。

### 5. 手机号绑定成功会覆盖名片编辑草稿

- 位置：`src/packages/member/mip-card-edit/index.ts` 的 `bindPhone` 和 `load`。
- 触发：先编辑姓名、微信或公司但不保存，再完成手机号授权。
- 原因：绑定成功后 `await this.load()` 全量加载服务端旧资料，覆盖当前草稿。
- 复现：真实页面设置未保存姓名和微信，模拟绑定成功后均恢复旧值。
- 建议：仅刷新手机号与资料版本，合并保留其他未保存字段。手机号授权能力本身仍需真机。

### 6. 订单列表截断为最近 30 条，筛选会漏单

- 位置：`cloudfunctions/mip-commerce-api/domain/service.js` 的 `listOrders/boundedLimit`；`repository.js` 的 `listOrders`；`src/packages/member/orders/index.ts` 的本地筛选。
- 原因：客户端不传 limit/cursor，服务端默认 `LIMIT 30`，列表没有后续分页；“待使用/已完成/已退款”只筛选这 30 条。
- 复现：真实 service 配合 31 条模拟订单，第 31 条为待使用；默认返回 30 条，页面筛选得到 0 条，而实际有 1 条待使用订单。
- 影响：老订单无法通过列表找到；新建未完成订单也会挤掉较早订单。不是数据库丢单。
- 建议：服务端状态筛选与游标分页，客户端保留游标并追加结果；单纯扩大 limit 不能根治。

### 7. 知识评论超过 20 条后不能翻页

- 位置：`src/packages/member/mip-knowledge/detail/index.ts` 的 `load`；`src/modules/mip-knowledge/cloudbase-gateway.ts`。
- 原因：网关固定 `limit:20`，页面只保存 `comments.items`，丢弃 `nextCursor`，没有翻页 handler 或按钮。
- 复现：返回 20 条和 `nextCursor:'20'`，页面没有保存游标，也没有 `onReachBottom/loadMore`。
- 建议：保存并消费下一页游标，追加并去重评论，显示加载和重试状态。

### 8. 待支付报名在详情页错误隐藏取消入口

- 位置：`cloudfunctions/mip-events-api/domain/event-service.js` 的 `getEvent.canCancel`。
- 触发：默认活动开始前 24 小时内，用户已报名但未支付。
- 原因：详情 DTO 统一检查取消截止，但 `canCancelRegistration` 和取消写操作明确允许 `PAYMENT_PENDING` 超过截止取消。
- 复现：真实 `getEvent` 返回 `canCancel:false`；详情模板和 handler 都据此拒绝取消。
- 影响：详情取消路径不可用；“我的活动”仍可取消，不是整个取消能力失效。
- 建议：详情复用统一的服务端取消资格函数。

### 9. 后台普通请求遇到登录过期不清理旧会话

- 位置：`admin-web/src/app/session-provider.tsx` 的 `request`。
- 触发：页面保持打开，会话过期或 Cookie 被清除，后续请求返回 `AUTH_REQUIRED`。
- 原因：普通请求直接转发；只有 `refreshSession` 捕获认证错误并清会话/缓存。
- 复现：独立 React 测试中，普通请求认证失败后 `session.enabled` 仍为真，受保护 query cache 仍存在。
- 影响：界面继续显示旧权限入口和缓存，需要刷新恢复登录。BFF 已拒绝请求，此项不是服务端越权。
- 建议：统一捕获认证失效，清除会话和受保护缓存，回到登录入口。

## 验证记录

- Node 22.23.1、pnpm 11.14.0。
- 小程序聚焦：8 个文件、31 项现有测试通过；另有 3 项真实页面/模块缺陷复现。
- 服务端聚焦：93 项现有测试通过；另有 2 项缺陷复现通过。
- 后台：实际表单模型复现日期和机会回填问题；独立 React 会话复现 1/1 通过。
- 缺陷复现测试断言的是异常行为存在，不是修复后通过的证明。
- 微信 `runtime:preflight` 通过：登录、服务端口、路由和 DevTools conditions 完整；没有完成本轮全部路由交互验收。
- 报告完成后独立执行 `git diff --check` 和 `node scripts/verify-doc-links.mjs`，均通过。
- 全量 `pnpm verify:all` **未完成**：工具链、架构、隔离、安全、MCP 配置及小程序 typecheck 已通过；ESLint 运行超过 7 分钟仍未结束，14:01 本机 load average 为 339.91，且另有同仓库检查同时运行。为减少资源争用，仅停止本次 ESLint 子进程，其余任务未中断。后续 stylelint、全量 test、build、server、docs 以及串联的 `admin:web:verify` 没有执行到，不能记为通过；这不是已定位的 ESLint 规则失败。

本机临时复现材料：`/tmp/mip-mini-audit.cjs`、`/tmp/mip-server-cancel-repro.cjs`、`/tmp/mip-server-ended-payment-repro.cjs`、`/private/tmp/mip-admin-audit-0912/session.test.tsx`。上述触发条件、实际行为和源码位置已在本报告记录；临时文件不是长期证据依赖。

## 未完成的验收与优先级

优先处理已结束活动支付、日期写错/周赛阻断、机会编辑覆盖、评论重复和草稿丢失，然后补分页与认证恢复。未在本轮发现可确认的后台越权，但抽查不能证明权限体系没有其他缺陷。

尚未验证：当前线上部署与本地代码一致性、真实 MySQL/云函数行为、完整后台浏览器交互及三个视口、真实上传/导出、微信支付回调与退款、手机号、订阅消息、扫码签到等真机能力。后台 `verify:responsive` 是源码/构建产物合同检查，不能充当浏览器截图或布局验收。

## 修复记录

9 项问题均已在本地代码修复，未提交或部署。

| 原问题 | 最终修复 |
| --- | --- |
| 已结束活动付款 | 新支付检查活动状态及有效结束时间；保留权威查单。回调/查单传递 provider 支付完成时间，ledger 取计划结束与运营结束中最早的有效时间：结束前已付且占位有效的迟到回调正常确认，结束后付款进入退款。活动结束后缺少可信付款时间则等待查单补齐，避免误退款。 |
| 后台日期 | 纯日期保留本地 `YYYY-MM-DD`；只有时间戳字段转换 ISO。 |
| 机会回填 | 明确回填 `draft`，保留正文、标签与商业条件，并剔除纯展示字段。 |
| 评论重复 | 页面保留未决提交意图和幂等键，响应未知时重试同一请求，成功或改变正文后才生成新意图。 |
| 名片草稿 | 绑定后只更新手机号和档案版本，其他编辑内容保留。 |
| 订单截断 | 新增 `listOrderPage`，服务端先筛选使用状态，再按创建时间和 ID 游标分页；页面支持追加、失败重试及切换分类时丢弃旧请求。原 `listOrders` 数组响应保留，兼容旧客户端。 |
| 评论分页 | 保留并消费游标，追加去重；刷新期间禁止分页，丢弃刷新前或隐藏前的迟到响应。 |
| 待支付取消入口 | 详情复用 `canCancelRegistration`，与写操作及我的活动一致。 |
| 后台认证失效 | 普通请求认证失效后清理会话和受保护查询缓存；非认证错误保留上下文，旧登录流程的失败不清除新会话。 |

支付修复没有按初审建议直接撤销所有占位：占位仍是区分“已付款但回调迟到”与“结束后付款”的必要事实，直接撤销会误伤前者。没有新增数据库迁移。

回归覆盖包括：31 条同时间订单连续翻页与旧待使用订单筛选、分页失败和分类切换竞态、评论响应丢失、评论刷新与分页竞态、手机号绑定保留草稿、实际周赛/案例日期模型、机会回填和普通请求认证失效，以及结束前/后付款、晚于计划时间人工结束、缺失付款时间与无效结束时间。

本轮回归：小程序 216 个测试文件、1105 项测试通过；服务端 262 个测试文件对应 1670 项测试通过。工具链、架构、隔离、安全、MCP 配置、类型、lint、stylelint、源码契约与文档检查已通过。后台 lint、测试类型检查、生产类型检查、Node 测试 117 项、React 测试 11 个文件 56 项、生产构建及响应式源码/产物契约均通过。React 初次并行和单进程延长超时运行在本机高负载下失败；恢复后以默认超时、单进程完整复跑通过（92.58 秒），未为本轮降低断言要求。原始 `verify:all` 在分包预算检查处失败，修正后分阶段续跑，不能将原始串联命令记为通过。

构建配置开启 Rolldown 压缩、保留标识符及法律注释，并保留未使用代码清除；没有提高体积预算。构建、体积预算及构建契约通过，会员分包含可达依赖为 1,856,707 字节；JS 模板 sidecar 与本机源码路径残留检查通过。服务端 HTTP 超时测试改为虚拟时钟，避免机器高负载造成的调度误差。

修复后重新执行的 `runtime:preflight` 被 DevTools 服务端口未监听阻断；尝试打开开发者工具后重试仍失败。本节状态替代初审阶段的 preflight 通过记录，不能据此声称修复后的运行时验收通过。

发布时先更新下列云函数，再发布小程序和后台。需要部署 `mip-commerce-api`、`mip-events-api`、`mip-payment-ledger`、`mip-cloudpay`、`mip-cloudpay-callback`；本轮没有执行这些发布。支付、手机号仍需真机验证。
