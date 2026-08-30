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
