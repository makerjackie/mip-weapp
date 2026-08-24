# CloudBase 运行边界

MIP 短期复用共享 CloudBase 环境，但在函数、数据库、对象存储和运行时账号上建立独立边界。真实 AppID、EnvID、MySQL URI、商户凭证和内部密钥只放本机 `.env.local` 或 Cloud Function 环境变量，不进入仓库。

## 当前云端事实（2026-08-24）

| 范围 | 当前事实 | 结论 |
| --- | --- | --- |
| 数据库 | 29 个锁定的 `mip_*` 迁移已在当前共享数据库成功应用，变更前稳定备份保存在本地仓库外目录 | 云端已验证；后续新增迁移仍需遵守备份合同 |
| runtime 数据库权限 | 环境专属账号已收敛为 75 张 MIP 业务表的精确表级权限，幂等复跑为 `already current` | 云端已验证；没有 schema/global 权限或跨项目表权限 |
| 数据隔离 | 迁移后隔离检查通过，MIP 变更只落在 `mip_*` 对象和 `mip_schema_migrations` | 云端已验证；没有把旧项目表当作 MIP 事实 |
| 开发者工具 | 已登录当前项目并能看到云函数列表 | 只证明控制台可见性，不证明函数配置或健康 |
| 核心函数 | 云端已存在一个空的 `mip-identity-api` 函数壳 | `external-wait`；尚未写入目标 VPC、子网、运行时环境变量和仓库代码，MySQL 健康检查未通过 |
| 完整核心套件 | 16 个核心函数的完整部署与验收未完成；2026-08-24 数据库收口后重试在首个函数创建前被拒绝，缺少 `scf:CreateFunction` 与目标 VPC/子网权限 | `external-wait`；本次没有产生半部署函数 |

当前 `CLOUDBASE_API_KEY` 可以完成环境和 MySQL 操作；已恢复的本地 CloudBase 登录也能绑定环境，但部署身份没有 `scf:CreateFunction` 和目标 VPC/子网权限，后续更新还需要 `scf:UpdateFunctionConfiguration`。`managePermissions` 只能读写 CloudBase 资源安全规则，不能给当前身份追加 CAM 策略或代替主账号执行 `cam:PassRole`，因此不能用它修复这个阻塞。

## 部署清单

普通业务部署固定为 16 个核心函数：

| 函数 | 责任 | 客户端可直接调用 |
| --- | --- | --- |
| `mip-identity-api` | 身份、协议、手机号、用户档案、账号注销 | 是 |
| `mip-media-api` | 图片解码、内容安全、隔离存储和素材登记（含活动相册） | 是 |
| `mip-events-api` | 活动、报名、邀请、签到、心动、反馈和活动相册 | 是 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、超级案例 | 是 |
| `mip-community-api` | 公开档案举报、屏蔽关系和个人屏蔽列表 | 是，受身份补全约束 |
| `mip-commerce-api` | 会员方案、统一订单、退款申请、订单查询 | 是 |
| `mip-admin-api` | 管理分包、分会、活动与相册运营、审计、导出 | 是，受 capability 约束 |
| `mip-growth-api` | 成长等级、规则、账户和流水 | 是；内部事件也可调用 |
| `mip-game-api` | 团队、赛季、每周赛况、排行榜快照与队伍大本营 | 是；只向有效会员开放，管理动作受 `game.manage` capability 约束 |
| `mip-tasks-api` | 任务卡、全员或指定成员派发、模板、截止窗口、单次完成事实、附件复核、经验奖励和完成流水 | 是；管理动作受 `tasks.manage` capability 约束 |
| `mip-banners-api` | 公开 Banner 读取、版本化编辑、排序、启停和软删除 | 是；管理动作受 `banners.manage` capability 约束 |
| `mip-ai-api` | 语音、转写和结构化草稿 | 是；provider 回调走内部鉴权 |
| `mip-notifications-api` | 站内消息读取、已读状态和订阅授权选择 | 是，仅处理当前用户数据 |
| `mip-payment-ledger` | 支付、退款和权益事务事实 | 否，仅内部 HMAC 调用 |
| `mip-notification-worker` | 站内消息写入和可选订阅消息投递 | 否，仅内部 HMAC 调用 |
| `mip-outbox-worker` | 业务事件领取、站内消息与成长投影 | 否，仅内部 HMAC 调用 |

启用真实支付时，另外部署 `mip-cloudpay`、`mip-cloudpay-callback` 和 `mip-refund-worker`。它们是下单/查单适配器、回调入口和退款提交/恢复 worker，不计入 16 个核心函数；适配器不持有 MySQL 连接串，通过 HMAC 调用 `mip-payment-ledger`。退款 worker 另用 `MIP_REFUND_WORKER_HMAC_SECRET` 接受管理 API 和受控运营命令调用。

