# MIP 管理端功能基线（WorkBuddy 来源）

本文把网页后台需求整理为仓库内部执行基线。它不替代服务端安全、支付和数据合同，也不把在线原型中的演示数据当成真实业务数据。

## 来源与范围

- 来源：[WorkBuddy 后台 PRD V0.4](https://bfd568111f4249be9902eba8e876cece.app.workbuddy.link/#messages)
- 原型日期：2026-08-22
- 当前逐项审计日期：2026-08-27
- 当前范围：16 个后台模块、110 个一级需求点
- 逐项矩阵：[WorkBuddy 当前 110 条管理需求矩阵](WORKBUDDY_110_MATRIX.md)
- 历史证据：[2026-08-25 网页后台原型审计](evidence/admin-web-2026-08-25/README.md)；当时文档自述为 15 个模块、108 项，但仓库没有保存可复原的逐行原文

在线原型仍处于“需求细化中”。视觉、字段和交互是输入，不自动推翻 [CONTEXT.md](../../CONTEXT.md)、[REQUIREMENTS.md](REQUIREMENTS.md)、服务端资格、支付 ledger、审计和权限规则。

## 产品定位

WorkBuddy 原型作为 Web 管理后台的功能、字段、信息架构和视觉依据，但不作为领域、安全或生产数据事实。小程序管理分包继续负责手机微信和微信电脑端；React Web 工程用于桌面优先、手机自适应的浏览器运营。当前 14 个一级页面和 8 类详情已接入 80 条受审查询 action 与 80 条受审写 action。

两个管理界面共享同一套 MIP 用户、分会、订单、活动、权限、审计和消息事实，也共享同一套渠道中立管理合同。Web 只复用操作语义，不复制 WXML、小程序页面或运行时；生产数据接入必须经过 Web principal 与 HTTPS adapter。

### 2026-08-28 Web 交付状态

- 当前源码：本仓库 `admin-web/`，独立构建和部署；原 Web 基线与完整导入关系已保存在当前 Git 历史中
- 生产域名：`https://mipmini.01mvp.com/`；当前 React 生产源码为 `c182db2`，Cloudflare Pages deployment ID 为 `6d3b4c88-31e9-452f-b27f-1a95209d8f00`
- 已完成：响应式概览、用户、活动、订单、任务、Banner、素材、游戏、机会、成长、权限、消息、知识库、运营记录 14 个一级页面，以及用户、活动、订单、任务、任务完成记录、消息、知识库、机会 8 类详情；同源 Pages Function、AES-GCM `HttpOnly` 会话、来源和请求体限制；可信 Web principal adapter；80 条由生成契约约束的查询 action。
- 已完成安全底座：签名 envelope 的 nonce 在 MySQL 中一次性持久消费；80 条 Web 写 action 通过 required/optional 字段白名单、capability 与作用域复核。Task、Banner、Game 和导出创建等关键命令在领域内持久保存幂等结果；其他写操作依赖服务端版本冲突保护且不自动重试，网络结果不明确时必须刷新服务端事实。
- 线上验证：当前 React 版已由真实管理员进入 `AUTHENTICATED`，14/14 个一级路由均通过生产真实只读验收。CloudBase 核心函数及本轮修复函数均已部署，`pnpm cloud:verify` 通过；微信开发者工具最终报告 `.tmp/runtime-evidence/2026-08-28-final-r6/report.json` 通过 110/110 路由、6/6 代表状态、6/6 交互旅程，运行时与 IDE diagnostics 均为 0。
- 已完成网页入口：用户详情补录会员、活动详情克隆活动/发布提醒、订单详情提交退款；用户与订单敏感导出；Banner 全生命周期；游戏赛季、战队、成员、赛况、排行和盲盒配置；8 类用途的 PNG/JPEG 安全素材上传。生产证据进一步覆盖真实 JPEG 上传、Banner 以 `INACTIVE` 保存后软删除，以及 `USERS`、`includesPhone=false`、唯一无匹配条件的空结果导出：HTTPS 下载 ZIP magic、字节数和 SHA-256 校验一致，ticket 为 `CONSUMED`，验收进程内文件字节已清零。
- 外部待验：正式支付与退款回调、手机号和扫码等真机能力、AI/provider、外部消息投递以及 Mac/Windows 微信客户端仍保留独立验收边界。一次 Banner JPEG 和空结果无手机号导出不能外推为全部媒体用途、非空数据或敏感字段导出通过。
- 真实 BFF 请求失败时必须进入错误态，不得回退为演示数字。
- 本轮生产证据：[2026-08-28 React Web 线上验收](evidence/admin-web-live-2026-08-28-react/README.md)；此前 7 个页面和 5 类详情的[历史证据](evidence/admin-web-live-2026-08-28/README.md)继续保留，不用于代替当前版本结论。

## 状态定义

- `service-present`：现有服务端已经有可复用的主要业务能力。
- `service-partial`：已有部分能力，但字段、状态或行为仍有缺口。
- `web-readonly`：网页已通过真实身份和真实 API 读取，但写操作或完整页面能力仍未完成。
- `web-missing`：对应模块仍没有完整网页交互或真实数据验收；不再表示完全没有 Web 工程。
- `decision-needed`：原型与当前业务模型冲突，不能直接编码。
- `external-wait`：需要正式配置、真机、支付或生产环境。

## 模块地图

| 模块 | 原型一级需求点 | 现有基础 | 主要缺口 |
| --- | ---: | --- | --- |
| 首页仪表盘 | 9 | `mip-admin-api` 已有部分总量、增长、待办查询 | `web-readonly`；真实登录后的概览读取已验证，活跃、续费、转化、反馈率等口径仍需确认 |
| 用户管理 | 24 | 用户聚合、脱敏、档案、分会、角色、导出、审计为 `service-present` | `web-partial`；列表、详情、补录会员、资料/主分会/访问控制、角色绑定和敏感导出已接入；“普通用户”三分法、后台预建手机号用户和短信为 `decision-needed` |
| 活动管理 | 13 | 活动、报名、参与人、签到、反馈、相册、订单和导出为 `service-present` | `web-partial`；列表、详情、洞察、报名名单、创建/编辑、状态、审核、签到/撤销、相册审核、标签、目录、克隆、提醒和素材入口均已接入；正式支付为 `external-wait` |
| 运营管理 | 2 | Banner 为 `service-present`；视频回顾已有配置入口 | Banner 列表、创建、编辑、排序、启停、删除和素材跳转已接入；真实 JPEG、`INACTIVE` 保存及软删除已在线通过，正式视频号和其他运营素材仍为 `external-wait` |
| 等级管理 | 4 | 等级、权益、规则和流水为 `service-present` | `web-partial`；等级、权益、规则、流水和跃迁为只读，正式数值及目录编辑仍待配置 |
| 经验值管理 | 4 | 权威余额、流水、规则、调整和审计为 `service-present` | `web-partial`；流水和手工调整已接入，冲正展示与正式规则需验收 |
| 贡献值管理 | 4 | 权威余额、流水、规则和调整为 `service-present` | `web-partial`；流水和手工调整已接入，正式贡献行为和上限需确认 |
| 权益管理 | 4 | 统一权益投影已聚合订单、会籍权益、成长权益和流水 | 受控手工会籍仍缺；固定一年和无订单直接改权益与现有 ledger 冲突 |
| 任务管理 | 7 | 任务、成员派发、等级限制、模板、完成和奖励为 `service-present` | `web-partial`；列表、详情、完成记录、成员派发、发布/下架/删除和 XLSX 导出已接入；模板素材上传和线上写入需运行时验收 |
| 机会管理 | 5 | 机会、团队、评论、评价、引荐、撮合和审计为 `service-present` | `web-partial`；机会与用户内容列表、详情、保存、发布、结束、下架和归档已接入；“合作成功”和转化口径需确认 |
| 订单管理 | 7 | 统一订单、支付尝试、支付 ledger、退款和脱敏导出为 `service-present` | `web-partial`；真实订单列表、汇总、筛选、分页、详情、支付尝试、提交退款和敏感导出已接入；真实支付/回调/退款仍为 `external-wait` |
| 战队管理 | 5 | 赛季、队伍、成员历史、周赛和排行为 `service-present` | 赛季、队伍、成员、周赛、排行快照、盲盒目录和卡牌管理已接入；正式赛事规则和视觉为 `external-wait` |
| 角色与权限 | 4 | 七类角色、capability、平台/分会/活动 scope 为 `service-present` | `web-partial`；角色绑定、策略更新、分会创建/编辑/停用和审计列表已接入；原型的自由角色配置不能突破 capability 安全上限 |
| 后台账号管理 | 8 | 小程序管理员确认、网页会话和 14/14 个路由真实读取已形成闭环 | 当前确认登录为 `web-readonly`；独立密码/验证码账号、登录记录页面和凭证重置仍为 `decision-needed` 或 `web-missing` |
| 服务器管理 | 4 | 城市分会、成员归属和范围权限为 `service-present` | 服务器 CRUD 已接入；UI 使用“服务器”，内部继续使用城市分会模型，不新增通用租户模型 |
| 后台消息 | 6 | 站内信、运营消息活动、收件人快照、投递记录、失败复核、outbox 和 worker 为 `service-present` | `web-partial`；消息活动与模板的保存、快照、定时、发布、撤回和归档已接入；正式外部投递为 `external-wait` |

## 术语归一

### 用户、玩家与嘉宾

当前正式业务语言是一个用户账号，按有效付费权益动态判断为玩家或嘉宾。WorkBuddy 原型新增“普通用户”，并规定参加早会后才成为嘉宾，这与当前已确认规则冲突。

推荐不新增第三种会员角色。如果需要区分“未参加过活动”和“参加过活动”，将其建模为用户历程或活动参与事实，不要与玩家/嘉宾会员状态混在一起。

### 服务器与城市分会

“服务器”是产品 UI 对 MIP 城市分会的习惯称谓，不代表新增通用服务器或租户模型。Web UI 继续使用“服务器”；服务端模型、数据库表、`branch` 合同和权限范围继续使用 branch / city branch。`app_id` 负责应用隔离，城市分会负责业务范围，用户档案中的公司和组织不能产生后台权限。

原型提出普通用户和嘉宾没有服务器归属、只有玩家归属服务器；当前模型允许用户拥有一个主服务器。该差异仍需业务确认，实施前不修改现有城市分会事实。

### 后台角色与用户身份

玩家/嘉宾是会员状态，平台管理员、城市管理员和活动工作人员是运营权限，两者必须分开。NPC/笨笨如需登录后台，只能作为后台角色或账号标签，不能变成小程序用户会员角色。

## 不可直接采用的原型规则

- “微信支付成功即报名成功”必须解释为服务端 ledger 确认成功，不接受客户端 `requestPayment` 结果。
- 固定一年会籍不能覆盖可配置会员方案；是否只保留一年方案由产品配置决定。
- 原型中的手机号密码登录不能直接复用小程序 OpenID，也不能把角色和 capability 缓存在浏览器。
- 自由配置角色只能在服务端白名单和 scope 上限内组合，不能授予系统不存在的敏感权限。
- 已发送消息、审计、订单、权益、成长流水和业务历史不得物理删除。
- 仪表盘演示数字、日期、人物和金额只用于原型展示。

## 当前推荐架构

```text
手机微信管理页 ─┐
                 ├→ mip-admin presentation → AdminTransport(CloudBase)
微信电脑端宽屏页 ┘                         ↓
                          AdminApplication.execute(principal, command)
                                         ↓
               用户 / 活动 / 订单 / 权限 / 消息 / 知识库深模块
                                         ↓
                    capability / scope / expectedVersion / audit
                                         ↓
                         mip_* MySQL / outbox / media / export

独立网页 UI → AdminTransport(HTTPS；80 条查询 + 80 条受审 mutation) ─┘
```

任务管理的 Web BFF action 使用 `mip.admin.tasks.*` 这 13 个显式 operation。`mip-admin-api` 先重新读取当前管理员 session 并要求平台范围 `tasks.manage`，再以 `MIP_TASKS_ADMIN_HMAC_SECRET` 通过 `MIP_TASKS_FUNCTION_NAME`（默认 `mip-tasks-api`）调用任务函数；任务函数只接受 `mip-tasks-admin/v1` 签名请求、允许的 action、AppID 和真实管理员 userId。该密钥必须在 admin 与 tasks 两端配置且不同于 Web BFF/login 密钥，缺失或调用超时均拒绝执行。分页、任务、等级、成员筛选和完成筛选只允许 adapter 声明的字段，任务领域校验仍由 `mip-tasks-api` 负责。

Banner 管理同样只通过 `mip.admin.banners.*` 的 7 个渠道中立 operation 对外。`mip-admin-api` 重新读取当前管理员 session 并要求平台范围 `banners.manage`，再以独立的 `MIP_BANNERS_ADMIN_HMAC_SECRET` 调用 `MIP_BANNERS_FUNCTION_NAME`（默认 `mip-banners-api`）。Banner 函数的 trusted adapter 只接受 `mip-banners-admin/v1`、AppID allowlist、真实管理员 userId、固定来源函数和逐 action 输入白名单；原有微信入口仍使用可信微信上下文与完整访问门禁，不接受该内部身份字段。

游戏管理通过 `mip.admin.game.*` 的 20 个渠道中立 operation 对外，覆盖赛季、战队、成员、每周赛况、排行榜快照和盲盒配置。`mip-admin-api` 每次重读管理员 session 并要求平台范围 `game.manage`，再以独立的 `MIP_GAME_ADMIN_HMAC_SECRET` 调用 `MIP_GAME_FUNCTION_NAME`（默认 `mip-game-api`）。Game trusted adapter 对 action、顶层输入、赛季规则、成员数组、赛况、盲盒目录和卡牌字段逐层 fail closed；12 个写 operation 必须提供由 HMAC 覆盖的顶层幂等键，8 个查询 operation 明确拒绝该字段。幂等认领、业务写入与响应固化共用 Game MySQL 事务，相同键与规范化请求回放原响应，不同请求冲突，失败事务不会遗留认领记录。

Web 工程已迁入本仓库 `admin-web/`，作为 pnpm workspace 中独立构建、独立部署的 React 应用；根目录仍是原生 WXML/TypeScript 小程序主工程，技术栈和开发者工具入口不变。Web 使用以 WorkBuddy 为依据的蓝白 Design Token，小程序继续使用自己的设计规范；两端不共享页面组件或运行时。

### 管理 module 的 seam

当前 `mip-admin-api` 保持一个部署单元，但内部按用户、活动、订单、权限、消息和知识形成深模块，机会与成长作为后续独立模块。每个 module 用较小 interface 隐藏鉴权、scope、版本冲突、审计和事务细节；当前 CloudBase transport 和未来 HTTP transport 只做渠道适配，不复制业务规则。

当前渠道中立合同固定 187 个业务 operation（80 个查询、107 个写操作）；`health` 不进入该业务 manifest。Web 仅开放其中 80 个查询与 80 个经过单独审查的写操作。任务、Banner、游戏和媒体管理分别通过 `mip-admin-api` 的窄 typed adapter 调用 `mip-tasks-api`、`mip-banners-api`、`mip-game-api` 与 `mip-media-api`，不在 Web BFF 复制领域规则。后续拆模块不得同时改名或重做页面合同。外部稳定缝隙为：

```ts
interface AdminTransport {
  request<A extends AdminAction>(request: {
    contractVersion: 1
    action: A
    input: AdminInput<A>
    idempotencyKey?: string
  }): Promise<AdminOutput<A>>
}

interface AdminApplication {
  execute(
    principal: TrustedAdminPrincipal,
    command: { action: AdminAction, input: unknown },
  ): Promise<AdminEnvelope>
}
```

业务输入必须嵌套在 `input` 中。当前扁平 `{ action, ...data }` 会让业务字段 `action` 覆盖路由 action；迁移时先由兼容 adapter 接受旧格式，所有调用点切换后再删除。资源版本仍属于对应业务 input；服务端生成 `requestRef`、执行时间和幂等回放标记。

`TrustedAdminPrincipal` 只能由 CloudBase 微信上下文或 Web session adapter 创建，页面提交的应用、用户、角色和 capability 永远不可信。action manifest 统一记录输入校验、所需 capability、允许 scope、读写类型、幂等要求、outbox 唤醒和审计类型，避免这些 metadata 继续散落在 handler、service 和入口函数中。

建议内部模块边界：

| 深模块 | 独占事实与规则 | 可依赖 |
| --- | --- | --- |
| `access` | trusted principal、角色、capability、平台/分会/活动 scope、登录审计 | 用户只读状态 |
| `users` | 用户聚合、档案、分会归属、账号控制、敏感字段投影 | `access`、媒体引用 |
| `events` | 活动、报名、签到、名单、反馈、相册、提醒 | `access`、订单只读状态、消息端口 |
| `orders` | 订单查询、退款意图、导出中的财务字段 | `access`、payment ledger 端口 |
| `messaging` | 公告、消息活动、收件人快照、outbox 和发送状态 | `access`、目标资源只读端口 |
| `knowledge` | 来源、分类、内容、商品、评论与举报审核 | `access`、媒体与订单端口 |
| `opportunities` | 机会、团队、评论、举报、撮合设置与重算 | `access`、用户公开投影、消息端口 |
| `growth` | 等级、权益、规则、流水、勋章与调整 | `access`、用户只读状态 |

模块之间不直接读取对方内部 repository；跨域只通过窄端口或明确领域事件。数据库仍可在同一事务中操作，但事务编排归 application 层，避免为了“拆文件”而牺牲现有原子性。

### 网页身份与会话边界

当前已按“网页展示短期确认信息，小程序管理员确认登录”打通并验证只读生产数据闭环：

1. 网页创建短期、单次、绑定浏览器 verifier 的登录 challenge。
2. 已登录小程序且拥有管理 capability 的用户确认。
3. 服务端创建只保存 token hash 的网页 session。
4. Cookie 使用 `HttpOnly`、`Secure` 和合适的 `SameSite`；写操作校验 CSRF。
5. session 只保存必要的身份引用，每次请求重新读取用户状态、协议、角色和 capability。
6. 角色撤销、账号关闭或会话过期后，下一次请求立即失败。

上述闭环目前支持 80 条受审查询、14 个一级页面、8 类详情和 80 个受审写操作表单。Task、Banner、Game 和导出创建等关键命令具有领域持久幂等；其他操作不自动重试，并通过 `expectedVersion` 等服务端约束防止覆盖并发更新。QUERY 的 `safeToRetry` 约束业务事实不重复；dashboard 与运营队列查询产生的访问审计属于合规遥测，不改变业务事实，因此不需要改为 mutation。若业务方坚持手机号验证码/密码登录，需要额外建设验证码供应商、密码哈希、找回/重置、失败限制、异常通知和安全审计，不应作为首个版本默认方案。

### 数据、媒体、消息与审计

- 网页不能直接访问 MySQL，也不能提交可信的 `appId/userId/role/capability`。
- 媒体继续经过 reservation、隔离上传、完整解码、重编码、内容安全和 READY 绑定，不新增普通对象存储直传入口。
- 网页消息只提交运营命令，继续由 outbox、站内信和 worker 投影。
- mutation 与审计同事务；Web 请求在审计 metadata 中记录 `channel=WEB_ADMIN` 和 request reference，不记录 Cookie、授权头、OpenID 或完整浏览器载荷。

## 当前管理端完成标准

每个页面至少具备：

- 未登录、无权限、加载、空数据、错误、冲突和成功状态；
- 平台、城市分会、活动三级范围的正向与越权测试；
- 关键 mutation 的 `expectedVersion`、幂等和审计；
- 手机号、订单、退款、导出和角色变更的独立敏感 capability；
- 手机微信、Windows 微信和 Mac 微信的真实截图与操作记录；
- 宽屏键盘操作、错误恢复、窄窗降级和尺寸切换不丢状态；
- 手机与电脑端读取同一业务事实的双端一致性验证；
- 小程序静态门禁继续使用根 `pnpm verify`；Web 类型检查、测试、构建和响应式合同使用 `pnpm admin:web:verify`；合并门禁使用 `pnpm verify:all`。

平台能力与限制见 [DESKTOP_ADMIN_RESEARCH.md](DESKTOP_ADMIN_RESEARCH.md)。
