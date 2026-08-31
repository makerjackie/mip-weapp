# MIP 当前架构

MIP 由原生微信小程序、React Web 管理端、CloudBase 云函数、MySQL 和对象存储组成。根目录是小程序主工程，`admin-web/` 独立构建和部署；两端共享服务端业务事实，不共享页面组件或客户端运行时。

动态数量与部署状态统一见 [PROJECT_STATUS.md](PROJECT_STATUS.md)，本文件不固化路由数、迁移数或最近一次验收结果。

## 系统形态

```text
微信小程序用户端 ─→ src/modules/mip-* ─→ src/platform ─→ mip-* 云函数
微信小程序管理端 ─→ AdminTransport(CloudBase) ─┐
React Web 管理端 ─→ 同源 BFF / HTTPS transport ─┼→ AdminApplication
                                                  ↓
                                  领域服务 / capability / scope / audit
                                                  ↓
                                  mip_* MySQL / mip/ 对象 / outbox
```

页面不得直接初始化 CloudBase、读取 MySQL 或调用 `wx.requestPayment`。客户端只提交业务意图；身份、会员资格、金额、报名、签到、成长余额、比赛分数、通知状态和管理权限由服务端决定。

React Web 当前已经存在于 `admin-web/`。它通过同源 BFF 建立 Web principal，再使用与小程序管理分包相同的渠道中立 operation 合同；浏览器不能直接访问 MySQL，也不能提交可信的 `appId`、`userId`、角色或 capability。

## 管理应用边界

