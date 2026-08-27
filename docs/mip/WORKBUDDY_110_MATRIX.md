# WorkBuddy V0.4 当前 110 条管理需求矩阵

本文冻结 2026-08-26 可读取的 WorkBuddy 在线稿，并把每条管理需求映射到当前小程序管理分包、渠道中立服务合同和本地测试。它是当前实现与验收基线；不把在线稿中与已确认会员、支付、安全和历史保留规则冲突的描述直接视为应实现行为。

## 结论

仓库中没有保存可逐项复原的“2026-08-25 历史 108 项原始清单”。当前能证实的是：

1. `docs/mip/ADMIN_WEB.md` 与 `docs/mip/evidence/admin-web-2026-08-25/README.md` 均声称当时为 15 个模块、108 个一级需求点。
2. `docs/mip/ADMIN_WEB.md` 同一张模块表中的 15 个模块计数相加为 **106**，不是 108。
3. 仓库内“108 个一级需求点”的命中只出现在 `docs/mip/README.md`、`ADMIN_WEB.md`、`COVERAGE_MATRIX.md` 和证据 README 的范围陈述中，没有逐行清单。
4. `docs/mip/evidence/admin-web-2026-08-25/` 只保留 README 和首页、用户、活动 3 张截图，没有冻结 HTML、CSV 或逐行文本。截图可以证明当时顶部为 15 个模块，不能补出缺失条目。
5. `docs/mip/sources/github/MIP后台PRD_V0.1_含表格.md` 是 2026-08-10 的报价评估版窄范围，不是 V0.4 的 108 项原文，不能拿来补数。
6. 当前在线页面可读取，但已漂移为 **16 个模块、110 行需求**；新增第 8 模块“权益管理”共 4 行，后续模块整体顺延。当前页面仍显示版本 V0.4、日期 2026-08-22、状态“需求细化中”。

因此，下表审计的是**当前在线 110 行快照**，不是虚构的历史 108 行。若要锁定历史 108，最小外部 blocker 是 WorkBuddy 2026-08-25 的冻结 HTML/CSV/导出，或能访问该页面的修订历史。

## 来源与复现

- 在线来源：`https://bfd568111f4249be9902eba8e876cece.app.workbuddy.link/`
- 页面标题：`MIP 小程序后台管理系统 PRD｜详细需求工作稿 V0.4`
- 当前 HTML SHA-256：`071afcfdbb093e5a5ac442af3c60593045aede62e79977d9e3d7b34a45175dfc`
- 当前原始结构：16 个目录锚点；110 个 `<td class="req">`。
- `WB-LIVE-NNN` 是本次按 HTML 中 `td.req` 出现顺序生成的临时定位号，**不是 WorkBuddy 自带需求 ID**。
- 本次只检查仓库源码、路由、测试与静态证据；没有把静态测试存在表述为微信电脑端、真机支付或生产 provider 已验收。

## 判定口径

- `覆盖`：有主要 operation、已注册管理页和直接相关测试，且语义基本一致。
- `部分`：已有可复用切片，但字段、状态、入口、明细或工作流不完整。
- `缺失`：没有对应管理 operation/page，或只有底层事实而无该管理能力。
- `冲突`：在线规则与已确认领域、安全或历史保留规则冲突，不应照抄。
- `外部待验`：源码链路存在，但必须在真机、正式支付、微信 OpenAPI 或生产 provider 验收。

## 记号

Operation：

- `A:x` = `mip-admin-api` 的 `mip.admin.x`。
- `T:x` = `mip-tasks-api` 的 `admin.x`。
- `G:x` = `mip-game-api` 的 `admin.x`。
- `B:x` = `mip-banners-api` 的 `mip.banners.admin.x`。
- `I:x` = `mip-identity-api` 的用户操作。
- 页面名均相对 `src/packages/admin/<页面>/index.{ts,wxml}`；`—` 表示没有对应管理页。

测试证据：

