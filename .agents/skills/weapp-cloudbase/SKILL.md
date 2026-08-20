---
name: weapp-cloudbase
description: Use for CloudBase env, membership cloud functions, MySQL, or MCP auth in mip-weapp.
---

# WeApp CloudBase

## Trigger

云环境、云函数、MySQL、存储、MCP 授权。

## Scope

`src/platform`、`src/modules/platform/cloudbase.ts`、`cloudfunctions`、`database`、`scripts/cloudbase-*.mjs`、`config/mcporter.json`。

## Read first

1. [docs/CLOUDBASE.md](../../../docs/CLOUDBASE.md)
2. [docs/MCP.md](../../../docs/MCP.md)
3. [docs/DATABASE.md](../../../docs/DATABASE.md)

## Steps

1. 没有 EnvID 时保持 disabled，UI 显示会员服务尚未配置。
2. 先 `pnpm cloud:doctor`。只有 `pnpm cloud:auth` 可以发起授权。
3. 部署使用案例脚本，不要手拼 MCP。
4. 业务数据走 MySQL，不要回退 `cloud.database()`。

## Scripts

`pnpm cloud:doctor` · `pnpm cloud:deploy` · `pnpm verify:server`

## Safety

编辑器 MCP 不要启动 CloudBase。连接串只进函数配置。

## Forbidden

在客户端写环境 ID、把数据库凭证打进小程序包、deploy 自动 `start_auth`。

## Verify

`pnpm mcp:doctor` 与 `pnpm verify:server`

## Done

缺环境时失败可见；有环境时函数可部署。

## Docs

[CLOUDBASE.md](../../../docs/CLOUDBASE.md) · [MCP.md](../../../docs/MCP.md)
