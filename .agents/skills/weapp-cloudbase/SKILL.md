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
2. 管理授权优先用环境级 `CLOUDBASE_API_KEY`（不要用前端 publish_key）。写进项目根目录 `.env.local`。
3. 先 `pnpm cloud:status`。配好密钥后应为 READY，不必扫码。`pnpm cloud:auth` 有密钥时只加载密钥，不会开设备码。
4. 部署使用本仓库脚本，不要手拼 MCP。
5. 业务数据走 MySQL，不要回退 `cloud.database()`。

## Scripts

`pnpm cloud:status` · `pnpm cloud:deploy` · `pnpm verify:server`

## Safety

编辑器 MCP 不要启动 CloudBase。连接串只进函数配置。密钥不提交。

不要给会访问 MySQL 的云函数挂定时触发器。哪怕 outbox 是空的，定时任务也会连库，阻止 Serverless MySQL 自动暂停，按 CCU 消耗大量资源点。`cloud:deploy` 必须删除而不是创建 `membership-notification-every-5m`。

## Forbidden

在客户端写环境 ID、把数据库凭证打进小程序包、deploy 自动 `start_auth`、用前端 publish_key 冒充管理密钥、在共享/个人云环境安装高频 MySQL 定时 worker。

## Verify

`pnpm mcp:doctor` 与 `pnpm verify:server`

## Done

缺环境时失败可见；有 API Key 时 MCP 为 READY；有环境时函数可部署。

## Docs

[CLOUDBASE.md](../../../docs/CLOUDBASE.md) · [MCP.md](../../../docs/MCP.md)
