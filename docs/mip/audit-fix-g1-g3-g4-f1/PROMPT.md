你在 ~/project/mip-weapp/.worktrees/fix-opportunity-audit 这个 git worktree 里工作，分支 fix/opportunity-audit-g1-g3-g4-f1（基于 origin/main）。这是一台 mac mini，微信开发者工具已装在 /Applications/wechatwebdevtools.app。

请严格按以下顺序工作：
1. 先读仓库根目录 AGENTS.md（边界规则 + 完成门禁，必须遵守）。
2. 再读 docs/mip/audit-fix-g1-g3-g4-f1/TASK.md，里面是本次要修的 4 个问题（G1/G3/G4/F1）的完整规格、代码定位、实现要求与验收清单。
3. **设计稿获取（重要）**：本机已配置 Figma Bridge MCP（figma-mcp-free，bridge 127.0.0.1:3845），**优先用 MCP 工具直读 Figma 真实设计数据，不要只看 PNG 截图**：
   - 先 `get_plugin_bridge_status` 确认桥与插件在线（若插件离线，命令会入队等待；等不到再降级用 design-refs PNG，并在报告注明）。
   - 设计稿都在 Figma「机会」Page（page id `69:4976`）。用 `list_current_page_frames` 拿清单后，按 frame id 定点 `get_plugin_node`（**务必传 `outFile` 落盘到 `.tmp/figma/` 再从磁盘读，别把大 JSON 读进上下文**）：
     - G1 想跟TA合作页 = `1769:37984`
     - G3 对TA感兴趣页 = `2189:43192`
     - G4 玩家档案-相关机会 = `3359:5705`（档案页整体参照：嘉宾 `1769:38059`、玩家 `1769:38198`）
     - 竖版人才卡在 G1/G3 页内，横版人才卡列表 = `1768:37534`
   - 需要视觉比对时用 `export_plugin_node_png`（scale 2，outFile 到 `.tmp/figma/`）。只取需要的节点，不要整页拉取。
   - docs/mip/audit-fix-g1-g3-g4-f1/design-refs/ 里的 PNG 是这些 frame 的 2x 导出，仅作兜底对照。
4. 按 TASK.md 逐项实现；优先修 F1（最小改动），再 G1、G3、G4。每个问题独立 commit（风格：fix(opportunities): G1 ... / fix(profile): F1 ...）。
5. 每个问题完成后跑相关焦点测试；全部完成后必须 `pnpm verify` 全绿。不要合并 main、不要 push、不要提交 .tmp/。
6. G3 若改了云函数，在报告里注明需部署 mip-opportunities-api（部署由维护者做，你不要部署）。
7. 全部完成后把总结写到 docs/mip/audit-fix-g1-g3-g4-f1/REPORT.md（本地写，不提交）：每个问题的改动文件清单、关键决策（含从 Figma 直读到的关键样式/字段口径）、verify 结果、全量回归核查清单（F1 的 pill-button 用点）、遗留风险。

注意：worktree 的 node_modules 已预装好；若缺依赖再 `pnpm install --frozen-lockfile`。
