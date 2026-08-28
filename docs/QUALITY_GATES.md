# Quality gates

`pnpm verify` 顺序：

1. 架构残留检查
2. 安全检查
3. MCP doctor
4. typecheck / lint / stylelint
5. 单元测试
6. 源码契约
7. 构建与产物契约
8. 云函数源码与测试
9. 文档链接

`pnpm verify` 不等于运行时验收。UI 变更还需要开发者工具。

`pnpm admin:web:verify` 顺序执行 Web 类型检查、ESLint、Vitest、Testing Library、生产构建与响应式源码合同；它不得读取微信开发者工具产物或小程序页面代码。

`pnpm verify:all` 顺序执行 `pnpm verify` 与 `pnpm admin:web:verify`，用于确认两个构建目标没有互相污染。Web 视觉变更还需要 1280×720、1440×900 与 390×844 浏览器运行时截图；支付、手机号与生产 CloudBase 事实仍保留真机或生产验收边界。
