# AI development

1. 读根目录 [AGENTS.md](../AGENTS.md)
2. 按任务加载 `.agents/skills/*/SKILL.md`
3. 先跑确定性脚本（`project:init`、`cloud:deploy`），不要让模型手改散落配置
4. 用 `pnpm verify` 收口

Skill 路由见 AGENTS。不要把新业务写进演示目录——本仓库没有演示中心，正式能力放 `src/modules` 与对应页面。