- `U`：`cloudfunctions/mip-admin-api/tests/users.test.js`、`user-repository-module.test.js`、`admin-prd-completion.test.js`、`tests/mip-admin-users-facade.test.ts`
- `I`：`cloudfunctions/mip-identity-api/tests/service.test.js`、`repository.test.js`
- `P`：`cloudfunctions/mip-payment-ledger/tests/ledger.test.js`、`cloudfunctions/mip-commerce-api/tests/repository.test.js`
- `M`：`cloudfunctions/mip-admin-api/tests/memberships-module.test.js`、`membership-repository.test.js`、`tests/mip-admin-membership-ledger.test.ts`
- `E`：`cloudfunctions/mip-admin-api/tests/events-module.test.js`、`event-insights.test.js`、`event-clone.test.js`、`checkin.test.js`、`admin-prd-completion.test.js`、`tests/admin-events.test.ts`、`tests/admin-event-clone.test.ts`、`tests/mip-admin-events-facade.test.ts`、`tests/mip-event-feedback-admin.test.ts`、`tests/mip-event-phone-preview.test.ts`、`tests/mip-event-insights.test.ts`
- `BN`：`cloudfunctions/mip-banners-api/tests/{handler,repository,service,validation}.test.js`、`tests/mip-banners.test.ts`
- `RB`：`cloudfunctions/mip-admin-api/tests/access.test.js`、`role-capability-policies.test.js`、`tests/mip-admin-governance-facade.test.ts`
- `BR`：`cloudfunctions/mip-admin-api/tests/branches.test.js`、`tests/mip-branches-domain.test.ts`
- `GR`：`cloudfunctions/mip-admin-api/tests/growth-module.test.js`、`badges.test.js`、`tests/mip-admin-growth-facade.test.ts`、`tests/mip-badges.test.ts`
- `TK`：`cloudfunctions/mip-tasks-api/tests/task-contract.test.js`、`tests/mip-tasks.test.ts`
- `OP`：`cloudfunctions/mip-admin-api/tests/opportunities-module.test.js`、`admin-prd-extensions.test.js`、`tests/mip-admin-opportunity-facade.test.ts`
- `OR`：`cloudfunctions/mip-admin-api/tests/orders-module.test.js`、`order-repository-module.test.js`、`export.test.js`、`tests/mip-admin-orders-facade.test.ts`、`tests/admin-orders-responsive.test.ts`
- `MS`：`cloudfunctions/mip-admin-api/tests/message-campaigns.test.js`、`message-templates.test.js`、`message-delivery-reviews.test.js`、`tests/mip-admin-messaging-facade.test.ts`
- `GM`：`cloudfunctions/mip-game-api/tests/game.test.js`、`tests/mip-game.test.ts`
- `DS`：`cloudfunctions/mip-admin-api/tests/dashboard-overview-{contract,repository}.test.js`、`tests/mip-admin-dashboard-overview.test.ts`
- `UC`：`cloudfunctions/mip-admin-api/tests/user-content-governance.test.js`、`tests/mip-admin-user-content-crud.test.ts`
- `BL`：`cloudfunctions/mip-admin-api/tests/benefit-ledger.test.js`、`tests/mip-admin-benefit-ledger.test.ts`
- `PA`：`cloudfunctions/mip-admin-api/tests/payment-attempts.test.js`、`payment-attempt-repository.test.js`、`tests/mip-admin-payment-attempts.test.ts`
- `DR`：`cloudfunctions/mip-admin-api/tests/message-delivery-records.test.js`、`tests/mip-message-delivery-records.test.ts`

## 当前在线 110 行映射

