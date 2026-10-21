---
name: mip-membership-domain
description: Use for membership, profile, event, order, community safety, or admin domain changes in mip-weapp.
---

# Membership domain

## Trigger

会员、资料、活动、报名、订单、关注/屏蔽/举报、公告、运营后台。

## Scope

`src/modules/mip-*`、`src/packages/**`、`cloudfunctions/mip-*`、`database/mysql/mip`。

## Read first

1. [docs/MEMBERSHIP_DOMAIN.md](../../../docs/MEMBERSHIP_DOMAIN.md)
2. [docs/DATABASE.md](../../../docs/DATABASE.md)
3. [docs/data-contract.md](../../../docs/data-contract.md)
4. [AGENTS.md](../../../AGENTS.md)

## Steps

1. 客户端只提交意图；资格、库存、价格、手机号、OpenID 由服务端决定。
2. 所有查询带服务端 `app_id`。
3. 活动写操作带 `expectedVersion`；冲突必须可恢复。
4. 公开列表不得返回手机号、OpenID、完整票码。
5. 改表必须追加 `database/mysql/mip` 迁移并更新 `migrations.lock.json`。
6. 产品称呼与权限分开：`ANONYMOUS/NORMAL/GUEST/PLAYER` 不扩展会员权限的 `GUEST/PLAYER`；本场活动的嘉宾列表包含报名成功但未签到的普通用户。以需求基线和澄清记录为准。
7. 用户资料五项必填不得替换后台运营授权。`mip-tasks-api`、`mip-banners-api`、`mip-game-api` 的 `assertAdminReady` 是运营门禁；改动后执行 `tests/mip-operator-readiness.test.ts` 和真实后台完整接口回归，不能只验证用户端。
8. MySQL 测试样本必须显式写 UTC 时间并补齐用户会籍链等领域不变量；MCP 会话的默认时区不能代表云函数事务时区。合成签到/权益只能记为测试样本，不当作微信扫码或真实支付证据。

## Scripts

`pnpm test` · `pnpm verify:source` · `pnpm verify:server`

## Safety

不要在客户端重建权益。不要把 demo 身份提升为 owner。

## Forbidden

伪造领域完成状态、跳过迁移、把运营名单字段展示到用户端。

## Verify

`pnpm verify`。涉及签到、手机号、支付时标记真机待验收。

## Done

领域测试与源码契约通过；用户端和运营端路由仍能构建。

## Docs

[MEMBERSHIP_DOMAIN.md](../../../docs/MEMBERSHIP_DOMAIN.md) · [OPERATIONS.md](../../../docs/OPERATIONS.md)
