# Plan: 活动报名满员策略——支持「允许超售」（替代候补为可选项）

Status: accepted（2026-10-12 用户会话确认「实施吧」后锁定执行）· Date: 2026-10-12
Reviewed by: 用户（产品 owner，会话内确认方案与 PAID 禁超售范围）
Accepted by: 用户（2026-10-12）；锁定基线 feature/admin-form-ux@d1bf7169

方案依据：用户产品拍板（2026-10-12 会话：「允许超售吧，而不是候补报名」——超售与候补并存为可选项，不再以候补为唯一满员策略）+ 本 Plan 的只读调查（文件与行号见下）。

## Baseline and upstream anchors

| 锚点 | 修订/基线 | 确认依据 | 执行依赖或集成条件 |
|---|---|---|---|
| 当前代码 | feature/admin-form-ux@96297896 | 2026-10-12 只读扫描（本文所引行号均在此 sha 下核对） | — |
| 上游任务 | 无（本任务为根任务，无 upstream-expected 项） | — | — |

产品结论（来源 = 用户明确拍板，非聊天印象）：满员策略从「候补 开/关」升级为「满员候补 / 满员拒绝 / 允许超售」三选一；超售 = 超过 capacity 后继续接受报名。原「admin-form-ux 迭代不改契约与 DB」红线由该拍板显式覆盖，本 Plan 按高风险变更走会签。

## 现状事实（只读调查，基线 96297896）

- DB：`database/mysql/mip/002_events.sql:99` `waitlist_enabled TINYINT(1) NOT NULL DEFAULT 0`；`:146` `mip_events_pricing_ck` 要求 PAID 活动必须 `waitlist_enabled = 0`；`:150` `mip_events_waitlist_ck`。迁移由 `migrations.lock.json` 登记（sha256 + rollback），最新编号 106，测试 `tests/mip-migrations.test.ts` 校验 lock 一致性。
- 报名判定：`cloudfunctions/mip-events-api/domain/rules.js:52-74` `decideRegistration`——`full = capacity != null && capacityCount + activeHoldCount >= capacity`；满员时 PAID → 拒绝；`waitlist_enabled=1` → `WAITLISTED`；否则拒绝。`full` 的计数含 `REGISTERED/CANCELLATION_PENDING/ATTENDED` + 活跃 seat holds（`event-service.js:1858-1877`）。
- 候补链路：`WAITLISTED` 仅用于展示（`event-service.js:2044-2052` 计算 waitlistPosition；小程序报名结果「已进入候补/当前候补第 N 位」、我的报名「候补中」）；**未发现自动转正逻辑**——名额释放后由新报名直接占位。
- 后台校验：`cloudfunctions/mip-admin-api/domain/events.js:661-662,731` draft 校验 `waitlistEnabled`，PAID 时必须为 false。
- 投影：`cloudfunctions/mip-outbox-worker/domain/projector.js:33` 字段白名单含 `waitlistEnabled`；`:79,432` `event.registration_waitlisted` 候补通知。
- 小程序：候补文案均为「状态驱动」（`registration.status === 'WAITLISTED'`），不读 `waitlistEnabled` 配置；报名按钮可否点击由服务端判定结果驱动。
- 既有测试：`cloudfunctions/mip-events-api/tests/rules.test.js` 已覆盖 decideRegistration 三分支。
- admin-web：`admin-event-mutation-forms.ts` `waitlistEnabled` checkbox（「候补报名」）+ 付费规则人话报错（本分支 R1 已加）。
- `packages/admin-contracts` 不含 `waitlistEnabled`（draft 校验在 mip-admin-api 层），本次无需动契约包。

## 方案

新增 `oversell_enabled` 布尔列与 `waitlist_enabled` 并存（互斥约束），「候补报名」checkbox 升级为「报名满员策略」三选一。**不改 `waitlist_enabled` 列语义、不改存量数据**，`decideRegistration` 在满员分支增加 oversell 旁路。

| 满员策略（新 UI） | waitlist_enabled | oversell_enabled | 满员时行为 |
| --- | --- | --- | --- |
| 满员候补（默认，= 现状开候补） | 1 | 0 | `WAITLISTED` |
| 满员拒绝（= 现状关候补） | 0 | 0 | 拒绝「活动名额已满」 |
| 允许超售（新增） | 0 | 1 | 正常报名成功（REGISTERED / PENDING_REVIEW），不再拦截 |

## Files that change

