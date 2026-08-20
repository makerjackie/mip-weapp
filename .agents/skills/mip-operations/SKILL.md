---
name: mip-operations
description: Use for owner bootstrap, demo seed, CloudBase deploy, MySQL schema, or operator-console work in mip-weapp.
---

# Membership operations

## Trigger

部署云函数、建库、seed、owner 授权、运营后台、退款、名册导出。

## Scope

`scripts/deploy-functions.mjs`、`scripts/apply-mysql-schema.mjs`、`scripts/seed-demo.mjs`、`scripts/bootstrap-owner.mjs`、`src/packages/admin`、`docs/OPERATIONS.md`。

## Read first

1. [docs/OPERATIONS.md](../../../docs/OPERATIONS.md)
2. [docs/DEPLOYMENT.md](../../../docs/DEPLOYMENT.md)
3. [docs/CLOUDBASE.md](../../../docs/CLOUDBASE.md)

## Steps

1. 先 `pnpm cloud:status`。未授权才运行一次 `pnpm cloud:auth`。
2. 部署必须带 `--confirm-env=`。
3. seed 只能打到 development/test，且 `is_demo=1`。
4. owner bootstrap 拒绝 demo 身份，不打印 OpenID。
5. 运营端变更走 admin API 与 RBAC，不要给客户端加管理 action。

## Scripts

`pnpm cloud:deploy` · `pnpm database:setup` · `pnpm seed:demo` · `pnpm admin:bootstrap` · `pnpm cloud:verify`

## Safety

确认目标 EnvID。不要对生产跑 demo seed。

## Forbidden

自动授权、把环境 ID 写入验收产物、跳过确认参数。

## Verify

`pnpm cloud:verify -- --confirm-env=<EnvID>`（需要真实云环境）

## Done

脚本退出码为 0；产物不含环境或身份值。

## Docs

[OPERATIONS.md](../../../docs/OPERATIONS.md) · [DEPLOYMENT.md](../../../docs/DEPLOYMENT.md)