### 用户管理（24）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-001 | 用户角色 | `A:users.list/get` | `profiles` | U、I | `冲突 + 部分`：本地只按有效权益投影玩家/嘉宾；在线“普通用户/嘉宾/玩家”三分法不成立。 |
| WB-LIVE-002 | 角色流转 | `A:users.list/get`；ledger 权益重算 | `profiles` | I、P | `冲突`：缴费/到期会改变玩家投影，但“参加早会后普通用户变嘉宾”和角色变更记录不存在；不应把权益投影实现成可写角色。 |
| WB-LIVE-003 | 玩家权益周期 | `A:users.get`、`A:memberships.timeline`；ledger 权益 | `profiles`、`orders`、`membership-ledger` | U、P、M | `覆盖 + 冲突`：可读当前、待生效和完整历史权益窗口；会员方案时长可配置，不接受固定 1 年覆盖服务端目录。 |
| WB-LIVE-004 | 权益到期处理 | `A:users.get`；ledger 权益重算 | `profiles`、`orders` | I、P | `冲突`：到期后查询结果自然成为嘉宾，不写“角色迁移”；续费与退款由 ledger 决定。 |
| WB-LIVE-005 | 添加用户 | — | — | — | `缺失 + 冲突`：没有手机号预建、短信通知、手机号匹配激活；可信微信身份才创建/绑定账号。 |
| WB-LIVE-006 | 用户档案编辑 | `A:users.get/update` | `profiles` | U | `部分`：仅支持昵称、headline、简介、visibility，带版本和审计；其余字段不可后台任意改。 |
| WB-LIVE-007 | 玩家 ID | `A:users.list/get` | `profiles` | U | `覆盖`：首次取得有效付费权益时生成 AppID 内不可变玩家编号；运营列表和详情不再把内部 UUID 作为业务编号。编号格式采用业务中立数字序列，不照抄 `USRxxxxx` 展示前缀。 |
| WB-LIVE-008 | 微信账号绑定 | `I:getAccessSnapshot/getProfile` | `profiles` 仅展示绑定状态 | I | `部分 + 外部待验`：服务端从可信微信上下文解析并绑定身份，但 OpenID 不允许普通后台展示；真实微信绑定需运行时验证。 |
| WB-LIVE-009 | 更换手机号 | `I:bindWechatPhone` | 无管理页；用户端 `mip-profile` | I | `部分 + 外部待验`：有本人微信手机号授权写入，没有管理员代换流程；需真机 `getPhoneNumber`。 |
| WB-LIVE-010 | 玩家视图 | `A:users.list` | `profiles` | U | `覆盖`：除当前 PLAYER/GUEST 外，支持当前玩家、历史玩家和从未成为玩家的服务端生命周期筛选。 |
| WB-LIVE-011 | 玩家列表字段 | `A:users.list/get` | `profiles` | U | `覆盖`：昵称、受控手机号、角色投影、分会、等级、经验、账号状态、玩家编号、首次成为玩家、最近权益到期和累计有效时长均可用。 |
| WB-LIVE-012 | 玩家列表规则 | `A:users.list` | `profiles` | U | `覆盖`：关键词、状态、分会、等级、经验、玩家/嘉宾、注册时间和玩家生命周期筛选均由服务端执行。 |
| WB-LIVE-013 | 用户城市与服务器归属 | `A:users.list/get/changePrimaryBranch`、`A:branches.list` | `profiles`、`branches` | U、BR | `覆盖`：可读、按主分会筛选，并由受控后台动作修改主分会；服务端校验目标分会、scope、版本与审计。 |
| WB-LIVE-014 | 玩家档案－基础信息 | `A:users.get` | `profiles` | U | `部分`：核心公开资料、分会、账号状态和按权限手机号可见；不会展示微信账号/OpenID。 |
| WB-LIVE-015 | 玩家档案－成长信息 | `A:users.get`、`A:badges.awards` | `profiles`、`badges` | U、GR | `部分`：等级、经验、贡献、业务计数、玩家编号和累计有效玩家时长可见；完整勋章授予历史仍在独立勋章管理页查询。 |
| WB-LIVE-016 | 玩家档案－权益信息 | `A:users.get`、`A:orders.list`、`A:memberships.timeline` | `profiles`、`orders`、`membership-ledger` | U、OR、M | `覆盖`：当前/待生效权益、完整会籍权益历史、订单/退款与人工调整事实均可查；运营以玩家编号或昵称检索。 |
| WB-LIVE-017 | 玩家档案－职业信息 | `A:users.get` | `profiles` | U | `部分`：公司、组织和标签可读；未覆盖原型全部职业字段及独立维护工作流。 |
| WB-LIVE-018 | 玩家档案－社交影响力 | `A:users.influence.list` | `profiles` | U | `覆盖`：管理详情按邀请嘉宾、发出/收到心动、档案访问四类服务端事实展示汇总与分页明细。 |
| WB-LIVE-019 | 玩家档案－邀请嘉宾 | `A:users.influence.list` | `profiles` | U | `覆盖`：可按用户查看仍为嘉宾的邀请关系、活动来源和时间，不泄露内部用户标识。 |
| WB-LIVE-020 | 玩家档案－心动关系 | `A:users.influence.list`、`A:events.insights.get` | `profiles`、`event-console` | U、E | `覆盖`：可按用户查看发出/收到心动明细，活动控制台保留场次聚合；每场最多一人且可改选的领域规则不变。 |
| WB-LIVE-021 | 名片管理 | — | — | — | `缺失`：没有名片模板、版本、下架和审核管理 operation/page。 |
| WB-LIVE-022 | 合作卡管理 | `A:userContent.list/get/save/unpublish/archive` | `user-content`、`user-content-editor` | U、UC | `覆盖`：按明确归属用户创建/编辑，合作角色保持不可变；列表、详情、内容安全、版本冲突、下架、软归档和审计均有服务端合同。 |
| WB-LIVE-023 | 超级案例管理 | `A:userContent.list/get/save/unpublish/archive` | `user-content`、`user-content-editor` | U、UC | `覆盖`：按明确归属用户创建/编辑案例，素材引用受所有权和用途校验；支持内容安全、版本、下架、软归档和治理记录。 |
| WB-LIVE-024 | 勋章管理 | `A:badges.list/awards/save/grant/revoke` | `badges` | GR | `覆盖`：目录、授予、撤销、版本和审计均有本地合同；自动发放仍取决于相应领域事件。 |

