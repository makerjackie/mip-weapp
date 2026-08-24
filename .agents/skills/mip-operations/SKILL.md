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
3. seed 只能打到 development/test，且 `is_demo=1`。
4. owner bootstrap 拒绝 demo 身份，不打印 OpenID。
5. 运营端变更走 admin API 与 RBAC，不要给客户端加管理 action。

## Scripts

`pnpm cloud:deploy` · `pnpm database:setup` · `pnpm seed:demo` · `pnpm admin:bootstrap` · `pnpm cloud:verify`

## Safety

确认目标 EnvID 和 deployment stage。历史 legacy member schema 不属于 MIP 操作路径。不要对生产跑 demo seed。不要给通知 worker 安装 5 分钟定时器：它会阻止 Serverless MySQL 暂停，按 CCU 消耗额度。

## Forbidden

自动授权、把环境 ID 写入验收产物、跳过确认参数、把高频 MySQL 定时触发器部署到共享个人环境。

## Verify

`pnpm cloud:verify -- --confirm-env=<EnvID>`（需要真实云环境）

## Done

脚本退出码为 0；产物不含环境或身份值。

## Docs

[OPERATIONS.md](../../../docs/OPERATIONS.md) · [DEPLOYMENT.md](../../../docs/DEPLOYMENT.md)
