# Architecture

独立仓库、一个 `package.json`、一个微信小程序。平台原语已经内联到 `src/platform` 与 `src/shared`，不再存在共享 workspace 包。

```text
页面 (pages/packages)
  → 领域模块 (modules/membership, modules/admin)
    → 平台 (platform/cloudbase, payment, navigation)
      → 云函数 / MySQL
```

## 关键边界

- 客户端提交意图，服务端计算金额、库存、资格。
- CloudBase 初始化只发生在 `src/modules/platform/cloudbase.ts`。
- 活动领域纯函数在 `src/shared/activity-domain`，部署副本在 `cloudfunctions/membership-api/lib/vendor`。
- 构建通过 `scripts/build.mjs` 在临时目录编译再同步 `dist/`。

更细的表结构见 [DATABASE.md](DATABASE.md)，支付见 [WECHAT_PAY.md](WECHAT_PAY.md)。
