# CloudBase 运行边界

MIP 短期复用共享 CloudBase 环境，但在函数、数据库、对象存储和运行时账号上建立独立边界。普通开发配置和环境级 API Key 放本机 `.env.local`；稳定运行时密钥、MySQL URI 和其他服务端凭证可由 owner/deployer 保存在被 Git 忽略且权限为 `0600` 的 `.env.secrets.local`，或由受控 CI 注入。云函数环境是运行副本，不是唯一备份；普通开发者不需要生产密钥。`MIP_WECHAT_APP_SECRET` 仅服务端使用，不能进入小程序构建产物。

## 图片资源边界

- TabBar 回退图标、品牌 Logo、小型界面图标、固定卡片插画、名片背景和压缩后的徽章兜底图随小程序代码发布，保证应用外壳无需网络即可呈现。
- Banner、活动/机会/案例封面、头像、相册、任务附件和专属小程序码属于业务或运营内容，必须通过 `mip-media-api` 写入 `mip/` 对象存储，并在数据库保留素材引用或永久 `cloud://` 文件 ID。
- 客户端不硬编码临时 CDN 地址，也不在业务图片缺失时展示设计稿或通用二维码冒充正式内容；页面使用无图状态或小型中性占位。
- development/test 演示媒体保存在 `database/mysql/mip/demo-assets/`，只由 `pnpm seed:demo` 上传并校验；MIP staging 也可使用，但必须追加 `--confirm-staging-demo` 并保持 TEST catalog、非 live payment 和 exact EnvID 确认。这些文件不进入小程序 `src/`，production 禁止运行 demo seed。

当前云端迁移、表权限、函数部署和验收结果只在 [MIP 项目状态](mip/PROJECT_STATUS.md) 与对应的已提交证据中维护。仓库内的迁移、函数源码或历史部署记录不能代替目标环境回读。

## 部署清单

普通业务部署包含以下数据库业务函数：

| 函数 | 责任 | 客户端可直接调用 |
| --- | --- | --- |
| `mip-identity-api` | 身份、协议、手机号、用户档案、账号注销 | 是 |
| `mip-media-api` | 图片解码、内容安全、隔离存储和素材登记（含活动相册） | 是 |
| `mip-events-api` | 活动、报名、邀请、签到、心动、反馈和活动相册 | 是 |
| `mip-opportunities-api` | 机会、引荐、感兴趣、合作卡、超级案例、机会撮合和用户偏好 | 是 |
| `mip-community-api` | 公开档案安全、知识内容目录/详情和知识评论 | 是；写操作受身份补全约束 |
| `mip-commerce-api` | 会员方案、会员/活动/单内容统一订单、退款申请、订单查询 | 是 |
| `mip-admin-api` | Web 完整运营后台、小程序现场工作台、分会、活动、相册与知识内容运营、审计、导出和显式采集 | 是，受 capability 约束 |
| `mip-growth-api` | 成长等级、规则、账户和流水 | 是；内部事件也可调用 |
| `mip-game-api` | 团队、赛季、每周赛况、排行榜快照与队伍大本营 | 是；只向有效会员开放，管理动作受 `game.manage` capability 约束 |
| `mip-tasks-api` | 任务卡、全员或指定成员派发、模板、截止窗口、单次完成事实、附件复核、经验奖励和完成流水 | 是；管理动作受 `tasks.manage` capability 约束 |
| `mip-banners-api` | 公开 Banner 读取、版本化编辑、排序、启停和软删除 | 是；管理动作受 `banners.manage` capability 约束 |
| `mip-ai-api` | 语音、转写和结构化草稿 | 是；provider 回调走内部鉴权 |
| `mip-notifications-api` | 站内消息读取、已读状态和订阅授权选择 | 是，仅处理当前用户数据 |
| `mip-payment-ledger` | 支付、退款和权益事务事实 | 否，仅内部 HMAC 调用 |
| `mip-notification-worker` | 站内消息写入和可选订阅消息投递 | 否，仅内部 HMAC 调用 |
| `mip-outbox-worker` | 业务事件领取、站内消息与成长投影 | 否，仅内部 HMAC 调用 |

