# CloudBase 运行边界

MIP 短期复用共享 CloudBase 环境，但在函数、数据库、对象存储和运行时账号上建立独立边界。真实 AppID、EnvID、MySQL URI、商户凭证和内部密钥只放本机 `.env.local` 或 Cloud Function 环境变量，不进入仓库。

## 当前云端事实（2026-08-25）

| 范围 | 当前事实 | 结论 |
| --- | --- | --- |
| 数据库 | 38 个锁定的 `mip_*` 迁移已在当前共享数据库成功应用，变更前稳定备份保存在本地仓库外目录 | 云端已验证；本轮不再重复备份，后续新增迁移仍需遵守备份合同 |
| runtime 数据库权限 | 环境专属账号已收敛为 105 张 MIP 业务表的精确表级权限，幂等复跑为 `already current` | 云端已验证；没有 schema/global 权限或跨项目表权限 |
| 数据隔离 | 迁移后隔离检查通过，MIP 变更只落在 `mip_*` 对象和 `mip_schema_migrations` | 云端已验证；没有把旧项目表当作 MIP 事实 |
| 管理授权 | 环境 API Key 可完成环境和 MySQL 操作；主账号 Device Flow 可完成 SCF 管控面部署 | 两种凭证边界已分别验证；MCP `2.32.0` 的设备登录解决了环境 API Key 临时 STS 被拒绝的问题 |
| 核心函数 | 最终工作区代码已部署到 16 个核心 `mip-*` 函数，配置为 Nodejs20.19、目标 VPC/子网和完整运行时环境变量 | 云端已验证；全部函数为 Active/Available，并通过真实 MySQL 健康检查 |
| 调用边界与 worker | 客户端 API 已开放给已登录用户；payment ledger、notification worker 与 outbox worker 保持受保护 | 云端已验证；禁止的 5 分钟 timer 不存在 |

2026-08-24 的首次 API Key 部署在原始 SCF `CreateFunction` 被拒绝；升级 MCP 并使用资源主账号 Device Flow 后完成函数创建。2026-08-25 的代码更新先严格回读现有 VPC、运行时和环境变量，配置完全一致的函数只执行 `updateFunctionCode`，随后 16/16 函数部署和独立 `cloud:verify` 均通过。`managePermissions` 仍只负责 CloudBase 资源安全规则，不能修改 CAM 或 STS policy。

## 部署清单

普通业务部署固定为 16 个核心函数：

| 函数 | 责任 | 客户端可直接调用 |
| --- | --- | --- |
| `mip-identity-api` | 身份、协议、手机号、用户档案、账号注销 | 是 |
| `mip-media-api` | 图片解码、内容安全、隔离存储和素材登记（含活动相册） | 是 |
| `mip-events-api` | 活动、报名、邀请、签到、心动、反馈和活动相册 | 是 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、超级案例、机会撮合和用户偏好 | 是 |
| `mip-community-api` | 公开档案安全、知识内容目录/详情和知识评论 | 是；写操作受身份补全约束 |
| `mip-commerce-api` | 会员方案、会员/活动/单内容统一订单、退款申请、订单查询 | 是 |
| `mip-admin-api` | 管理分包、分会、活动、相册与知识内容运营、审计、导出和显式采集 | 是，受 capability 约束 |
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

仓库只包含直接的 `mip-*` 函数源码。部署脚本和云端验收只接受当前 MIP 清单中的函数名，不修改共享环境中的其他项目函数。

## 数据和存储

- 新业务只使用 `mip_*` 表，迁移记录写入 `mip_schema_migrations`；`database/mysql/mip/migrations.lock.json` 是迁移顺序、校验和和表清单的权威来源。
- 订单统一使用 `mip_orders`：`order_type=MEMBERSHIP` 表示会员订单，`order_type=EVENT` 表示付费活动订单，`order_type=CONTENT` 表示单内容解锁订单。不要再建立第二套订单事实。
- 对象存储 key 统一使用 `mip/` 前缀。数据库保存完整 `cloud://` 文件 ID、摘要、大小和业务外键，不保存临时 HTTPS URL。
- 图片只通过 `mip-media-api` 上传；函数完整解码并重新编码 PNG/JPEG，执行微信图片内容安全检查，再写入 `mip/<stage>/<appScope>/` 和 `mip_media_assets`。业务保存接口仍按 owner、状态和 purpose 验证素材，上传成功不能直接授予业务绑定。
- 活动照片使用独立 `EVENT_ALBUM` purpose 和 `mip/<stage>/<appScope>/event-album/` 存储目录。相册提交和批准发布都会重新校验可信媒体记录；客户端不能提交发布状态、上传者或对象 key。
- 任务模板使用独立 `TASK_TEMPLATE` purpose 和 `task-templates/` 目录，只允许平台负责人或平台运营上传；任务保存时再次复核 AppID、状态、purpose、类型、尺寸和大小，用户详情只在任务对本人有效时返回临时可下载地址。
- 共享环境中的旧 `member_*`、`dating_*`、`sewing_*` 表和对象保持只读，不迁移、不修复、不删除。

