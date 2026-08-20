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
