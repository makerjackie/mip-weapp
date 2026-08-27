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

WorkBuddy 原型只作为管理功能、字段和信息架构输入，不作为视觉基线。小程序管理分包继续负责手机微信和微信电脑端；独立 Web 工程已经建立，用于浏览器宽屏运营和后续真实 API 接入。

两个管理界面共享同一套 MIP 用户、分会、订单、活动、权限、审计和消息事实，也共享同一套渠道中立管理合同。独立 Web 只复用操作语义和视觉模式，不复制 WXML；生产数据接入必须经过 Web principal 与 HTTPS adapter。

### 2026-08-28 Web 交付状态

- 独立仓库：相邻工程 `mip-admin-web`
- 测试域名：`https://mipmini.01mvp.com/`
- 已完成：响应式概览、用户、活动、订单、权限、消息、知识库壳层；同源 Pages Function、AES-GCM `HttpOnly` 会话、来源和请求体限制；CloudBase 内部 HMAC 可信 principal adapter；会话、概览和用户列表三条只读 action。
- 未完成：短期登录码及小程序管理员确认闭环、CloudBase HTTP 访问服务路由、两端密钥配置、真实数据浏览器验收和其余 CRUD。
- 当前在线演示版必须明确标记“本地演示数据”；启用真实 BFF 的构建遇到 API 失败时必须进入错误态，不得再回退为演示数字。

## 状态定义

- `service-present`：现有服务端已经有可复用的主要业务能力。
- `service-partial`：已有部分能力，但字段、状态或行为仍有缺口。
- `web-missing`：对应模块仍没有完整网页交互或真实数据验收；不再表示完全没有 Web 工程。
- `decision-needed`：原型与当前业务模型冲突，不能直接编码。
- `external-wait`：需要正式配置、真机、支付或生产环境。

## 模块地图

| 模块 | 原型一级需求点 | 现有基础 | 主要缺口 |
| --- | ---: | --- | --- |
| 首页仪表盘 | 9 | `mip-admin-api` 已有部分总量、增长、待办查询 | `web-missing`；活跃、续费、转化、反馈率等口径需确认 |
| 用户管理 | 24 | 用户聚合、脱敏、档案、分会、角色、导出、审计为 `service-present` | `web-missing`；“普通用户”三分法、后台预建手机号用户和短信为 `decision-needed` |
| 活动管理 | 13 | 活动、报名、参与人、签到、反馈、相册、订单和导出为 `service-present` | `web-missing`；历史复制、手机预览和部分统计为 `service-partial`；支付为 `external-wait` |
| 运营管理 | 2 | Banner 为 `service-present`；视频回顾已有配置入口 | `web-missing`；正式视频号和素材为 `external-wait` |
| 等级管理 | 4 | 等级、权益、规则和流水为 `service-present` | `web-missing`；正式等级和权益数值待配置 |
| 经验值管理 | 4 | 权威余额、流水、规则、调整和审计为 `service-present` | `web-missing`；冲正展示与正式规则需验收 |
| 贡献值管理 | 4 | 权威余额、流水、规则和调整为 `service-present` | `web-missing`；正式贡献行为和上限需确认 |
| 权益管理 | 4 | 统一权益投影已聚合订单、会籍权益、成长权益和流水 | 受控手工会籍仍缺；固定一年和无订单直接改权益与现有 ledger 冲突 |
| 任务管理 | 7 | 任务、成员派发、等级限制、模板、完成和奖励为 `service-present` | `web-missing`；上传、审批和失败恢复需运行时验收 |
| 机会管理 | 5 | 机会、团队、评论、评价、引荐、撮合和审计为 `service-present` | `web-missing`；“合作成功”和转化口径需确认 |
| 订单管理 | 7 | 统一订单、支付尝试、支付 ledger、退款和脱敏导出为 `service-present` | `web-missing`；真实支付、回调和退款为 `external-wait` |
| 战队管理 | 5 | 赛季、队伍、成员历史、周赛和排行为 `service-present` | `web-missing`；正式赛事规则和视觉为 `external-wait` |
| 角色与权限 | 4 | 七类角色、capability、平台/分会/活动 scope 为 `service-present` | `web-missing`；原型的自由角色配置不能突破 capability 安全上限 |
| 后台账号管理 | 8 | 现有小程序管理员身份和登录审计可复用 | 网页账号、会话、验证码/密码登录、登录记录和凭证重置均为 `web-missing` |
| 服务器管理 | 4 | 城市分会、成员归属和范围权限为 `service-present` | “服务器”与城市分会的关系为 `decision-needed`；不新增通用租户模型 |
| 后台消息 | 6 | 站内信、运营消息活动、收件人快照、投递记录、失败复核、outbox 和 worker 为 `service-present` | `web-missing`；正式模板与外部投递为 `external-wait` |

