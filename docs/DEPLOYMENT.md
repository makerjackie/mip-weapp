# Deployment

## 当前共享环境进度（2026-08-25）

- 38 个锁定的 `mip_*` 迁移已成功应用，迁移版本、表清单和数据库隔离检查通过；变更前稳定备份保存在 `~/Backups/mip-weapp/2026-08-24T112700-446Z/`，本轮未重复创建备份。
- 环境专属 runtime 账号已收敛为 105 张 MIP 业务表的精确表级权限，二次运行结果为 `already current`；没有 schema/global 权限，也没有改动其他账号。
- CloudBase MCP 已固定为 `2.32.0`；资源主账号 Device Flow 已完成 SCF 管控面部署，环境 API Key 继续用于已验证的环境和 MySQL 操作。
- 16 个核心 `mip-*` 函数均为 Active/Available，使用 Nodejs20.19、目标 VPC/子网、完整运行时环境变量和仓库代码，并通过真实 MySQL 健康检查。
- 最终工作区代码已重新部署；独立 `cloud:verify` 已验证 schema、105 张表的精确 runtime 权限、函数配置、客户端调用规则、内部受保护函数及禁止高频 timer。正式核心云运行时不再是 `external-wait`。

首次 API Key 部署曾在 `scf:CreateFunction` 被拒绝；同一请求改用资源主账号 Device Flow 后成功，且没有出现独立 VPC、子网或 `TCB_QcsRole` 错误。不要把主账号长期密钥写入项目，也不要把真实 AppID、EnvID、VPC、子网、UIN、runtime 用户或 secret 写入文档。

从临时 AppID 切换到正式 MIP AppID 时，先准备空的新 CloudBase/MySQL 环境，再执行 [AppID 身份迁移](IDENTITY_MIGRATION.md) 中的备份、应用范围复制和身份衔接流程。当前 schema 不支持在同一个数据库中保留旧 AppID 数据并复制同主键的新 AppID 副本。正常开发与部署保持 `MIP_UNION_ID_REBIND_ENABLED=false`。

1. 在 `.env.local` 配置 AppID、CloudBase EnvID、允许的 AppID、MIP runtime 配置和明确的 `MIP_DEPLOYMENT_STAGE=development|test|staging|production`。知识采集还必须配置 `MIP_KNOWLEDGE_SOURCE_ALLOWED_HOSTS`，外部内容配置 `MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS`；二者均为逗号分隔的精确 DNS hostname，不接受通配符/IP，web-view 列表必须与微信公众平台业务域名一致。
2. 首次部署运行 `pnpm secrets:init -- --confirm-env=<EnvID>`，并把 `.env.local` 纳入私密凭证备份。命令先校验已部署函数，不打印密钥，也不会修改云资源。
3. 对新环境或新增迁移先做仓库外逻辑备份，预览 `mip_` 迁移范围：`pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run`。当前共享环境的 38 个锁定迁移已经完成；只有后续新增迁移才重新进入备份、dry-run 和应用流程。
4. 只在预览显示存在新迁移时应用：`pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --backup-manifest=/absolute/path/to/manifest.json`。
5. 运行 `pnpm project:init` 生成环境专属 runtime 用户，再执行 `pnpm database:grants -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>` 收敛并回读验证精确表级权限。发现 schema/global 权限、缺表授权或账号归属不一致时停止部署。
6. 仅在 development/test 环境需要占位目录时执行 `pnpm seed:demo -- --confirm-env=<EnvID> --confirm-demo`；生产环境不得运行 demo seed。
7. API Key 的临时 STS 无法执行所需 SCF action 时，经维护者明确授权运行 `pnpm cloud:auth:device -- --allow-device-auth`，再使用 `CLOUDBASE_AUTH_MODE=local pnpm cloud:deploy -- --confirm-env=<EnvID> --confirm-runtime-user=<.env.local 中的 MIP_DB_RUNTIME_USER>` 部署 16 个核心 `mip-*` 函数。不要在控制台手工补配置。部署脚本会从真实 MySQL 连接详情解析目标 VPC/子网，严格比较运行时、handler、超时、VPC 和完整环境变量；配置完全一致时只更新代码，配置漂移时才请求配置更新。production 仍需 `--confirm-production`。函数安全规则读取或解析失败时部署会停止，且更新前后的全部非目标条目必须保持不变。脚本会复核所有核心函数都没有 timer，只自动删除三个明确的历史 timer 名称；遇到其他 timer 保留现场并停止。支付模式为 `disabled` 时，已存在的支付函数不会被删除，但其客户端调用会被禁止。
8. 消息和知识采集自动定时分别使用独立函数、trigger、HMAC 和专用角色，不加入数据库核心清单。先在 `.env.local` 配置 `MIP_SCF_REGION`、待 canary 验证的 `MIP_SCF_TIMER_UTC_OFFSET_MINUTES`、两个 scheduler 的函数名/trigger/角色名和资源所有者 UIN，再运行 `secrets:init` 与核心部署，把两个同域 HMAC 和函数名注入 `mip-admin-api`。两个角色不得相同。先运行各 role 命令的 dry-run，核对仅有 `UpdateTrigger`、`ListTriggers`、`InvokeFunction` 后再追加 `--apply`。CAM 的 `InvokeFunction` 当前是操作级权限，resource 必须为 `*`；不得误写成函数 ARN，也不得把权限加到共享 `TCB_QcsRole`。新建 scheduler 禁止使用 CloudBase `manageFunctions/createFunction`，部署脚本必须先完成专用角色、环境变量、既有函数身份和 trigger inventory 预检，再以 raw SCF `CreateFunction` 的首个云端写入直接传精确角色名；Update 与 GetFunction 同样使用和回读精确角色名，不接受 ARN、子串或共享角色。