### 活动管理（13）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-025 | 活动列表金额调整 | `A:events.get/save` | `events`、`event-console` | E | `部分`：可在编辑页按服务端资格修改价格，不是列表内联调整；已有报名/订单时受历史保护。 |
| WB-LIVE-026 | 活动标签设置 | `A:events.catalog.list/save/changeStatus/archive` | `event-catalogs` | E | `覆盖`：活动分类与标签目录支持创建、编辑、启停、软归档、去重、版本与审计。 |
| WB-LIVE-027 | 活动列表字段与筛选 | `A:events.list` | `managed-events` | E | `覆盖`：核心字段、关键词、状态、开始时间、城市/分会、活动类型、收费类型和金额区间组合筛选均由服务端执行，列表返回价格与统计事实。 |
| WB-LIVE-028 | 活动状态 | `A:events.changeStatus/archive` | `managed-events`、`event-console` | E | `覆盖`：草稿、发布、下架、取消、结束、归档均由服务端版本与历史保护控制。 |
| WB-LIVE-029 | 创建与编辑活动 | `A:events.policy.get/save`、`A:events.get/save` | `events`、`event-console` | E | `部分`：核心表单、媒体、发布策略和版本冲突已覆盖；自动本地草稿恢复未形成明确验收证据。 |
| WB-LIVE-030 | 手机端活动预览 | `A:events.get` | `events` | E | `覆盖`：编辑页有小程序预览路径；静态测试存在，仍需运行时视觉复核。 |
| WB-LIVE-031 | 活动列表排序 | `A:events.list` | `managed-events` | E | `覆盖`：默认按开始时间升序，运营可切换升/降序；游标绑定排序方向，切换排序不会复用旧游标。 |
| WB-LIVE-032 | 复制历史活动 | `A:events.clone` | `managed-events`、`events` | E | `覆盖`：复制生成新草稿并重置敏感日期/状态字段，带服务端测试。 |
| WB-LIVE-033 | 参与人列表 | `A:events.roster/rosterAll` | `event-participants`、`event-registrations` | E | `覆盖`：名单、报名答案、签到/支付关联、筛选和导出链路已存在。 |
| WB-LIVE-034 | 活动反馈 | `A:events.insights.get` | `event-feedback`、`event-console` | E | `覆盖`：反馈汇总和明细页面存在；真实数据仍取决于用户端提交。 |
| WB-LIVE-035 | 报名与支付联动 | 事件/commerce/ledger 合同 | `event-registrations`、`orders` | E、P | `覆盖 + 外部待验`：源码按 ledger 确认报名与权益，正式下单、回调和退款需真机/生产支付验收。 |
| WB-LIVE-036 | 签到二维码 | `A:events.checkIn/undoCheckIn`；events 签到凭证 | `event-participants`、用户端 `check-in` | E | `部分 + 外部待验`：签到/撤销和票据合同存在；二维码下载、扫码及防重需微信运行时验收。 |
| WB-LIVE-037 | 活动数据统计 | `A:events.insights.get` | `event-console`、`event-feedback` | E | `部分`：报名、支付、签到、反馈、评分、会员构成和心动聚合可用；访问/分享标记为未统计，心动双方明细和三角色口径缺失。 |

### 运营管理（2）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-038 | Banner 模块 | `B:list/get/save/changeStatus/move/delete` | `banners`、`banner-editor` | BN | `覆盖`：图片、跳转、窗口、排序、启停、软删除和版本校验均有独立合同。 |
| WB-LIVE-039 | 视频回顾模块 | `A:events.recaps.list/get/save/changeStatus/archive` | `event-recaps` | E | `覆盖 + 外部待验`：独立视频回顾目录、关联活动、排序、启停、软归档、版本和审计均已实现；正式视频号参数仍需配置与真机验收。 |

### 角色与权限（4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-040 | 角色列表字段 | `A:roles.list`、`A:rolePolicies.list` | `roles` | RB | `部分`：可查看固定角色、绑定和 capability policy；没有原型所列独立角色状态、账号数量和自由角色元数据。 |
| WB-LIVE-041 | 角色配置字段 | `A:rolePolicies.list/update`、`A:roles.set` | `roles` | RB | `部分 + 冲突`：可在服务端安全上限内配置 capability 和 scope；角色名、角色类型与敏感权限不能自由创建或突破上限。 |
| WB-LIVE-042 | 角色操作 | `A:roles.set`、`A:rolePolicies.update` | `roles` | RB | `部分 + 冲突`：支持授予/撤销绑定和更新 policy；不支持复制、删除或任意新增角色，历史绑定保留。 |
| WB-LIVE-043 | 业务权限范围 | `A:session`、`A:roles.list/candidates/set`、`A:rolePolicies.list/update` | `roles` | RB | `覆盖`：平台、城市分会、活动 scope 与 capability 每次由服务端重读，页面提交的角色不可信。 |

### 后台账号管理（8）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-044 | 账号列表字段 | `A:roles.candidates/list` | `roles` | RB | `部分`：可搜索 MIP 用户并查看/调整运营角色；没有独立登录账号、最后登录和账号状态模型。 |
| WB-LIVE-045 | 登录方式 | `A:session`（微信身份） | 全部管理页共用会话 | RB | `缺失 + 冲突`：当前只实现可信微信身份；验证码/密码 Web 登录被明确留作未来独立身份适配，不应伪装成已完成。 |
| WB-LIVE-046 | 新增与编辑账号 | — | — | — | `缺失`：没有 Web 管理账号 CRUD、手机号/登录名唯一性和凭证字段。 |
| WB-LIVE-047 | 账号创建流程 | — | — | — | `缺失`：没有短信发送初始凭证、首次改密或后台账号激活流程。 |
| WB-LIVE-048 | 账号状态与安全 | `A:roles.set`、`A:users.setControl` | `roles`、`profiles` | RB、U | `部分`：角色撤销和用户访问控制可立即生效；没有独立账号启停、自停保护、凭证重置或 Web session 撤销。 |
| WB-LIVE-049 | NPC／笨笨后台身份 | `A:roles.set` | `roles` | RB | `冲突`：NPC/笨笨没有独立会员身份；如需运营权限只能使用受 scope/capability 约束的角色绑定。 |
| WB-LIVE-050 | 登录记录 | `A:session` 写 `admin.session.enter`、`A:audit.list` | `audit` | RB、DS | `部分`：可审计进入运营管理；没有登录 IP、设备、成功/失败原因、会话时长等独立登录记录产品。 |
| WB-LIVE-051 | 审计日志 | `A:audit.list` | `audit` | RB | `覆盖`：管理 mutation、敏感读取与范围写入追加审计，不提供编辑或物理删除。 |

