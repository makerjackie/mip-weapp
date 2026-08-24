---
name: weapp-cloudbase
description: Use for CloudBase env, membership cloud functions, MySQL, or MCP auth in mip-weapp.
---

# WeApp CloudBase

## Trigger

云环境、云函数、MySQL、存储、MCP 授权。

## Scope

`src/platform`、`src/modules/platform/cloudbase.ts`、`cloudfunctions`、`database`、`scripts/cloudbase-*.mjs`、`config/mcporter.json`、项目根目录 `.env.local`。

## Read first

1. [docs/CLOUDBASE.md](../../../docs/CLOUDBASE.md)
2. [docs/MCP.md](../../../docs/MCP.md)
3. [docs/DATABASE.md](../../../docs/DATABASE.md)

## Steps

1. 没有 EnvID 时保持 disabled，UI 显示会员服务尚未配置。
2. 管理授权必须使用环境级 `CLOUDBASE_API_KEY`（不要用前端 publish_key），与 `CLOUDBASE_ENV_ID` 一起写进项目根目录 `.env.local`。
3. 先 `pnpm cloud:status`。`pnpm cloud:status` 与 `pnpm cloud:auth` 都只验证并加载 API Key；缺 Key 直接失败，不发起设备码。
4. 部署使用本仓库脚本，不要手拼 MCP。
5. 业务数据走 MySQL，不要回退 `cloud.database()`。

## Scripts

`pnpm cloud:status` · `pnpm cloud:deploy` · `pnpm verify:server`。维护者应急时才显式运行 `pnpm cloud:auth:device -- --allow-device-auth`。

## Safety

编辑器 MCP 不要启动 CloudBase。连接串只进函数配置。密钥不提交。

## Forbidden

在客户端写环境 ID、把数据库凭证打进小程序包、正常命令调用 `start_auth`、用前端 publish_key 冒充管理密钥。

## Verify

`pnpm mcp:doctor` 与 `pnpm verify:server`

## Done

缺 Key 或 EnvID 时失败可见；配置有效 API Key 后 MCP 为 READY；有环境时函数可部署。

## Docs

[CLOUDBASE.md](../../../docs/CLOUDBASE.md) · [MCP.md](../../../docs/MCP.md)
