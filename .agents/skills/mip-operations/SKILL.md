---
name: mip-operations
description: Use for owner bootstrap, demo seed, CloudBase deploy, MySQL schema, or operator-console work in mip-weapp.
---

# Membership operations

## Trigger

部署云函数、建库、seed、owner 授权、运营后台、退款、名册导出。

## Scope

`scripts/deploy-functions.mjs`、`scripts/apply-mip-schema.mjs`、`scripts/seed-demo.mjs`、`scripts/bootstrap-owner.mjs`、`src/packages/admin`、`docs/OPERATIONS.md`。

## Read first

1. [docs/OPERATIONS.md](../../../docs/OPERATIONS.md)
2. [docs/DEPLOYMENT.md](../../../docs/DEPLOYMENT.md)
3. [docs/CLOUDBASE.md](../../../docs/CLOUDBASE.md)

## Steps

1. 先 `pnpm cloud:status`。环境和 MySQL 管理默认使用 `.env.local` 的环境级 `CLOUDBASE_API_KEY`；`pnpm cloud:auth` 只验证 API Key。SCF 管控面被其临时 STS 拒绝时，经明确授权使用 Device Flow，并为部署、验收显式设置 `CLOUDBASE_AUTH_MODE=local`。
2. 部署必须带 `--confirm-env=`，并从 `.env.local` 读取 `MIP_DEPLOYMENT_STAGE`；production 还必须带 `--confirm-production`。
3. seed 默认只允许 development/test，且 `is_demo=1`；MIP staging 仅在 TEST catalog、非 live payment、精确 EnvID 和 `--confirm-staging-demo` 同时满足时允许，production 禁止。
4. owner bootstrap 拒绝 demo 身份，不打印 OpenID。
5. 运营端变更走 admin API 与 RBAC，不要给客户端加管理 action。
6. 建表不自动生成运营配置。测试库首次验收要核对成长等级、等级权益和实际玩家快照；缺基础配置时按已确认配置补齐并备份回读，不把空列表/健康检查当作功能通过。复制公共配置不包含用户、订单、积分流水或会员权益。

## Scripts

`pnpm cloud:deploy` · `pnpm database:setup` · `pnpm seed:demo` · `pnpm admin:bootstrap` · `pnpm cloud:verify`

## Safety

确认目标 EnvID 和 deployment stage。历史 legacy member schema 不属于 MIP 操作路径。不要对生产跑 demo seed。不要给通知 worker 安装 5 分钟定时器：它会阻止 Serverless MySQL 暂停，按 CCU 消耗额度。

生产清理保留 `mip_users` 的封禁/审计占位时，必须同时保留其 `mip_membership_chains` 行；chain 是事务并发元数据，不是会籍权益。清理后校验 users 与 chains 一对一、无缺失/孤儿。历史缺失只通过现有 `scripts/reconcile-membership-chains.mjs` 幂等补齐并回读，不能恢复订单、权益或解除封禁。

同一 AppID 的体验版切到独立测试库前，核对生产 identity 的 `MIP_DEPLOYMENT_STAGE=production`：名片码依此选择 `release`，历史 `staging` 会选择 `trial` 并跨环境。只修正已证明错误的函数配置，保存回滚及完整回读，不批量重写其他函数或迁移既有素材；历史二维码另做真机验收。

## Forbidden

自动授权、把环境 ID 写入验收产物、跳过确认参数、把高频 MySQL 定时触发器部署到共享个人环境。

## Verify

`pnpm cloud:verify -- --confirm-env=<EnvID>`（需要真实云环境）

## Done

脚本退出码为 0；产物不含环境或身份值。

## Docs

[OPERATIONS.md](../../../docs/OPERATIONS.md) · [DEPLOYMENT.md](../../../docs/DEPLOYMENT.md)