`cloudfunctions/membership-*` 目录是迁移期间保留的历史实现，当前运行时不部署、不新增业务，也不能作为 MIP 的部署目标。部署脚本和云端验收只接受直接的 `mip-*` 源码与函数名。

## 数据和存储

- 新业务只使用 `mip_*` 表，迁移记录写入 `mip_schema_migrations`；`database/mysql/mip/migrations.lock.json` 是迁移顺序、校验和和表清单的权威来源。
- 订单统一使用 `mip_orders`：`order_type=MEMBERSHIP` 表示会员订单，`order_type=EVENT` 表示付费活动订单。不要为会员和活动再建立第二套订单事实。
- 对象存储 key 统一使用 `mip/` 前缀。数据库保存完整 `cloud://` 文件 ID、摘要、大小和业务外键，不保存临时 HTTPS URL。
- 图片只通过 `mip-media-api` 上传；函数完整解码并重新编码 PNG/JPEG，执行微信图片内容安全检查，再写入 `mip/<stage>/<appScope>/` 和 `mip_media_assets`。业务保存接口仍按 owner、状态和 purpose 验证素材，上传成功不能直接授予业务绑定。
- 活动照片使用独立 `EVENT_ALBUM` purpose 和 `mip/<stage>/<appScope>/event-album/` 存储目录。相册提交和批准发布都会重新校验可信媒体记录；客户端不能提交发布状态、上传者或对象 key。
- 任务模板使用独立 `TASK_TEMPLATE` purpose 和 `task-templates/` 目录，只允许平台负责人或平台运营上传；任务保存时再次复核 AppID、状态、purpose、类型、尺寸和大小，用户详情只在任务对本人有效时返回临时可下载地址。
- 共享环境中的旧 `member_*`、`dating_*`、`sewing_*` 表和对象保持只读，不迁移、不修复、不删除。

## 运行时最小权限

`pnpm project:init` 使用 CloudBase EnvID 派生专用 MySQL runtime 账号；迁移后必须运行 `pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>`，收敛并回读验证精确的 table→privilege 映射：不授予 schema-level `ALL PRIVILEGES`、全局权限或无业务需要的 `DELETE`；审计及流水等追加事实只保留所需权限。命令不会接管归属无法证明的同名账号，也不会修改其他 schema 或其他账号的权限；发现账号归属或授权范围无法证明时会停止。函数通过 VPC 私网连接 MySQL，客户端永远拿不到连接串。

每个请求都使用可信 CloudBase 上下文解析 `app_id` 和用户身份。`MIP_ALLOWED_APP_IDS` 必须包含当前小程序 AppID；客户端传入的 AppID、用户 ID、金额、资格和权限都不能成为 ownership 或状态事实。

## 受控 worker

`mip-notification-worker`、`mip-outbox-worker` 和 `mip-refund-worker` 只保留函数，不安装高频定时触发器。`mip-notifications-api` 显式允许已登录小程序调用，三个 worker 与 payment ledger 显式禁止客户端调用；部署和云端验收会收敛并复核这些函数级权限。任何访问 MySQL 的 5 分钟级 timer 都会阻止 Serverless MySQL 自动暂停并产生持续 CCU 消耗。业务事实与 outbox 在同一事务提交；通知授权先由 reservation 短事务独占，实际微信调用和最终状态写入再由锁定 `ACTIVE` 用户的专用投递事务串行化，避免账号注销提交后继续发信。微信接收与 MySQL 提交仍是 at-least-once 外部边界，详见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。退款 worker 从 ledger 回查权威退款事实并使用不可变商户退款单号保证重试安全。积压由运营命令显式恢复：

```bash
pnpm outbox:run -- --confirm-env=<EnvID> --limit=10
pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10
```

AI 语音 TTL 不使用定时触发器。无人访问的过期或终态草稿通过 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 显式分批处理；维护 action 使用 AI 内部 HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，响应只返回状态与数量。

## 环境与授权

EnvID 只写项目根目录 `.env.local` 的 `CLOUDBASE_ENV_ID`。同一文件必须配置环境级 `CLOUDBASE_API_KEY`，并明确配置 `MIP_DEPLOYMENT_STAGE=development|test|staging|production`；核心函数部署会把 stage 注入存储和签到环境，不能自行改写。production 部署必须额外传入 `--confirm-production`。CloudBase MCP 统一从 `config/mcporter.json` 启动，不接受前端 `publish_key` 或已有设备登录作为正常管理凭证。