Web 管理端不直接调用任务、Banner、游戏或媒体函数。`mip-admin-api` 会重新读取当前管理员 session，并按操作复核平台范围的 `tasks.manage`、`banners.manage`、`game.manage` 或媒体用途对应 capability；随后使用互不复用的 `MIP_TASKS_ADMIN_HMAC_SECRET`、`MIP_BANNERS_ADMIN_HMAC_SECRET`、`MIP_GAME_ADMIN_HMAC_SECRET`、`MIP_MEDIA_ADMIN_HMAC_SECRET` 调用默认函数 `mip-tasks-api`、`mip-banners-api`、`mip-game-api`、`mip-media-api`。目标函数只接受各自版本化协议、允许的 AppID、真实管理员 userId、固定来源函数及逐 action 输入白名单。媒体桥额外校验图片用途、完整图片签名、格式、体积和尺寸，并复用既有解码、重编码、内容安全和隔离存储流程。四个内部适配器不替代原函数的领域校验，也不放宽原有微信入口。

启用真实支付时，另外部署 `mip-cloudpay`、`mip-cloudpay-callback` 和 `mip-refund-worker`。它们是下单/查单适配器、回调入口和退款提交/恢复 worker，不属于普通业务函数清单；适配器不持有 MySQL 连接串，通过 HMAC 调用 `mip-payment-ledger`。退款 worker 另用 `MIP_REFUND_WORKER_HMAC_SECRET` 接受管理 API 和受控运营命令调用。

仓库只包含直接的 `mip-*` 函数源码。部署脚本和云端验收只接受当前 MIP 清单中的函数名，不修改共享环境中的其他项目函数。

消息定时和知识采集分别使用不属于数据库业务清单的 `mip-message-scheduler` 与 `mip-knowledge-scheduler`。两个函数都不配置 MySQL URI 或 VPC，各自只维护一个固定滚动单次 timer，并通过互不复用的 HMAC 和专用 CAM 角色调用 `mip-admin-api`。CAM 的 `InvokeFunction` 不支持资源级授权时，目标限制由固定函数名、AppID allowlist、内部 HMAC 和专用角色共同完成；不得把 scheduler 绑定到共享 `TCB_QcsRole`。具体创建、canary、激活和回读步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

AI 草稿和数字分身分别使用不属于数据库业务清单的 `mip-ai-draft-provider` 与 `mip-ai-avatar-provider`。两个 Provider 都不配置 MySQL URI 或 VPC，客户端调用保持关闭，只从已部署 `mip-ai-api` 继承 AppID allowlist 和各自专用 HMAC；数字分身 Provider 额外要求零 trigger。上游 Endpoint、allowlist、总超时和鉴权都是函数环境配置，内部 HMAC 与上游凭证必须互不复用。缺少任一配置或 readiness 未通过时 fail closed，不复制源图，也不存在 mock 成功路径。

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

调度函数例外由独立验收管理：`mip-message-scheduler` 只能存在 `mip-message-campaign-next`，`mip-knowledge-scheduler` 只能存在 `mip-knowledge-ingestion-next`；`ListTriggers` 必须完整回读且唯一项为 `$DEFAULT` timer。签名参数必须包含 namespace、函数、trigger、UTC fireAt、generation、activation generation 和用途；无计划时 timer 关闭，不创建 2099 占位。SCF cron 时区必须先用同一 trigger 的 canary 实测并回读；从 canary 打开到匹配 timer 关闭并由带 generation 的激活请求完成状态切换之前，普通 reconcile 都不能覆盖它。激活后的滚动 DISPATCH 参数持续保留本轮 canary generation，同一激活命令可以在转换后 reconcile 失败时幂等续跑。异步 timer 用户代码失败配置为重试 2 次、消息保留 3600 秒，并由部署后 API readback 验证。消息手动 runner 始终保留作为恢复通道；知识调度由同一专用控制面重新执行 canary/激活和 verify，不通过核心部署补 timer。

