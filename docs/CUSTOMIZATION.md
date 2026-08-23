# Customization

集中修改这些文件，不要全仓库搜索品牌字符串：

| 内容 | 入口 |
| --- | --- |
| 产品名、口号、Logo、协议入口 | `src/config/brand.ts` |
| 主色等 token | `src/app.css` `@theme` 与 `brand.colors` |
| 功能开关 | `src/config/features.ts` |
| CloudBase / 支付模式 | `.env.local` + `src/config/runtime.ts` |
| 会员方案 | 服务端 `member_plans`，不要写死在客户端 |

```bash
pnpm project:init --name "新产品" --namespace mip --dry-run
pnpm project:init --name "新产品"
```

脚本可重复执行。密钥不会写入 Git 跟踪文件。未知用户改动会与现有 `.env.local` 合并，而不是整个覆盖。
