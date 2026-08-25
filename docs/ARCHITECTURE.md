# Architecture

本仓库是一个原生微信小程序和一组 MIP CloudBase 服务，不是 Monorepo。当前工程声明 95 条路由，运行时由 16 个核心 `mip-*` 函数组成，支付启用时再部署 `mip-cloudpay`、`mip-cloudpay-callback` 与 `mip-refund-worker`。用户消息 API、任务 API、Banner API、游戏化 API 与内部投递 worker 使用独立函数和调用权限。完整领域边界见 [mip/ARCHITECTURE.md](mip/ARCHITECTURE.md)，统一业务语言见 [../CONTEXT.md](../CONTEXT.md)。

```text
页面 (src/pages, src/packages)
  → 领域模块 (src/modules)
    → 平台 adapter (src/platform)
      → mip-* 云函数
        → mip_* MySQL / mip/ 对象存储
```

## 关键边界

- 页面只提交意图，不计算玩家/嘉宾、会员、金额、库存、报名、签到、成长、比赛分数、排行或权限事实。
- CloudBase 初始化只发生在 `src/modules/platform/cloudbase.ts`。
- `wx.requestPayment` 只通过支付 adapter 调用，权益由 payment ledger 确认。
- 小程序管理分包和未来独立后台共用服务端 DTO、capability 和审计合同。
- 新 MIP 数据只写 `mip_*` 表；`mip_orders` 统一承载会员和付费活动订单；历史 `member_*` 等表在迁移期间保持只读。
- 云函数部署名只使用 `mip-*`，对象存储只使用 `mip/` 前缀。
- 构建通过 `scripts/build.mjs` 在临时目录编译后同步 `dist/`。

`src/modules/membership` 是仍被部分页面使用的 MIP 兼容适配层，只指向隔离的 MIP 身份、活动和消息接口。仓库不再保留旧 `membership-*` 云函数、`member_*` 迁移或旧管理模块；静态门禁阻止当前代码回读共享旧表。

数据库隔离见 [adr/0001-shared-cloudbase-isolation.md](adr/0001-shared-cloudbase-isolation.md)，支付名额决策见 [adr/0002-paid-event-registration.md](adr/0002-paid-event-registration.md)。
