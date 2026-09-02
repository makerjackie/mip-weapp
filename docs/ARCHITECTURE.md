# Architecture

本仓库由原生微信小程序、`admin-web/` React 管理后台和一组 MIP CloudBase 服务组成。根目录仍是小程序主工程；Web 独立构建与部署，不进入小程序产物。数据库业务函数、无数据库连接的 scheduler/provider 和支付适配器各自使用独立部署清单与调用权限。完整领域边界见 [mip/ARCHITECTURE.md](mip/ARCHITECTURE.md)，当前部署范围见 [mip/PROJECT_STATUS.md](mip/PROJECT_STATUS.md)，Web 边界见 [admin-web/ARCHITECTURE.md](../admin-web/ARCHITECTURE.md)，统一业务语言见 [CONTEXT.md](../CONTEXT.md)。

```text
页面 (src/pages, src/packages)
  → 领域模块 (src/modules)
    → 平台 adapter (src/platform)
      → mip-* 云函数
        → mip_* MySQL / mip/ 对象存储

Web 页面 (admin-web/src/pages)
  → React adapter (features, shared/ui)
    → 既有 modules/services
      → 同源 Cloudflare BFF
        → AdminRequest v1 → mip-admin-api
          → mip_* MySQL / mip/ 对象存储
```

## 关键边界

- 页面只提交意图，不计算玩家/嘉宾、会员、金额、库存、报名、签到、成长、比赛分数、排行或权限事实。
- CloudBase 初始化只发生在 `src/platform/cloudbase/client.ts`。
- `wx.requestPayment` 只通过支付 adapter 调用，权益由 payment ledger 确认。
- 小程序现场工作台和独立 Web 管理后台共用由 `mip-admin-api` operation registry 生成的 action、Web 字段、幂等、capability 和审计合同；Web 是唯一完整后台，小程序只保留现场白名单路由。
- 新 MIP 数据只写 `mip_*` 表；`mip_orders` 统一承载会员、付费活动和单内容订单；历史 `member_*` 等表在迁移期间保持只读。
- 云函数部署名只使用 `mip-*`，对象存储只使用 `mip/` 前缀。
- 定时消息由无数据库连接的独立函数维护一个滚动单次 timer；计划和执行事实仍只存在管理 API 与 `mip_*` MySQL 中。
- 构建通过 `scripts/build.mjs` 在临时目录编译后同步 `dist/`。
- `pnpm verify` 不进入 `admin-web/`；`pnpm admin:web:verify` 不进入小程序目录；`pnpm verify:all` 是联合门禁。
- `packages/admin-contracts` 是当前唯一共享 workspace package，只包含 AdminRequest v1 envelope 和服务端生成的平台中立 operation 元数据；新增 package 必须证明两端真实调用和平台中立。

旧 `src/modules/membership` 兼容适配层和未注册页面已经删除；用户端统一使用按领域拆分的 `src/modules/mip-*` 模块。仓库不再保留旧 `membership-*` 云函数、`member_*` 迁移或被 Web 取代的小程序管理页面；需要追溯时使用 Git 历史。静态门禁阻止当前代码回读共享旧表，并拒绝未在 `app.json` 声明的页面源码。

数据库隔离见 [adr/0001-shared-cloudbase-isolation.md](adr/0001-shared-cloudbase-isolation.md)，支付名额决策见 [adr/0002-paid-event-registration.md](adr/0002-paid-event-registration.md)，管理端渠道边界见 [adr/0005-web-admin-and-onsite-workbench.md](adr/0005-web-admin-and-onsite-workbench.md)。
