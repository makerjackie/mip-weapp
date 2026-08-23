# MIP 架构

MIP 是一个原生微信小程序和一组 CloudBase 服务。当前管理界面保留在小程序分包，服务端用稳定 DTO 和 capability 设计，未来 Web 管理后台只新增 adapter，不复制业务规则。

## 调用方向

```text
pages / packages
  → src/modules/* 的用例接口
    → src/platform/* adapter
      → mip-* 云函数
        → mip_* MySQL 表 / mip/ 对象存储
```

页面不得直接调用 `wx.cloud.init`、`wx.requestPayment`、MySQL 或通知 provider。客户端只提交意图；资格、金额、权限、状态迁移和成长奖励都由服务端模块决定。

## 领域模块

| 模块 | 负责 | 不负责 |
| --- | --- | --- |
| identity-profile | 微信身份、协议、手机号、档案、隐私 | 会员资格、运营角色 |
| branches | 城市分会、主分会、城市管理员范围 | 公司/组织展示字段 |
| membership-commerce | 方案、订单、支付 ledger、退款、权益 | 页面支付成功提示 |
| events | 活动、报名、邀请、签到、心动、反馈 | 支付终态、成长余额 |
| opportunities | 机会、引荐、感兴趣、合作卡、超级案例 | 人工聊天、支付 |
| growth | 等级、规则、余额和不可变流水 | 客户端直接加分 |
| messaging | 站内消息、outbox、微信 adapter | 业务事实的最终状态 |
| admin | capability、脱敏、导出、审计和运营用例 | 页面菜单作为授权依据 |

模块对外提供少量用例接口和 DTO。MySQL、CloudPay、订阅消息、语音识别和对象存储属于 adapter；每个远程 adapter 必须有可运行的测试替身。

## 服务端边界

| 部署名 | 责任 |
| --- | --- |
| `mip-api` | 普通用户查询与命令入口 |
| `mip-admin-api` | 当前小程序管理分包和未来 Web 后台入口 |
| `mip-payment` | 薄 CloudPay/微信支付适配器，不持有业务资格 |
| `mip-payment-ledger` | 订单、支付、退款和权益的事务事实 |
| `mip-notification-worker` | 领取 outbox，写站内消息并尝试外部送达 |
| `mip-ai-assistant` | 语音上传、转写和结构化草稿；不直接保存正式档案 |

部署脚本只能产生 `mip-*` 名称。函数源码可以在迁移期间保留历史目录名，但部署名、环境变量和日志标签不得回退到共享名称。

## 数据与存储隔离

- 新业务表一律以 `mip_` 开头，使用独立 `mip_schema_migrations`。
- 历史 `member_*`、`dating_*`、`sewing_*` 等表在本仓库中只读，不迁移、不修复、不删除。
- 对象存储 key 以 `mip/{stage}/{app-scope}/{domain}/` 开头。
- 每张业务表保留可信 `app_id`；城市资源同时包含 `branch_id`。客户端传入的 app、用户或城市范围都不是授权事实。
- 正式迁移到新小程序时，只复制 `mip_*` 和 `mip/` 对象，并重新绑定可信 AppID；不搬运其他项目表。

## 授权

```text
可信 AppID/OpenID
→ 解析 MIP 用户
→ 加载目标资源及 branch_id
→ 检查平台 capability
→ 检查城市分会 capability
→ 检查活动临时 capability
→ 默认拒绝
```

“当前城市”只是导航状态，不授予权限。手机号原文、导出、退款、角色变更和成长人工调整使用独立 capability，并写不可变审计。

## 并行开发边界

底座冻结以下共享合同后，各域才可并行：

- `UserId`、`BranchId`、`EventId`、`OpportunityId`、`OrderId` 的格式；
- caller context、错误码、分页游标、审计 envelope；
- `mip_*` 迁移顺序和测试夹具；
- 领域状态机与跨域事件名称；
- 设计 token、主 Tab 和通用 loading/empty/error 状态。

并行 Agent 只能修改分配的模块和预留迁移，不得自行创建第二套身份、当前城市或权限模型。