### 等级管理（4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-052 | 等级列表字段 | `A:growth.levels` | `growth-levels` | GR | `覆盖`：序号、名称、标识、门槛、权益关系、状态和版本可读。 |
| WB-LIVE-053 | 等级配置 | `A:growth.saveLevel` | `growth-levels` | GR | `覆盖`：新增/编辑、门槛递增、启停、排序、版本冲突与审计有服务端约束。 |
| WB-LIVE-054 | 等级权益 | `A:growth.benefits/saveBenefit/saveLevel` | `growth-benefits`、`growth-levels` | GR | `覆盖`：独立权益目录及等级绑定可配置；具体业务是否强制校验仍由各业务领域决定。 |
| WB-LIVE-055 | 等级统计与记录 | `A:growth.levels`、`A:growth.entries`、`A:growth.levelTransitions`、`A:users.list` | `growth-levels`、`growth-entries`、`growth-transitions`、`profiles` | GR、U | `部分`：可按当前经验推导等级，并查询成长流水、用户与不可变“原等级→新等级”记录；等级列表已显示当前人数/占比并可下钻用户，但尚未形成独立统计视图。 |

### 经验值管理（4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-056 | 经验值门槛 | `A:growth.levels/saveLevel` | `growth-levels` | GR | `覆盖`：门槛由服务端校验并按当前余额推导等级。 |
| WB-LIVE-057 | 经验值流水字段 | `A:growth.entries` | `growth-entries` | GR | `覆盖`：用户、来源事件、增减值、前后余额、原因和时间均来自不可变流水。 |
| WB-LIVE-058 | 经验值规则配置 | `A:growth.rules/saveRule` | `growth-rules` | GR | `部分`：事件类型、metric、delta、启停、版本、角色/分会范围、生效窗口和每日上限可配置；在线所列审批方式、周期上限和失败任务重试仍未完整建模。 |
| WB-LIVE-059 | 撤销与冲正 | `A:growth.adjust` | `growth-entries` | GR | `部分`：允许有原因、有权限的正负调整并追加新流水；不覆写原流水，也没有对任意历史流水的一键撤销 operation。 |

### 贡献值管理（4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-060 | 贡献规则列表字段 | `A:growth.rules` | `growth-rules` | GR | `覆盖`：CONTRIBUTION 规则共用成长规则目录；服务器范围、生效窗口和每日上限已在管理列表与编辑器中可读写，正式行为枚举、奖励数值和上限仍需业务配置。 |
| WB-LIVE-061 | 贡献规则操作 | `A:growth.saveRule` | `growth-rules` | GR | `覆盖`：新增/编辑/启停使用同一版本化规则合同，不物理删除历史。 |
| WB-LIVE-062 | 贡献值流水 | `A:growth.entries` | `growth-entries` | GR | `覆盖`：按 `metric=CONTRIBUTION` 查询不可变增减流水和余额。 |
| WB-LIVE-063 | 贡献行为范围 | `A:growth.rules/saveRule` | `growth-rules` | GR | `部分`：可用服务端事件类型定义行为；正式行为枚举、奖励数值和上限仍需业务配置。 |

### 权益管理（当前在线新增 4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-064 | 权益流水 | `A:benefits.ledger`、`A:memberships.timeline` | `benefit-ledger`、`membership-ledger` | GR、OR、U、BL | `覆盖`：只读聚合会员权益、成长流水、当前成长权益及关联订单，DTO 不暴露内部用户或来源标识。 |
| WB-LIVE-065 | 流水筛选与分页 | `A:benefits.ledger` | `benefit-ledger` | BL | `覆盖`：支持权益类型、昵称/玩家编号、开始/结束时间、10/20/50/100 页大小和稳定有界游标。 |
| WB-LIVE-066 | 手动发放权益 | `A:growth.adjust`、`A:memberships.grant` | `growth-entries`、`membership` | GR、M | `覆盖`：经验/贡献与 1/3/6/12 月会籍均通过独立受控动作追加，带 capability、幂等键、链版本、原因和审计；人工会籍明确记为 `ADMIN_ADJUSTMENT`，不伪造成支付订单。 |
| WB-LIVE-067 | 会籍计算规则 | commerce/payment ledger、`A:memberships.grant/timeline` | `orders`、`profiles`、`membership-ledger` | P、OR、M | `覆盖 + 冲突 + 外部待验`：购买与人工调整使用不同来源，均按既有非退款权益窗口串行追加；不硬编码默认 12 个月，正式支付回调仍待生产验收。 |