| 状态 | 文件/预计落地区域 | 动作 | 所有者/来源 | 为什么 | 执行前核对 |
|---|---|---|---|---|---|
| existing | database/mysql/mip/107_event_oversell_enabled.sql | 新增 | 本任务 | 加列 + CHECK（含与 waitlist 互斥） | 父目录与 002 表结构已核对；编号 107 未占用 |
| existing | database/mysql/mip/rollback/107_event_oversell_enabled.sql | 新增 | 本任务 | 回滚 = DROP COLUMN | rollback 目录已核对 |
| existing | database/mysql/mip/migrations.lock.json | 登记 | 本任务 | version/name/sha256/rollbackSha256 | `tests/mip-migrations.test.ts` 会校验 |
| existing | cloudfunctions/mip-events-api/domain/rules.js | 修改 | 本任务 | `decideRegistration` 满员分支增加 oversell 旁路（PAID 分支保持拒绝，置于 oversell 判断之前） | :52-74 已核对 |
| existing | cloudfunctions/mip-events-api/tests/rules.test.js | 修改 | 本任务 | oversell 用例 | 既有三分支用例在 :33-35 |
| existing | cloudfunctions/mip-admin-api/domain/events.js | 修改 | 本任务 | events.save draft 校验 `oversellEnabled`（布尔、PAID 拒绝、与 waitlistEnabled 互斥）+ 字段白名单/落库 | :661-662,731 已核对；白名单/INSERT 列执行前重新定位 |
| existing | cloudfunctions/mip-admin-api/tests/（events 相关测试文件，执行前定位） | 修改 | 本任务 | 校验用例 | 文件名以 tests/ 目录实查为准 |
| existing | cloudfunctions/mip-outbox-worker/domain/projector.js | 修改 | 本任务 | :33 字段白名单补 `oversellEnabled`（保持投影完整；超售活动不再产生 registration_waitlisted 事件属预期） | :33 已核对 |
| existing | admin-web/src/modules/admin-event-mutation-forms.ts | 修改 | 本任务 | 「候补报名」checkbox → 「报名满员策略」select（三选一映射两布尔）；付费人话报错扩展（允许超售不可选时的提示） | 本分支 R1 已核对该文件 |
| existing | admin-web/src/modules/admin-event-mutation-forms.test.ts | 修改 | 本任务 | 策略→载荷映射、PAID/互斥断言 | 既有付费规则用例在 R1 测试组 |
| existing | admin-web/src/features/admin-runtime/admin-details.ts（或活动详情字段装配处） | 核对 | 本任务 | 详情如展示「候补」配置需同步策略名；仅展示层 | 执行前 grep「候补」定位 |
| existing | src/modules/mip-events/dto.ts、types.ts（小程序） | 核对（预计零改动） | 本任务 | 小程序候补文案全部状态驱动；超售后服务端不再返回「已满」，报名按钮自然可点。若详情页要展示「报名不限量」徽标属新增 UI，V1 不做 | 执行前 grep `waitlistEnabled` 在 dto/types 的实际消费点 |

无 `upstream-expected` 项。

## Order of work

1. **先做最险的一步：DB 迁移**（107 + rollback + lock 登记），先过 `mip-migrations.test.ts` 与本地/演示库执行——后续所有代码依赖列存在。
2. `mip-events-api` rules.js 判定 + rules.test.js 用例（先写失败测试再实现）。
3. `mip-admin-api` events.js 校验 + 用例。
4. admin-web 表单三选一 + 测试。
5. projector 白名单。
6. 全量门禁：`pnpm verify`（含小程序与 CloudBase）+ `pnpm admin:web:verify` + `pnpm verify:all`；真机清单见 Proof。

## Risks and mitigations

| 风险 | 影响 | 缓解 | 验证 |
|---|---|---|---|
| waitlist 与 oversell 同时为 1 造成语义冲突 | 报名判定不确定 | DB CHECK 互斥 + mip-admin-api 校验互斥 + admin UI 三选一天然互斥（三层） | 迁移 SQL review + admin-api 测试 |
| PAID 活动超售 → 收款超过容量引发退款 | 资金/客诉风险 | V1 明确禁止：pricing_ck 扩展 + admin 校验 + rules PAID 分支在 oversell 之前保持拒绝（双保险） | rules.test 用例 + admin-api 用例 |
| 存量 WAITLISTED 报名在策略切换后的归属 | 用户困惑 | 不做任何数据迁移：已候补者保持候补语义与文案；新策略只影响新报名 | 手工验收场景 3 |
| projector 白名单漏加 | 搜索/下游投影丢字段 | 白名单修改 + review 核对 | 代码 review checklist |
| 迁移 sha 与 lock 不符 | 部署失败 | mip-migrations.test.ts 兜底 | 门禁自动 |
| 超售活动「名额 x/y」展示误导（显示已满但可报名） | 观感 | 服务端 availability 由 decideRegistration 驱动，超售后不再返回已满；前端名额行如实显示超出数字 | 手工验收场景 2 |

