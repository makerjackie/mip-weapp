# Customization

集中修改这些文件，不要全仓库搜索品牌字符串：

| 内容 | 入口 |
| --- | --- |
| 产品名、口号、Logo、协议入口 | `src/config/brand.ts` |
| 客服电话、视频号、首页 Banner、默认封面 | `src/config/mip-operations.ts` |
| 主色等 token | `src/app.css` `@theme` 与 `brand.colors` |
| CloudBase / 支付模式 | `.env.local` + `src/config/runtime.ts` |
| 会员方案 | 服务端 `mip_membership_plans`，不要写死在客户端 |

`mip-operations.ts` 中的运营内容是可替换占位配置，`replaceBeforeProduction` 在正式验收前保持为 `true`。未配置客服电话、视频号或 Banner 时，对应入口不展示；活动和超级案例会使用本地默认封面，不会写入服务端业务事实。

```bash
pnpm project:init --name "新产品" --namespace mip --dry-run
pnpm project:init --name "新产品"
```

脚本可重复执行。密钥不会写入 Git 跟踪文件。未知用户改动会与现有 `.env.local` 合并，而不是整个覆盖。