### 服务器管理（业务归一为城市分会，4）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-068 | 服务器列表字段 | `A:branches.list` | `branches` | BR | `部分`：分会编码、名称、城市、状态、关联阻塞数、当前有效玩家数和所有当前城市管理员姓名可见；没有另造唯一负责人或手工排序字段。 |
| WB-LIVE-069 | 服务器配置 | `A:branches.create/update/changeStatus` | `branches` | BR | `部分`：名称、编码、城市、简介、启停、版本和审计完备；没有负责人和展示排序配置。 |
| WB-LIVE-070 | 用户与服务器归属 | `A:users.list/get/changePrimaryBranch`、`A:branches.list` | `profiles`、`branches` | U、BR | `覆盖`：运营可在用户详情选择有效主分会；服务端重验平台权限、目标分会、乐观版本并写审计。 |
| WB-LIVE-071 | 跨服务器与数据权限 | `A:session`、`A:roles.list/candidates/set`、`A:rolePolicies.list/update` | `roles` | RB | `覆盖`：平台/分会/活动可见范围由服务端 capability 与 scope 重新授权；不新增通用 tenant/server。 |

### 任务管理（7）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-072 | 任务列表字段 | `T:listTasks/getTask` | `tasks` | TK | `覆盖 + 冲突`：名称、窗口、经验奖励、附件、模板、派发方式、等级和状态按当前任务卡合同可见；星级、笨笨老大、贡献值/奖金不是当前确认模型，不应直接加入。 |
| WB-LIVE-073 | 任务配置字段 | `T:saveTask/publishTask/unpublishTask/deleteTask` | `tasks` | TK | `部分`：核心内容、等级、窗口、派发、附件模板和软状态可配置；没有每周交付规则与审批负责人。 |
| WB-LIVE-074 | 任务奖励配置 | `T:saveTask` | `tasks` | TK | `覆盖 + 冲突`：任务完成只发放一次服务端权威经验值，符合当前确认合同；贡献值、奖金、多奖励开关和审批后发放不属于当前模型。 |
| WB-LIVE-075 | 任务附件与模板 | `T:saveTask/getCompletion` | `tasks`、`task-completions` | TK | `部分`：支持附件必填、单个模板素材和完成附件事实；格式/多附件/长期下载策略不等同于原型完整要求。 |
| WB-LIVE-076 | 每周任务指派 | `T:listAssignableMembers/assignMembers/revokeMembers` | `task-assignments` | TK | `部分`：支持指定成员批量派发/撤回和版本保护；没有按角色/标签的动态派发、笨笨老大归属和每周自动周期。 |
| WB-LIVE-077 | 任务提交、审批与奖励 | 用户 `completeTask`；无 `admin.approve/reject` | `task-completions` 只读 | TK | `冲突 + 部分`：当前提交在同一事务立即形成完成事实并仅发经验；没有待审批、退回、奖金/贡献奖励和审批失败重试状态机。 |
| WB-LIVE-078 | 任务完成流水字段 | `T:listCompletions/getCompletion/exportCompletions` | `task-completions` | TK | `覆盖`：用户、任务内容快照、附件、经验奖励、完成时间、结果和导出合同存在。 |

### 机会管理（5）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-079 | 机会列表字段与筛选 | `A:opportunities.list` | `opportunities` | OP | `覆盖`：标题、发布人、范围、城市、状态、发布时间、引荐数、结构化金额与合作地点可读，并支持关键词、发布人、城市、状态、时间、金额和地点类型筛选。 |
| WB-LIVE-080 | 机会详情字段 | `A:opportunities.get` | `opportunity-detail` | OP | `部分`：详情、发布人、scope、角色、标签、团队、封面、历史、结构化金额和多地点可见；完整“想推荐名单”仍按引荐/撮合事实分别查询。 |
| WB-LIVE-081 | 操作记录 | `A:opportunities.get`、`A:audit.list` | `opportunity-detail`、`audit` | OP、RB | `部分 + 冲突`：详情带当前机会审计历史；查看/导出不一定逐次写业务审计，删除只允许软归档并永久保留关联事实。 |
| WB-LIVE-082 | 创建机会字段 | `A:opportunities.options/save` | `opportunity-editor` | OP | `部分`：可配置发布人、scope、角色、标签、封面、详情、截止时间、结构化金额与多地点；管理端没有把任意整段文本自动识别成字段。 |
| WB-LIVE-083 | 机会状态 | `A:opportunities.publish/end/unpublish/archive` | `opportunities`、`opportunity-detail` | OP | `覆盖 + 冲突`：状态变更、版本和审计存在；“删除”按安全合同实现为软归档，不物理清除历史。 |

