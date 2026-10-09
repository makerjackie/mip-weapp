你在 ~/project/mip-weapp/.worktrees/fix-opportunity-audit 这个 git worktree 里工作，分支 fix/opportunity-audit-g1-g3-g4-f1（基于 origin/main）。这是一台 mac mini，微信开发者工具已装在 /Applications/wechatwebdevtools.app。

请严格按以下顺序工作：
1. 先读仓库根目录 AGENTS.md（边界规则 + 完成门禁，必须遵守）。
2. 再读 docs/mip/audit-fix-g1-g3-g4-f1/TASK.md，里面是本次要修的 4 个问题（G1/G3/G4/F1）的完整规格、代码定位、实现要求与验收清单。设计参照图在 docs/mip/audit-fix-g1-g3-g4-f1/design-refs/（G1=14-想跟TA合作页，G3=15-对TA感兴趣页，G4=18-玩家档案-相关机会），动手前先看图。
3. 按 TASK.md 逐项实现；优先修 F1（最小改动），再 G1、G3、G4。每个问题独立 commit（风格：fix(opportunities): G1 ... / fix(profile): F1 ...）。
4. 每个问题完成后跑相关焦点测试；全部完成后必须 `pnpm verify` 全绿。不要合并 main、不要 push、不要提交 .tmp/。
5. G3 若改了云函数，在报告里注明需部署 mip-opportunities-api（部署由维护者做，你不要部署）。
6. 全部完成后把总结写到 docs/mip/audit-fix-g1-g3-g4-f1/REPORT.md（本地写，不提交）：每个问题的改动文件清单、关键决策、verify 结果、全量回归核查清单（F1 的 pill-button 用点）、遗留风险。

注意：worktree 的 node_modules 已预装好；若缺依赖再 `pnpm install --frozen-lockfile`。