```bash
pnpm cloud:message-scheduler:role -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-message-scheduler \
  --confirm-role=<dedicated-role> \
  --confirm-resource-uin=<resource-owner-uin>

pnpm cloud:message-scheduler:deploy -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-message-scheduler \
  --confirm-trigger=mip-message-campaign-next \
  --confirm-role=<dedicated-role> \
  --confirm-timer-offset-minutes=<candidate-offset> \
  --start-canary

pnpm cloud:knowledge-scheduler:role -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-knowledge-scheduler \
  --confirm-role=<dedicated-knowledge-role> \
  --confirm-resource-uin=<resource-owner-uin>

pnpm cloud:knowledge-scheduler:deploy -- \
  --confirm-env=<EnvID> \
  --confirm-function=mip-knowledge-scheduler \
  --confirm-trigger=mip-knowledge-ingestion-next \
  --confirm-role=<dedicated-knowledge-role> \
  --confirm-timer-offset-minutes=<candidate-offset> \
  --start-canary
```

canary 到时后使用对应的 `cloud:*scheduler:verify` 命令和 `--expect-canary=<generation>` 证明固定 trigger 已被函数关闭，再以同一组确认参数和 `--activate-after-canary=<generation>` 发起独立 HMAC 激活；scheduler 会再次核对 matching CLOSED canary，先把固定 trigger 切换为 ACTIVE，再允许真实计划 reconcile。转换后的 DISPATCH 签名参数保留该 canary generation；如果转换成功但后续 admin/SCF reconcile 失败，原命令可直接用同一 generation 重跑并续完 reconcile。消息 canary 与激活前还会回读 admin 的 outbox 连接；知识 canary 只要求自己的同域函数名、AppID allowlist 和专用 HMAC，不依赖 outbox。canary 打开或关闭但尚未激活时，普通 reconcile 都不能覆盖它。偏移不正确时调整候选偏移并重新 canary，不得直接跳过。production 命令同样追加 `--confirm-production`。两个调度函数都必须回读为无 VPC/无 MySQL 环境变量、客户端不可调用、128 MB 内存、128 MB 预留并发、timer 用户错误重试 2 次和消息保留 3600 秒；`ListTriggers` 的 `TotalCount` 必须与数组一致且唯一项是对应固定 `$DEFAULT` timer。没有计划时关闭固定 trigger，不使用永久占位或高频 timer。

