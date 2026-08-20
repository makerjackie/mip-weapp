---
name: weapp-runtime-qa
description: Use for DevTools, real-device, runtime preflight, or acceptance checks in mip-weapp.
---

# WeApp runtime QA

## Trigger

真机、开发者工具、runtime 验收、截图、服务端口。

## Scope

`scripts/runtime-preflight.mjs`、`scripts/run-runtime-verify.mjs`、`config/runtime-pages.json`。

## Read first

1. [docs/RUNTIME_ACCEPTANCE.md](../../../docs/RUNTIME_ACCEPTANCE.md)
2. [docs/TROUBLESHOOTING.md](../../../docs/TROUBLESHOOTING.md)

## Steps

1. `pnpm build`
2. 开发者工具已登录并打开服务端口。
3. `pnpm runtime:preflight`
4. 人工核对首页、活动、会员、订单和运营工作台。
5. 手机号、支付、订阅消息必须真机。

## Scripts

`pnpm build` · `pnpm runtime:preflight` · `pnpm test:runtime`

## Safety

报告里不要贴 AppID、EnvID、OpenID。

## Forbidden

用开发者工具结果宣称 live 支付已通过。

## Verify

`pnpm test:runtime`（依赖本机开发者工具）

## Done

预检通过或明确写出缺登录/缺服务端口。

## Docs

[RUNTIME_ACCEPTANCE.md](../../../docs/RUNTIME_ACCEPTANCE.md) · [QUALITY_GATES.md](../../../docs/QUALITY_GATES.md)