## 运行时最小权限

`pnpm project:init` 使用 CloudBase EnvID 派生专用 MySQL runtime 账号；迁移后必须运行 `pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>`，收敛并回读验证精确的 table→privilege 映射：不授予 schema-level `ALL PRIVILEGES`、全局权限或无业务需要的 `DELETE`；审计及流水等追加事实只保留所需权限。命令不会接管归属无法证明的同名账号，也不会修改其他 schema 或其他账号的权限；发现账号归属或授权范围无法证明时会停止。函数通过 VPC 私网连接 MySQL，客户端永远拿不到连接串。

每个请求都使用可信 CloudBase 上下文解析 `app_id` 和用户身份。`MIP_ALLOWED_APP_IDS` 必须包含当前小程序 AppID；客户端传入的 AppID、用户 ID、金额、资格和权限都不能成为 ownership 或状态事实。

## 受控 worker

`mip-notification-worker`、`mip-outbox-worker` 和 `mip-refund-worker` 只保留函数，不安装高频定时触发器。`mip-notifications-api` 显式允许已登录小程序调用，三个 worker 与 payment ledger 显式禁止客户端调用；部署和云端验收会收敛并复核这些函数级权限。任何访问 MySQL 的 5 分钟级 timer 都会阻止 Serverless MySQL 自动暂停并产生持续 CCU 消耗。业务事实与 outbox 在同一事务提交；身份、活动、机会、交易、任务、管理 API 以及 payment ledger 在成功提交且对应 action 可能写入 outbox 后，以可信 AppID 和内部 HMAC 唤醒有数量与 45 秒时限的批量排空。每批最多并行处理 10 条，单次最多 100 批；存在微信订阅任务时，在 outbox 事实完成前同步触发通知 worker，失败会保留可重试事实。Payment ledger 只使用其已通过内部 HMAC 校验的 AppID；缺少 `MIP_OUTBOX_HMAC_SECRET` 时安全跳过，调用失败只记录不含密钥的结构化错误，不回滚已提交业务。成长 API 的内部投影 action 不反向唤醒 outbox，避免 worker 递归。通知授权先由 reservation 短事务独占，实际微信调用和最终状态写入再由锁定 `ACTIVE` 用户的专用投递事务串行化，避免账号注销提交后继续发信。微信接收与 MySQL 提交仍是 at-least-once 外部边界，详见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。极端积压仍可由运营命令显式恢复：

函数安全规则属于共享环境配置。部署只允许修改当前 `mip-*` 函数的命名条目；规则读取、JSON 解析或通配规则缺失时立即停止，更新后必须证明 `*` 和其他项目的全部条目没有变化。部署和验收会检查所有核心 MIP 函数的完整 trigger 列表并拒绝任何 timer；脚本只会自动删除 `mip-notification-every-5m`、`mip-outbox-every-5m` 和 `mip-refund-every-5m` 三个已知历史名称，其他 timer 一律保留现场并停止。`MIP_PAYMENT_MODE=disabled` 时不删除可能承载晚到回调的支付函数，但会把已存在的支付适配器、回调和退款 worker 的客户端调用全部收敛为禁止，并复核它们没有 timer。

```bash
pnpm outbox:run -- --confirm-env=<EnvID> --limit=10
pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10
```

AI 语音 TTL 不使用定时触发器。无人访问的过期或终态草稿通过 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 显式分批处理；维护 action 使用 AI 内部 HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，响应只返回状态与数量。

机会撮合不安装 timer。`MIP_MATCHING_INTERNAL_HMAC_SECRET` 只用于 `mip-admin-api` 调用 `mip-opportunities-api` 的后台重算，部署脚本在本地生成并向两端注入同一密钥。`MIP_MATCHING_REFERENCE_SECRET` 只用于签名请求范围内的候选引用，必须保持稳定且不得写入数据库、客户端日志或外部 provider 请求。`MIP_MATCHING_PROVIDER_FUNCTION_NAME` 可选；为空时使用本地确定性 provider。启用外部函数时，超时由 `MIP_MATCHING_PROVIDER_TIMEOUT_MS` 控制，允许范围 500–10000 毫秒，默认 3000 毫秒。外部 provider 仅收到候选引用、类型、本地分数和匿名信号键/权重；人才用户 ID、分会/城市/标签内部主键不离开服务端。

