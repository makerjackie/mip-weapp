# Quality gates

`pnpm verify` 顺序：

1. `.nvmrc` 与 `packageManager` 声明的精确 Node/pnpm 工具链检查
2. 架构残留检查
3. 安全检查
4. MCP doctor
5. typecheck / lint / stylelint
6. 单元测试
7. 源码契约
8. 构建、分包预算与全部 `usingComponents` 产物目标契约
9. 云函数与 AI Provider 源码、精确直接依赖、实际解析版本和测试
10. 文档链接

`pnpm verify` 不等于运行时验收。UI 变更还需要开发者工具。

`pnpm admin:web:verify` 顺序执行 Web 源码与 Node 测试文件类型检查、ESLint、Vitest、Testing Library、生产构建与响应式源码合同；它不得读取微信开发者工具产物或小程序页面代码。

`pnpm verify:all` 顺序执行 `pnpm verify` 与 `pnpm admin:web:verify`，用于确认两个构建目标没有互相污染。Web 视觉变更还需要 1280×720、1440×900 与 390×844 浏览器运行时截图；支付、手机号与生产 CloudBase 事实仍保留真机或生产验收边界。

CI 另用 Cloud Function 声明的 Node 20.19.0 运行完整服务端验证，防止只在根工程 Node 22 通过。`pnpm release:verify` 使用 `verify:all`，但生产依赖、CloudBase 权限、真机支付与现网数据仍需各自环境验收。
