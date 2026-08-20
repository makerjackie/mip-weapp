---
name: weapp-development
description: Use for WeChat Mini Program page, config, script, Tailwind, TDesign, or quality-gate work in mip-weapp.
---

# WeApp development

## Trigger

改页面、app.json、weapp-vite、脚本、门禁、WXML/TS。

## Scope

`src/pages`、`src/packages`、`src/components`、`src/platform`、`src/shared`、`src/config`、`scripts`。

## Read first

1. [AGENTS.md](../../../AGENTS.md)
2. [docs/ARCHITECTURE.md](../../../docs/ARCHITECTURE.md)
3. [docs/QUALITY_GATES.md](../../../docs/QUALITY_GATES.md)

## Steps

1. 页面只调用 `src/modules/*` 与 `src/platform/*`，不要直接 `wx.cloud.init` 或 `wx.requestPayment`。
2. Tailwind class 写完整静态字面量；全宽控件加 `box-border max-w-full`。
3. 同步 `src/app.json`、`config/project.json`、`config/runtime-pages.json`。
4. 品牌文案改 `src/config/brand.ts`，不要全仓库搜字符串。

## Scripts

`pnpm typecheck` · `pnpm lint` · `pnpm verify:source`

## Safety

不要提交 `.env.local` 或真实 AppID。

## Forbidden

React/Vue、workspace 协议、绝对用户路径、把密钥打进日志。

## Verify

`pnpm verify`

## Done

页面可编译，门禁通过，路由与文件一致。

## Docs

[GETTING_STARTED.md](../../../docs/GETTING_STARTED.md) · [TROUBLESHOOTING.md](../../../docs/TROUBLESHOOTING.md)