热点采集同样不安装 timer。`mip-admin-api` 仅通过 `knowledge.manage` capability 提供显式运行接口，并在写事务内重锁当前用户、角色和 policy。`MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS` 配置精确来源域名；采集拒绝 IP literal、私网/保留 DNS 结果、DNS rebinding、凭证和重定向，采用 10 秒超时、解压后流式 2 MB 上限和 50 条条目上限。`MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS` 配置服务端发布与小程序 web-view 共用的精确业务域名，必须与微信公众平台一致。两项白名单缺失时部署停止。采集内容进入审核而不自动发布，全文分块内容安全检查全部通过后才能发布。`MIP_CATALOG_STAGE=TEST|LIVE` 控制读取的知识商品目录；`MIP_KNOWLEDGE_TEST_PRICE_CENTS` 只提供 TEST 商品的可替换默认价格，正式价格仍由 LIVE 商品配置决定。

## 环境与授权

EnvID 只写项目根目录 `.env.local` 的 `CLOUDBASE_ENV_ID`。同一文件必须配置环境级 `CLOUDBASE_API_KEY`，并明确配置 `MIP_DEPLOYMENT_STAGE=development|test|staging|production`；核心函数部署会把 stage 注入存储和签到环境，不能自行改写。production 部署必须额外传入 `--confirm-production`。CloudBase MCP 统一从 `config/mcporter.json` 启动，不接受前端 `publish_key`。

```bash
pnpm cloud:status
pnpm cloud:auth
pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run
pnpm project:init
pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>
```

只更新一个现有核心函数时，可追加 `--only=<exact mip-* function name>`。单函数模式只复制、更新并复核该函数的代码、配置、定时器和调用规则；未知或非核心函数名会被拒绝。

`pnpm cloud:status` 与 `pnpm cloud:auth` 都会显式执行 API Key 登录并验证目标 EnvID，成功后应为 `READY`；缺 Key 或 EnvID 时直接失败。`READY` 只表示凭证和环境绑定可用，不证明原始 SCF 管控面 action 可用。部署必须同时明确 `--confirm-env=<精确 EnvID>` 和环境专属 runtime 账号；当 `MIP_DEPLOYMENT_STAGE=production` 时命令还必须追加 `--confirm-production`。脚本不会自动设备授权、切换环境或处理其他项目的数据库账号；现有函数配置完全一致时只更新代码，任何配置漂移仍要求相应 SCF/VPC 权限并在失败时停止。

设备码不由正常命令自动触发。只有维护者获得明确授权，或 API Key 的临时 STS 无法执行所需管控面 action 时，才允许显式运行：

```bash
pnpm cloud:auth:device -- --allow-device-auth
```

该命令不会被部署、诊断或初始化脚本调用。授权完成后，使用 `CLOUDBASE_AUTH_MODE=local` 明确选择本地 Device Flow 凭证；环境 API Key 仍保留给状态、环境和 MySQL 等已验证操作。

## 已验证的管控面部署路径

当前共享环境的核心函数使用资源主账号 Device Flow 完成部署。不要给 `TCB_QcsRole` 添加 `scf:CreateFunction`，也不要在没有原始 VPC 错误时预授 `vpc:*`。需要重新部署时，从脚本覆盖代码、配置与权限，不在控制台手工补环境变量：

```bash
pnpm cloud:auth:device -- --allow-device-auth
pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
CLOUDBASE_AUTH_MODE=local pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
CLOUDBASE_AUTH_MODE=local pnpm cloud:verify -- --confirm-env=<EnvID>
```

MCP `2.32.0` 的 `getInstanceInfo` 不再返回 VPC/子网；部署脚本只在缺少显式网络配置时调用 `getConnectionInfo`，只提取实际 MySQL 网络元数据，不打印或持久化其余连接载荷。最终代码的 `cloud:deploy` 和独立 `cloud:verify` 均已在当前环境通过。

## 未来迁移

短期共享环境只允许 MIP 资源按上述边界共存。未来切换到独立 AppID 或 CloudBase 环境时，只迁移经过备份和校验的 `mip_*` 数据、`mip/` 对象及 MIP 函数配置，然后重新绑定可信 AppID；不得把旧项目表或共享环境的默认权限一起迁移。

更多数据库和 MCP 说明见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