## 术语归一

### 用户、玩家与嘉宾

当前正式业务语言是一个用户账号，按有效付费权益动态判断为玩家或嘉宾。WorkBuddy 原型新增“普通用户”，并规定参加早会后才成为嘉宾，这与当前已确认规则冲突。

推荐不新增第三种会员角色。如果需要区分“未参加过活动”和“参加过活动”，将其建模为用户历程或活动参与事实，不要与玩家/嘉宾会员状态混在一起。

### 服务器与城市分会

原型明确把“服务器”解释为 MIP 分会。内部统一使用“城市分会”，`app_id` 继续负责应用隔离，城市分会负责业务范围。用户档案中的公司和组织不能产生后台权限。

原型提出普通用户和嘉宾没有服务器归属、只有玩家归属服务器；当前模型允许用户拥有一个主分会。该差异需要业务确认，实施前不修改现有分会事实。

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

独立网页 UI → AdminTransport(HTTPS，待接入) ───────────┘
```

Web 工程保持独立仓库，不把小程序改成 Monorepo，也不改变原生 WXML/TypeScript 技术栈。两个管理端都使用 MIP 黑黄设计系统；WorkBuddy 的蓝白视觉不进入产品。

### 管理 module 的 seam

当前 `mip-admin-api` 保持一个部署单元，但内部按用户、活动、订单、权限、消息和知识形成深模块，机会与成长作为后续独立模块。每个 module 用较小 interface 隐藏鉴权、scope、版本冲突、审计和事务细节；当前 CloudBase transport 和未来 HTTP transport 只做渠道适配，不复制业务规则。

当前渠道中立合同固定 145 个业务 operation；`health` 不进入该业务 manifest。后续拆模块不得同时改名或重做页面合同。外部稳定缝隙为：

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

`TrustedAdminPrincipal` 只能由 CloudBase 微信上下文或未来 Web session adapter 创建，页面提交的 `appId`、`userId`、role 和 capability 永远不可信。action manifest 统一记录输入校验、所需 capability、允许 scope、读写类型、幂等要求、outbox 唤醒和审计类型，避免这些 metadata 继续散落在 handler、service 和入口函数中。

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

### 未来网页身份与会话边界

生产数据接入仍按“网页展示登录码，小程序管理员确认登录”实现：

1. 网页创建短期、单次、绑定浏览器 verifier 的登录 challenge。
2. 已登录小程序且拥有管理 capability 的用户确认。
3. 服务端创建只保存 token hash 的网页 session。
4. Cookie 使用 `HttpOnly`、`Secure` 和合适的 `SameSite`；写操作校验 CSRF。
5. session 只保存 `app_id + user_id`，每次请求重新读取用户状态、协议、角色和 capability。
6. 角色撤销、账号关闭或会话过期后，下一次请求立即失败。

若业务方坚持手机号验证码/密码登录，需要额外建设验证码供应商、密码哈希、找回/重置、失败限制、异常通知和安全审计，不应作为首个版本默认方案。

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
- 类型检查、静态测试、构建、运行时预检和响应式合同纳入根 `pnpm verify`。

平台能力与限制见 [DESKTOP_ADMIN_RESEARCH.md](DESKTOP_ADMIN_RESEARCH.md)。