### 订单管理（7）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-084 | 订单列表字段 | `A:orders.list` | `orders` | OR | `覆盖`：订单类型、用户、商品、分会、金额、支付/服务状态、时间及退款聚合来自统一订单事实。 |
| WB-LIVE-085 | 订单详情字段 | `A:orders.get/list` | `orders` | OR | `覆盖`：独立详情 operation 返回订单、用户、商品、金额、支付尝试/回调、退款、关联权益和可证明的状态时间线；没有事实来源的中间状态不由页面推测，正式 provider 交易仍保留外部验收边界。 |
| WB-LIVE-086 | 订单查询与导出 | `A:orders.list`、`A:exports.create/prepare/reserve/complete/status` | `orders`、`exports` | OR | `覆盖`：组合筛选、敏感字段 capability、脱敏/含手机号导出票据和短期文件合同存在。 |
| WB-LIVE-087 | 支付流水 | `A:paymentAttempts.list`；payment ledger/callback | `payment-attempts`、`orders`、`exceptions` | PA、OR、P | `覆盖 + 外部待验`：独立列表按昵称、玩家编号、订单号、渠道、状态和时间筛选支付尝试，显示脱敏引用、金额、状态与关注标记；正式微信交易与回调待生产验收。 |
| WB-LIVE-088 | 活动订单联动 | event/commerce/payment ledger | `orders`、`event-registrations` | E、P、OR | `部分 + 冲突 + 外部待验`：付费报名、取消、退款和服务状态由 ledger 收敛；订单完成按服务事实/活动结束判断，不照抄“活动开始即完成”，正式支付待验。 |
| WB-LIVE-089 | 会费订单联动 | commerce/payment ledger | `orders`、`profiles` | P、OR | `冲突 + 外部待验`：首次/续费、权益延长和幂等回调存在；时长来自方案且系统支持受控会员退款，不能照抄固定一年及“会费永不退款”。 |
| WB-LIVE-090 | 活动退款记录 | `A:orders.list`、`A:refunds.submit/retry` | `orders`、`exceptions` | OR、P | `覆盖 + 外部待验`：退款号、金额、状态、失败原因和重试链路可查；实际 provider 提交/回调仍需生产支付验收。 |

### 后台消息（6）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-091 | 消息列表字段 | `A:messageCampaigns.list/get` | `message-campaigns` | MS | `覆盖`：标题、范围、发送方式/时间、状态、创建人及计划信息有版本化合同。 |
| WB-LIVE-092 | 消息配置字段 | `A:messageCampaigns.scopes/get/save/recipients` | `message-campaigns` | MS | `覆盖`：正文、范围、收件人、跳转、计划时间和版本校验由服务端处理。 |
| WB-LIVE-093 | 消息操作 | `A:messageCampaigns.save/snapshot/schedule/cancelSchedule/publish/withdraw` | `message-campaigns` | MS | `覆盖`：草稿、快照、定时、发布、撤回及不可编辑已发送事实均有 operation 和测试。 |
| WB-LIVE-094 | 发送记录字段 | `A:messageDeliveryRecords.list`、`A:messageDeliveryReviews.list/get` | `message-delivery-records`、`message-campaigns`、`exceptions` | DR、MS | `覆盖 + 外部待验`：逐条投递记录支持消息/活动/收件人、渠道、状态、日期和分页筛选，展示尝试次数、计划/完成时间与安全错误码；原始 provider 载荷按安全边界不下发，正式外部送达待验。 |
| WB-LIVE-095 | 消息触发场景 | outbox/notification worker；部分 `A:communications.publishEventReminder` | `message-campaigns`、`exceptions` | MS | `部分 + 外部待验`：活动、会员、成长、任务等部分事件会产生站内信/投递任务；原型枚举未全部实现，微信订阅模板与外部送达需正式配置。 |
| WB-LIVE-096 | 模板与内容快照 | `A:messageTemplates.list/get/save/activate/archive`、campaign snapshot | `message-campaigns` | MS | `覆盖`：模板版本、变量、跳转和发送时内容/收件人快照不会被后续编辑覆盖。 |

### 战队管理（5）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-097 | 固定团队枚举 | — | — | — | `缺失 + 冲突`：当前团队按赛季动态创建；没有且仅有红/白/蓝/紫/绿/灰/粉/黄/黑 9 队的不可改枚举。 |
| WB-LIVE-098 | 笨笨团队列表字段 | `G:listTeams` | `game` | GM | `部分`：名称、分会、简介、状态、版本、成员数和成员上限可读；缺固定颜色、图标及列表中的负责人汇总。队长可在成员管理中维护。 |
| WB-LIVE-099 | 团队详情字段 | `G:listTeams/listAssignableMembers/listMatches/listRankings` | `game`；用户端 `mip-game/team` | GM | `部分`：团队、成员、赛况、排行、成员上限及用户大本营可查，成员管理可选择负责人；仍没有原型全部视觉字段和完整变更记录详情。 |
| WB-LIVE-100 | 团队成员管理 | `G:listAssignableMembers/replaceTeamMembers` | `game` | GM | `覆盖`：队长/成员替换使用当前会员、赛季、分会与版本校验，并保留成员离队历史。 |
| WB-LIVE-101 | 团队启停与大本营 | `G:saveTeam/changeTeamStatus` | `game`；用户端 `mip-game/team` | GM | `部分`：团队本身已支持启用/停用，停用时保留历史并阻止后续成员/对阵变更；大本营按服务端队伍经验展示，管理页仍不能配置完整大本营素材。 |

### 首页仪表盘（9）