管理端使用统一请求形态：

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
    command: { action: AdminAction; input: unknown },
  ): Promise<AdminEnvelope>
}
```

`TrustedAdminPrincipal` 只能由 CloudBase 微信上下文或 Web session adapter 创建。operation registry 统一声明输入校验、capability、scope、读写类型、幂等要求、outbox 唤醒和审计类型。任务、Banner、游戏和媒体仍由 `mip-admin-api` 通过窄 adapter 调用对应独立函数，不能在 BFF 复制领域规则。

当前 `mip-admin-api` 保持单一部署单元，内部按以下深模块组织：

| 模块 | 独占事实与规则 | 可依赖 |
| --- | --- | --- |
| `access` | trusted principal、角色、capability、平台/分会/活动 scope、登录审计 | 用户只读状态 |
| `users` | 用户聚合、档案、分会归属、账号控制、敏感字段投影 | `access`、媒体引用 |
| `events` | 活动、报名、签到、名单、反馈、相册、提醒 | `access`、订单只读状态、消息端口 |
| `orders` | 订单查询、退款意图、财务字段 | `access`、payment ledger 端口 |
| `messaging` | 公告、消息活动、收件人快照、outbox、发送状态 | `access`、目标资源只读端口 |
| `knowledge` | 来源、分类、内容、商品、评论、举报和采集计划 | `access`、媒体、订单端口 |
| `opportunities` | 机会、团队、评论、举报、撮合设置与重算 | `access`、公开用户投影、消息端口 |
| `growth` | 等级、权益、规则、流水、勋章与调整 | `access`、用户只读状态 |

模块之间只通过窄端口或领域事件协作，不直接读取另一模块的内部 repository。

## 云函数边界

| 函数 | 负责范围 | 调用边界 |
| --- | --- | --- |
| `mip-identity-api` | 微信身份、协议、手机号、用户档案 | 小程序调用 |
| `mip-media-api` | 媒体隔离上传、解码、内容安全、重编码和绑定 | 小程序及受审管理 adapter |
| `mip-events-api` | 活动、报名、邀请、签到、心动、反馈和相册 | 小程序调用 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、案例、撮合和偏好 | 小程序；后台重算使用内部 HMAC |
| `mip-community-api` | 公开档案、知识目录/详情和知识评论 | 小程序调用 |
| `mip-commerce-api` | 会员、活动和内容统一订单、订单查询、退款申请 | 小程序调用 |
| `mip-admin-api` | 管理应用、分会/活动/知识运营、审计、导出和采集事实 | capability 与 scope 保护 |
| `mip-growth-api` | 等级、规则、余额和不可变成长流水 | 小程序或内部事件 |
| `mip-game-api` | 赛季、团队、周赛、排行、盲盒和背包 | 玩家读取；管理动作受 capability 保护 |
| `mip-tasks-api` | 任务、成员派发、模板、完成事实和经验奖励 | 小程序；管理动作受 capability 保护 |
| `mip-banners-api` | Banner 读取、编辑、排序、启停和软删除 | 小程序读取；管理动作受 capability 保护 |
| `mip-ai-api` | 音频、转写、结构化草稿和用户确认 | 小程序；provider 内部鉴权 |
| `mip-notifications-api` | 站内消息、已读状态和订阅选择 | 小程序调用 |
| `mip-payment-ledger` | 支付、退款、权益和订单事务 | 仅内部 HMAC |
| `mip-notification-worker` | 站内消息写入和可选微信投递 | 仅内部 HMAC，不安装定时器 |
| `mip-outbox-worker` | 业务事件领取、消息与成长投影 | 仅内部 HMAC，不安装定时器 |
| `mip-message-scheduler` | 消息活动的下一次唤醒 | 无 MySQL/VPC；一个滚动单次 timer |
| `mip-knowledge-scheduler` | 知识采集计划的下一次唤醒 | 无 MySQL/VPC；一个滚动单次 timer |
| `mip-cloudpay` / `mip-cloudpay-callback` | CloudPay 参数、查单和回调适配 | 支付启用时部署 |
| `mip-refund-worker` | 退款提交、查单和恢复 | 仅内部 HMAC；支付启用时部署，不安装定时器 |

核心部署、调度函数和支付函数是三组独立清单。共享环境里其他项目的函数不属于本仓库，也不由 MIP 部署脚本修改。

## 调度约束

通知 worker、outbox worker 和退款 worker 不安装高频定时器，避免持续唤醒 Serverless MySQL。

消息排期和知识采集分别使用 `mip-message-scheduler` 与 `mip-knowledge-scheduler`。两个 scheduler 都不连接 MySQL、不配置 VPC，分别维护唯一的滚动单次 timer，并通过不同的专用 HMAC 调用 `mip-admin-api`。权威计划、资格复核、失败计数、去重、内容保存和审核状态仍在管理领域内；没有有效计划时关闭 timer。知识采集只允许受控 HTTPS 来源，采集结果进入审核，不能自动发布。

详细部署与 CAM 约束见 [CLOUDBASE.md](../CLOUDBASE.md) 和 [OPERATIONS.md](../OPERATIONS.md)。

## 业务事实

| 域 | 权威事实 | 客户端不能决定 |
| --- | --- | --- |
| identity/profile | 用户、微信身份、协议、手机号、公开/私密档案 | 用户 ID、手机号归属、资料可见性 |
| branches | 城市分会、主分会、分会成员和范围 | 当前城市不等于管理权限 |
| commerce | 会员/活动/内容统一订单、支付 ledger、退款、权益 | 价格、支付终态、玩家状态和内容解锁 |
| events | 活动、报名、邀请、签到、心动、反馈、相册 | 名额、资格、签到和照片发布状态 |
| opportunities | 机会、团队、引荐、兴趣、评论、案例、撮合和偏好 | 内容审核、候选范围、关系状态和结果版本 |
| knowledge | 来源、分类、内容、采集计划/运行、商品、权益、评论和举报 | 发布状态、价格、受保护正文、退款资格 |
| growth/game/tasks | 等级、余额、流水、勋章、任务、赛季、排行和盲盒 | 奖励、分数、抽取结果、完成资格 |
| messaging | 站内消息、收件人快照、投递任务和回执 | 业务事实终态和授权消耗 |
| admin | 角色、capability、scope、脱敏、导出和审计 | 页面菜单不是授权依据 |

用户只有一个账号身份。当前有效付费权益决定玩家状态，其他用户为嘉宾；会员状态与管理角色、城市分会归属相互独立。

## 数据与隔离

- MIP 业务只写 `mip_*` 表，迁移记录使用 `mip_schema_migrations`；结构以 `database/mysql/mip/` 和 `migrations.lock.json` 为准。
- `mip_orders` 统一承载会员、活动和内容订单，不新增第二套订单事实。
- 每张业务表使用可信 `app_id`；唯一约束、幂等键、审计和对象 key 都按 AppID 隔离。
- 对象存储只使用 `mip/` 前缀，数据库保存完整 `cloud://` 文件 ID、摘要和业务外键，不保存临时 URL。
- 共享环境中的其他项目前缀保持只读；MIP runtime 账号只拥有精确的 `mip_*` 表级权限。
- 当前 schema 不支持在同一数据库中以相同主键并存两个 AppID 副本；正式迁移必须使用明确的导出、空目标校验和 AppID 转换流程。

## Web 会话与敏感操作

Web 登录使用短期、单次、绑定浏览器 verifier 的 challenge，由已登录且拥有管理 capability 的小程序用户确认。服务端只保存 session token hash；Cookie 使用 `HttpOnly`、`Secure` 和合适的 `SameSite`，写操作校验 CSRF。每次请求重新读取用户状态、协议、角色和 capability，撤权或停用后下一次请求立即失败。

手机号原文、导出、退款、角色变更、签到覆盖、相册审核和成长人工调整使用独立 capability。mutation 与审计在同一事务内；审计只记录必要的 channel 和 request reference，不记录 Cookie、授权头、OpenID 或完整浏览器载荷。

临时 AppID 与正式 AppID 的 OpenID 不相同，身份迁移见 [IDENTITY_MIGRATION.md](../IDENTITY_MIGRATION.md)。