## Proof

验收准备三层（协议口径）：

- `scenario_defined`：以下 4 个场景已写清（角色=运营/成员；数据=已发布活动 capacity=N；动作=编辑策略/报名；预期=各策略对应结果与拒绝行为）。绑定基线 96297896。
- `execution_ready`：① 迁移/服务端用例——本地演示库 + `node --test` 即可驱动，本任务负责，执行前就绪；② 真机报名流——需真实环境（微信支付不涉及，FREE 活动即可），**待生产/演示环境部署迁移后由运营在真机执行**，再检查时机 = 迁移部署后。
- `function_accepted`：待实现完成后按下列证据正式执行。

| # | 任务 | 时机 | 检查类型 | 场景 | 集中任务 |
| --- | --- | --- | --- | --- | --- |
| 1 | rules/admin-api/admin-web 实现 | 每步实现后 | 单元/合同测试 | 满员+oversell=1（FREE）→ REGISTERED；APPROVAL → PENDING_REVIEW；PAID+oversell → 拒绝；oversell 与 waitlist 互斥；策略→载荷映射 | 无（单卡） |
| 2 | 迁移 | 提交前 | 迁移测试 + 演示库执行 | 107 在演示库执行/回滚各一次，lock 校验通过 | 无 |
| 3 | 手工验收 | 迁移部署到演示环境后（真机） | E2E 手工 | ①FREE 活动 capacity=1+允许超售：3 人报名全部成功；②capacity=1+满员候补：第 2 人进入候补且文案不变；③capacity=1+满员拒绝：第 2 人被拒；④编辑活动把候补切为超售后，存量候补记录不变 | 无 |

## Scenario and visual implementation map

| 场景／状态 ID | 实现工作 | 设计依据与确认范围 | 验证方式 |
| --- | --- | --- | --- |
| S1 报名满员策略三选一 | admin-event-mutation-forms.ts 字段替换 | 用户拍板（本 Plan 方案节）+ 既有表单样式（select 与「收费类型」同款） | admin-web 合同测试 + 后台表单人工走查 |
| S2 超售报名成功 | rules.js oversell 旁路 | 用户拍板；服务端为唯一事实源 | rules.test 用例 + 真机场景 1 |
| S3 存量候补不受影响 | 无代码（语义保持） | 本 Plan「明确不做」 | 真机场景 3 |

## Explicitly out of scope

- **PAID（付费）活动超售**：V1 禁止（与候补同规则）。付费超售涉及收款超容量与退款流程，需单独产品方案。
- **候补自动转正**：现状本无自动转正，本次不引入。
- **超售第二硬上限**（场地绝对容量）：用户未要求；capacity 在超售策略下仅作展示口径。
- **小程序新 UI**（如「报名不限量」徽标）：超售后小程序无需改动即行为正确；展示增强另行立项。
- **迁移之外的数据订正**：不刷历史活动。

## Alternatives rejected

- **把 `waitlist_enabled` 改造成枚举列 `full_policy`** — 语义更整洁，但需转换存量布尔数据、改动 projector/DTO/rules 全部消费点，爆炸半径数倍于加列方案；被「最小半径」原则否决。
- **纯前端把「候补」文案改为「超售」** — 服务端满员仍拒绝报名，是假功能；违反「会员、活动资格不能由客户端计算」的仓库规则。
- **超售配第二硬上限（max_oversell）** — 用户未提出；V1 保持无限超售，若需要按同一迁移模式追加列即可。

## Self-interrogation（自我拷问）

- **可能破坏什么**：付费活动的满员拒绝语义（保持不变，PAID 分支置于 oversell 之前并有测试钉住）；已有候补名单（零迁移零改写）；`registration_waitlisted` 通知流（超售活动不再产生该事件——符合产品语义，projector 无需分支）。
- **最险的一步**：DB 迁移上线。缓解：纯加列默认 0（不改任何现有行为）、lock+rollback+迁移测试、先在演示库执行。
- **放弃的备选**：见 Alternatives rejected。