```bash
pnpm outbox:run -- --confirm-env=<EnvID> --limit=10
pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10
```

AI 语音 TTL 不使用定时触发器。无人访问的过期或终态草稿通过 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10` 显式分批处理；维护 action 使用 AI 内部 HMAC、AppID allowlist、五分钟时间戳和完整 body 签名，响应只返回状态与数量。

机会撮合不安装 timer。`MIP_MATCHING_INTERNAL_HMAC_SECRET` 只用于 `mip-admin-api` 调用 `mip-opportunities-api` 的后台重算，部署脚本在本地生成并向两端注入同一密钥。`MIP_MATCHING_REFERENCE_SECRET` 只用于签名请求范围内的候选引用，必须保持稳定且不得写入数据库、客户端日志或外部 provider 请求。`MIP_MATCHING_PROVIDER_FUNCTION_NAME` 可选；为空时使用本地确定性 provider。启用外部函数时，超时由 `MIP_MATCHING_PROVIDER_TIMEOUT_MS` 控制，允许范围 500–10000 毫秒，默认 3000 毫秒。外部 provider 仅收到候选引用、类型、本地分数和匿名信号键/权重；人才用户 ID、分会/城市/标签内部主键不离开服务端。

热点采集的 MySQL 事实只由 `mip-admin-api` 管理：用户显式运行接口受 `knowledge.manage` capability 约束，并在写事务内重锁当前用户、角色和 policy；自动日计划由无数据库连接的 `mip-knowledge-scheduler` 通过同域 HMAC 领取。scheduler 只维护滚动单次 timer，不使用固定频率轮询；没有有效计划时关闭 timer。`MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS` 配置精确来源域名；采集拒绝 IP literal、私网/保留 DNS 结果、DNS rebinding、凭证和重定向，采用 10 秒超时、解压后流式 2 MB 上限和 50 条条目上限。`MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS` 配置服务端发布与小程序 web-view 共用的精确业务域名，必须与微信公众平台一致。两项白名单缺失时部署停止。采集内容进入审核而不自动发布，全文分块内容安全检查全部通过后才能发布。`MIP_CATALOG_STAGE=TEST|LIVE` 控制读取的知识商品目录；`MIP_KNOWLEDGE_TEST_PRICE_CENTS` 只提供 TEST 商品的可替换默认价格，正式价格仍由 LIVE 商品配置决定。

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

## 管控面部署路径

API Key 的临时 STS 无法执行所需 SCF action 时，在维护者明确授权后使用 Device Flow。不要给 `TCB_QcsRole` 添加 `scf:CreateFunction`，也不要在没有原始 VPC 错误时预授 `vpc:*`。需要重新部署时，从脚本覆盖代码、配置与权限，不在控制台手工补环境变量：

```bash
pnpm cloud:auth:device -- --allow-device-auth
pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
CLOUDBASE_AUTH_MODE=local pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<exact-runtime-user>
CLOUDBASE_AUTH_MODE=local pnpm cloud:verify -- --confirm-env=<EnvID>
```

部署脚本在缺少显式网络配置时从 CloudBase 连接信息提取实际 MySQL 网络元数据，不打印或持久化其余连接载荷。执行结果必须记录到 [MIP 项目状态](mip/PROJECT_STATUS.md) 或对应证据中，不能写回本运行手册作为永久结论。

## 未来迁移

短期共享环境只允许 MIP 资源按上述边界共存。未来切换到独立 AppID 或 CloudBase 环境时，只迁移经过备份和校验的 `mip_*` 数据、`mip/` 对象及 MIP 函数配置，然后重新绑定可信 AppID；不得把旧项目表或共享环境的默认权限一起迁移。

更多数据库和 MCP 说明见 [DATABASE.md](DATABASE.md) 与 [MCP.md](MCP.md)。