| ID | 需求点 | Operation | Page | Test | 判定与缺口 |
| --- | --- | --- | --- | --- | --- |
| WB-LIVE-102 | 筛选条件 | `A:dashboard.overview.get` | `dashboard` | DS | `覆盖`：预设周期、自定义开始/结束日期、平台/分会 scope、清空和错误状态均已接入同一服务端合同。 |
| WB-LIVE-103 | 用户指标 | `A:dashboard.overview.get` | `dashboard` | DS | `覆盖`：活跃账号、玩家、嘉宾、新增、资料完成、互动、访问/访客及比较值有显式可用性口径。 |
| WB-LIVE-104 | 玩家缴费指标 | `A:dashboard.overview.get` | `dashboard` | DS | `覆盖`：当前/临期玩家、首次缴费、首续、复续、金额和分桶序列均由订单与有效权益服务端事实计算。 |
| WB-LIVE-105 | 活动指标 | `A:dashboard.overview.get` | `dashboard` | DS | `部分`：活动、报名、签到、反馈、评分、收入/退款和趋势事实已建模；访问/分享等未追踪项会明确返回 unavailable。 |
| WB-LIVE-106 | 机会与内容指标 | `A:dashboard.overview.get` | `dashboard` | DS | `部分`：机会、团队形成、引荐、已发布合作卡/案例可统计；真实合作转化率明确为 `NOT_TRACKED`，知识内容指标未纳入。 |
| WB-LIVE-107 | 任务指标 | `A:dashboard.overview.get` | `dashboard` | DS | `部分`：发布任务、成功完成、奖励经验可统计；由于当前无审批流，待验收指标为 `NOT_PROVIDED`。 |
| WB-LIVE-108 | 趋势与下钻 | `A:dashboard.overview.get` | `dashboard` | DS | `覆盖`：按日/周/月分桶趋势、更新时间、指标状态和既有管理模块下钻入口已在手机/宽屏共用页面呈现。 |
| WB-LIVE-109 | 运营待办 | `A:dashboard.overview.get`、`A:operations.queue.list`、投递复核动作 | `dashboard`、`exceptions`、`message-delivery-review` | DS、MS | `部分`：异常与消息投递复核已汇入有界游标队列并进入明细闭环；活动/内容/勋章只在存在独立待审核事实时才能继续纳入，当前不伪造任务审批状态。 |
| WB-LIVE-110 | 全局日期时间筛选组件 | 各 operation 各自接受 ISO 时间字段 | `components/date-time-range`，已接入 `events`、`announcement-editor` | 各模块测试 | `部分`：已有可复用的开始/结束日期与时刻、清空、可选结束时间和本地值转 UTC ISO 合同；其余仅使用日期的筛选页按实际需要逐步接入，不机械改写。 |

## 可证实覆盖边界

当前仓库有 49 个已注册管理路由；`src/modules/mip-admin/generated/admin-operation-contract.json` 声明 145 个 `mip-admin-api` operation，任务、赛季/战队、Banner 另有独立管理 action。数量不能直接证明 110 项需求已完成：同一 operation 会服务多行需求，部分底层事实也没有对应管理入口。

按上表非互斥标签统计：62 行含 `覆盖`、40 行含 `部分`、7 行含 `缺失`、21 行含 `冲突`、12 行含 `外部待验`。标签可重叠，例如源码链路可覆盖主要行为但正式支付仍待验。

本次逐行检查显示，剩余优先级最高的工作集中在：

1. 文档与模型边界：修正已实现的规则字段、订单详情和团队启停状态；名片模板/版本治理、等级独立统计视图等仍需明确是否进入产品模型。
2. 任务与成长规则：当前任务合同已覆盖单次经验奖励；星级、奖金、贡献值、审批/退回/重试、周期上限等在线稿扩展需先完成产品裁决，不能直接扩展模型。
3. 指标与消息：访问/分享、真实合作转化、知识内容和审批指标没有事实来源；部分消息触发枚举、正式微信模板与 provider 送达属于口径补全或外部配置，不能伪造。
4. 战队与内容：当前保留动态赛季队伍模型，不实现固定九队；颜色、图标、完整负责人摘要、大本营素材治理和名片模板治理若要补齐，需先确认产品字段与迁移范围。
5. 运行验收：49 个管理路由已进入 2026-08-27 的 108/108 路由 375px 通过集合，1024px 管理端代表页已有真实目录数据证据；真机支付、扫码、媒体、手机号、订阅消息和 Mac/Windows 微信客户端继续保留外部边界。活动本地草稿恢复属于可选体验增强，不是当前领域模型缺口。

必须先产品裁决、不能按页面照抄的冲突包括：三种用户身份、固定一年会籍、手机号预建激活、自由角色/物理删除、会费永不退款、固定九队、任务审批与当前“提交即完成”合同。

## 历史 108 的最小补证

只需取得以下任一种，即可做无猜测差异审计：

- 2026-08-25 当日页面完整 HTML；
- 15 模块逐行 CSV/Excel/Markdown 导出；
- WorkBuddy 页面修订历史中能导出该日期版本的原始 DOM。

拿到后应按标准化 `(module, requirement_title, requirement_description)` 与本文件的当前 110 行做 diff，并把源文件 SHA-256 一并冻结。未取得前，正式文档中的“108”只能保留为历史自述，不能声称已有 108/108 可追踪性。
