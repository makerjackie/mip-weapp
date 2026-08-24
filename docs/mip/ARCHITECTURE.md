# MIP 架构

MIP 是一个原生微信小程序、13 个核心 CloudBase 函数和三个可选支付函数组成的会员与协作平台。短期复用共享 CloudBase，业务数据、函数名和对象 key 使用 MIP 专属边界；正式 AppID 上线时迁移到空的独立 CloudBase/MySQL 环境。当前 schema 不支持在同一数据库中以相同主键并存两个 AppID 副本。

## 调用方向

```text
小程序页面 / 管理分包
  → src/modules/mip-* 用例接口
    → src/platform adapter
      → mip-* Cloud Functions
        → mip_* MySQL / mip/ 对象存储
```

页面不得直接初始化 CloudBase、读取 MySQL 或调用 `wx.requestPayment`。客户端只提交业务意图；身份、玩家/嘉宾状态、会员资格、金额、名额、活动资格、成长流水、通知状态和管理权限都由服务端决定。

未来独立后台 API 复用同一套服务端 DTO、capability、错误码和审计合同，只新增后台 adapter，不复制业务规则。当前管理端仍在小程序管理分包中。

临时 AppID 与正式 AppID 的 OpenID 不相同。身份服务可以在微信提供 UnionID 时保存不可逆摘要，并在完成应用范围迁移后通过显式开关衔接原用户；流程和前置条件见 [AppID 身份迁移](../IDENTITY_MIGRATION.md)。

## 当前函数边界

| 函数 | 负责的领域 | 调用边界 |
| --- | --- | --- |
| `mip-identity-api` | 微信身份、协议、手机号、用户档案 | 小程序调用 |
| `mip-media-api` | 图片解码、内容安全、隔离存储和素材登记（含活动相册） | 小程序调用 |
| `mip-events-api` | 城市/平台活动、报名、邀请、签到、心动、反馈和活动相册 | 小程序调用 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、超级案例 | 小程序调用 |
| `mip-community-api` | 公开档案举报、屏蔽关系和个人屏蔽列表 | 小程序调用；身份补全后可写 |
| `mip-commerce-api` | 会员方案、统一订单、订单查询和退款申请 | 小程序调用 |
| `mip-admin-api` | 管理分包、分会/活动/相册运营、审计、导出 | capability 保护 |
| `mip-growth-api` | 等级、规则、余额和不可变成长流水 | 小程序或内部事件 |
| `mip-ai-api` | 音频、转写、结构化草稿和用户确认 | 小程序；provider 内部鉴权 |
| `mip-notifications-api` | 当前用户站内消息、已读状态和订阅授权选择 | 小程序调用 |
| `mip-payment-ledger` | 支付、退款、权益和订单事务 | 仅内部 HMAC |
| `mip-notification-worker` | 站内消息写入和可选微信订阅消息投递 | 仅内部 HMAC，无定时器 |
| `mip-outbox-worker` | 业务事件领取、站内消息与成长投影 | 仅内部 HMAC，无定时器 |
| `mip-cloudpay` / `mip-cloudpay-callback` | CloudPay 参数、用户退款、查单和回调适配 | 支付启用时部署 |
| `mip-refund-worker` | 管理退款提交、provider 查单和耐久退款恢复 | 仅内部 HMAC；支付启用时部署，无定时器 |

历史 `membership-*` Cloud Functions 不属于当前部署清单。保留的旧目录仅用于迁移期参考，不能继续扩展或部署到共享环境。

## 业务域

| 域 | 主要事实 | 不能由客户端决定 |
| --- | --- | --- |
| identity/profile | 用户、微信身份、协议、手机号、公开/私密档案 | `user_id`、手机号归属、资料可见性 |
| branches | 城市分会、主分会、分会成员和范围 | 当前城市不等于管理权限 |
| membership commerce | 会员方案、统一订单、支付 ledger、退款、权益 | 价格、支付终态、玩家状态 |
| events | 活动、报名、邀请、签到、心动、反馈、相册照片 | 名额、活动资格、签到和照片发布状态 |
| opportunities | 机会、引荐、感兴趣、合作卡、超级案例 | 内容审核和关系状态 |
| community safety | 举报事实、双向可见性屏蔽和个人屏蔽列表 | 客户端目标身份、举报处置和对方通知 |
| growth | 等级、规则、经验/贡献余额与流水 | 客户端直接加分；游戏币不在本次实现与验收范围 |
| messaging | 站内消息、授权和投递任务 | 业务事实最终状态、授权消耗 |
| ai | 语音、转写、结构化草稿 | 未确认草稿不能写正式资源 |
| admin | 平台/分会/活动 capability、脱敏、导出、审计 | 页面菜单不是授权依据 |

### 玩家和嘉宾

用户只有一个身份。当前拥有有效 `mip_membership_entitlements` 的用户是玩家；没有有效付费权益的用户是嘉宾。退款、到期或撤销后，服务端重新计算为嘉宾。嘉宾仍可浏览公开内容，并按活动和机会规则参与；页面不能通过本地标记把嘉宾变成玩家。

## 数据与隔离

- 新业务只写 `mip_*` 表，迁移记录使用 `mip_schema_migrations`；表结构以 `database/mysql/mip/` 和 lock 文件为准。
- `mip_orders` 统一承载会员和付费活动订单，不能再引入第二套会员/活动订单表。
- 每张业务表使用可信 `app_id`；所有唯一约束、订单、管理员、幂等键、审计和对象 key 都按 AppID 隔离。
- 对象存储只使用 `mip/` 前缀，数据库保存完整 `cloud://` 文件 ID、摘要和业务外键，不保存临时 URL。
- 共享环境的 `member_*`、`dating_*`、`sewing_*` 表与历史 `membership-*` 运行时保持只读/不部署，不做跨表迁移。
- MIP runtime 账号只有精确的 `mip_*` 表级权限；无 schema-level ALL、无全局 DELETE。支付适配器不持有数据库凭证。

## 授权顺序

```text
可信 CloudBase AppID/OpenID
  → 解析 MIP user
    → 读取 app-scoped 资源与分会归属
      → 平台 capability
        → 城市分会 capability
          → 活动临时 capability
            → 默认拒绝
```

手机号、导出、退款、角色变更、签到覆盖、相册审核和成长人工调整使用独立 capability，并追加不可变审计。活动报名、付费席位、相册提交/撤回、支付回调和退款都使用行锁、版本或幂等键与条件状态更新。

## 运行时和迁移边界

`mip-notification-worker`、`mip-outbox-worker` 和 `mip-refund-worker` 不安装高频 timer。Outbox worker 按 AppID 领取事件，回查服务端事实后，以内部 HMAC 和幂等键调用消息与成长服务；退款 worker 只从 ledger 读取金额和商户单号，使用不可变退款单号向 provider 提交或查单。需要处理积压时分别运行 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10` 和 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。未知事件或重试耗尽会终止并写系统审计。短期共享环境的变更流程是：仓库外逻辑备份 → `mip_` 前缀 dry-run → 迁移 → 函数部署 → 只读健康检查。未来独立环境迁移时，只复制经过校验的 MIP 表、`mip/` 对象和 MIP 配置，重新绑定 AppID，不迁移旧项目资源。

并行开发前冻结 `UserId`、`BranchId`、`EventId`、`OpportunityId`、`OrderId`、caller context、错误码、分页游标、审计 envelope、状态机和跨域事件名。各域不能自行创建第二套身份、订单或权限模型。