raw `CreateFunction` 成功后、固定 trigger 创建前仍存在进程中断窗口。下次部署看到“函数存在但 0 trigger”时默认拒绝；只有函数为 Active/Available、精确绑定专用角色、无 VPC、runtime/handler/内存/超时/全部环境变量都匹配，并且对应的 `MIP_MESSAGE_SCHEDULER_CODE_MARKER` 或 `MIP_KNOWLEDGE_SCHEDULER_CODE_MARKER` 与当前待部署源码指纹一致时，才允许在原 `--start-canary` 命令追加精确的 `--confirm-resume-missing-trigger=<scheduler-function>` 继续。源码变化、marker 缺失、陌生函数、部分 `ListTriggers` 响应或任何非零异常库存都不能走该恢复路径。
9. 配置支付后，执行 `pnpm cloud:deploy-payment -- --confirm-env=<EnvID> --confirm-function=mip-cloudpay --confirm-callback=mip-cloudpay-callback --confirm-refund=mip-refund-worker` 部署三个支付函数；`MIP_PAYMENT_MODE=live` 时必须追加 `--confirm-live`，测试/生产目录和商户配置必须隔离。
10. 在本机 `.env.local` 写入空仓库示例对应的 `MIP_OWNER_PHONE`，确认该号码已通过当前 AppID 的微信真机流程绑定，并完成昵称、主分会和当前全部协议；再执行 `pnpm admin:bootstrap -- --confirm-env=<EnvID> --confirm-owner` 配置首个 owner。脚本只以身份服务的 AppID 范围哈希定位唯一 ACTIVE 非 demo 用户，不输出号码、哈希或用户 ID；可追加 `--user-id=<用户 UUID>` 做严格一致性确认。
11. 部署后或发现 outbox 积压时，运行 `pnpm outbox:run -- --confirm-env=<EnvID> --limit=10` 做一次受控处理；退款停留在活动状态时，运行 `pnpm refunds:run -- --confirm-env=<EnvID> --confirm-refund=mip-refund-worker --limit=10`。两个命令都读取已部署函数配置完成 HMAC 调用，不打印密钥。
12. 微信后台配置服务器域名、与 `MIP_KNOWLEDGE_WEBVIEW_ALLOWED_HOSTS` 完全一致的业务域名、用户隐私协议，完成上传与提审。

核心函数部署后必须使用同一授权模式单独执行 `CLOUDBASE_AUTH_MODE=local pnpm cloud:verify -- --confirm-env=<EnvID>`。空函数壳、控制台可见、单个函数创建成功或 API Key 状态为 `READY` 都不能代替该验收；只有所有核心函数配置回读、MySQL 健康、最小权限调用规则和禁止 timer 检查通过，云端运行时才算完成。

`MIP_AGREEMENTS_JSON` 留空时，受保护服务共同使用仓库默认协议版本；替换正式协议时，必须一次性提供同一份非空 JSON 数组。部署脚本会把它同时注入 `mip-identity-api`、`mip-events-api`、`mip-opportunities-api`、`mip-community-api`、`mip-commerce-api`、`mip-admin-api`、`mip-game-api`、`mip-tasks-api` 和 `mip-banners-api`，避免客户端展示版本与服务端门禁版本漂移。

迁移若报告 `uncertain DDL step`，表示数据库可能已执行该语句，但 journal 未能确认。停止后续部署，保留日志和备份，先恢复变更前备份或人工核对结构；不得直接重跑迁移，也不得手工把 `RUNNING` 改成 `APPLIED`。

管理导出使用 CloudBase 私有存储和短期下载地址。默认 `MIP_EXPORT_MAX_ROWS=5000`、`MIP_EXPORT_MAX_BYTES=8388608`；不要将导出对象设为公开读取。

媒体孤儿清理使用 `pnpm media:cleanup -- --confirm-env=<EnvID> --confirm-media=mip-media-api --minimum-age-hours=24 --limit=10`。该命令读取已部署函数的维护密钥完成受控调用，不打印密钥；默认不创建定时器，也不得用高频触发器代替人工批处理。

AI 私有语音 TTL 清理使用 `pnpm ai:cleanup -- --confirm-env=<EnvID> --confirm-ai=mip-ai-api --limit=10`。该命令从已部署 AI 函数读取内部 HMAC，在确认的环境和 AppID 范围内分批处理，只输出状态和数量；不打印 AppID、用户、草稿、文件或密钥，不创建定时器。

发布前：`pnpm verify`、`pnpm docs:check`、`git diff --check`。真实支付、手机号、订阅消息、扫码签到和 AI 录音仍需真机/生产证据，见 [RUNTIME_ACCEPTANCE.md](RUNTIME_ACCEPTANCE.md)。未来迁移到独立 AppID/环境时只迁移经过校验的 `mip_*` 与 `mip/` 资源。