```bash
pnpm cloud:status
pnpm cloud:auth
pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run
pnpm project:init
pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>
```

`pnpm cloud:status` 与 `pnpm cloud:auth` 都会显式执行 API Key 登录并验证目标 EnvID，成功后应为 `READY`；缺 Key 或 EnvID 时直接失败。`READY` 只表示凭证和环境绑定可用，不表示该身份拥有 SCF、VPC 或 `PassRole` 权限。部署必须同时明确 `--confirm-env=<精确 EnvID>` 和环境专属 runtime 账号；当 `MIP_DEPLOYMENT_STAGE=production` 时命令还必须追加 `--confirm-production`。脚本不会自动设备授权、切换环境或处理其他项目的数据库账号。

设备码不属于正常使用流程。只有维护者确认 API Key 通道不可用且需要临时救援时，才允许显式运行：

```bash
pnpm cloud:auth:device -- --allow-device-auth
```

该命令不会被部署、诊断或初始化脚本调用；恢复后仍应创建或更换环境级 API Key。

## 当前部署阻塞与最小人工动作

选择以下任一方式即可继续，不需要改代码或重建数据库：

1. 推荐：由腾讯云主账号在 CAM/CloudBase 控制台完成服务授权，确认 `TCB_QcsRole` 已存在且允许 CloudBase/SCF 使用目标 VPC 和子网；随后继续使用环境级 API Key，不依赖重复设备登录。
2. 自动化：提供一个只用于当前环境和 `mip-*` 函数的专用 CAM 部署身份。不要提供主账号长期密钥，也不要授予 `cam:*`、`scf:*` 或 `vpc:*` 的无限范围策略。

专用 CAM 身份必须包含部署脚本实际使用的完整 action 集：

| 服务 | 必需 actions | 用途 |
| --- | --- | --- |
| SCF | `scf:GetFunction`、`scf:CreateFunction`、`scf:UpdateFunctionCode`、`scf:UpdateFunctionConfiguration`、`scf:InvokeFunction`、`scf:ListTriggers`、`scf:DeleteTrigger` | 创建/更新代码和配置、读取回写、健康检查、确认禁用高频 timer |
| CloudBase | `tcb:DescribeEnvs`、`tcb:DescribeResourcePermission`、`tcb:ModifyResourcePermission` | 绑定目标环境并收敛、回读函数的客户端调用规则 |
| VPC | `vpc:DescribeVpcs`、`vpc:DescribeSubnets` | 读取并校验函数要绑定的目标 VPC 和子网 |
| CAM | `cam:GetRole`、`cam:ListAttachedRolePolicies`、`cam:PassRole` | 读取角色及其关联策略，并把 CloudBase 服务角色精确传递给 SCF |

只有显式使用 `--replace-legacy-runtime` 重建不兼容的现有 `mip-*` 函数时，才额外需要 `scf:DeleteFunction`；正常部署不需要。当前部署身份还要保留已经验证可用的目标环境查询和 MySQL 查询/执行能力，不能为了部署函数撤销数据库迁移与运行时账号收敛所需权限。

`cam:PassRole` 必须只指向 CloudBase 服务角色，不能写成 `*`：

```json
{
  "effect": "allow",
  "action": ["cam:PassRole"],
  "resource": ["qcs::cam::uin/${OwnerUin}:roleName/TCB_QcsRole"]
}
```

`${OwnerUin}` 由主账号在 CAM 控制台填入；仓库和沟通记录不得保存真实 UIN。SCF actions 只授权当前地域、当前 CloudBase namespace 下的 `mip-*` 函数；VPC actions 按 CAM 对对应 action 支持的最小资源范围授权，不授予 `vpc:*`。授权完成后，从脚本重新覆盖空函数壳并验收，不在控制台手工补环境变量：

```bash
pnpm cloud:status
pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
pnpm cloud:verify -- --confirm-env=<EnvID>
```

只有 `cloud:deploy` 完成全部函数的代码、VPC、环境变量、调用规则和 timer 收敛，且 `cloud:verify` 证明每个核心函数为 Active、Nodejs20.19、使用专用 runtime MySQL 账号并通过健康检查后，才能把正式运行时从 `external-wait` 改为已验收。

## 未来迁移

短期共享环境只允许 MIP 资源按上述边界共存。未来切换到独立 AppID 或 CloudBase 环境时，只迁移经过备份和校验的 `mip_*` 数据、`mip/` 对象及 MIP 函数配置，然后重新绑定可信 AppID；不得把旧项目表或共享环境的默认权限一起迁移。

更多数据库和 MCP 说明见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
