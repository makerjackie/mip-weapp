# MIW-45..50 批次验收 Checklist（2026-10-07）

本批次覆盖 5 个 review 状态任务合并、部署与端到端验收：MIW-45（automator native input 视口测量修复）、MIW-46（admin 静态托管回读兼容 cloudbase-mcp 2.32.3）、MIW-48（人才档案合作卡编辑样式对齐设计稿）、MIW-49（我的-超级案例时间线修复）、MIW-50（我的机会编辑/返回流与保存校验修复）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ⚠️ 有条件通过（已归因） · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 5 个任务工作全部提交：MIW-45 `d44a9ba3`、MIW-46 沿用已有提交 `7a931038`、MIW-48 `f7713e55` + `76093de3`（fullpage 截图脚本）+ prettier 格式修正、MIW-49 `76596b50`、MIW-50 `c4b4245e` | ✅ | 各 worktree git log |
| A2 | 5 个分支按序合并 main：MIW-45/46/48/50 无冲突；MIW-49 与 MIW-48 在 `tests/mip-publication-lifecycle.test.ts` 语义冲突，按两条并存的拍板解决（合作卡详情无下架、仅长按删除；超级案例详情无管理入口，删除唯一入口=「我的」tab 长按），合并提交 `13cd3dc2` | ✅ | merge commits；`mip-publication-lifecycle.test.ts` 3 项断言与合并后源码逐条核对一致 |
| A3 | 路由契约 58→59 同步：MIW-49 新增 `packages/member/mip-cases/city-selector/index`（M18C）；app.json / runtime-pages.json / project.json 三处一致；`docs/mip/PROJECT_STATUS.md` 仓库事实更新为 59 条（5 主包 + 49 用户分包 + 5 管理分包），docs 契约校验通过 | ✅ | `verify-doc-links.mjs` passed |
| A4 | `pnpm verify` 全绿（构建 + 预算 + server contract 697 源 + docs 事实校验）；`pnpm admin:web:verify` 全绿（lint + 类型 + 27 文件 164 项 React 测试 + 构建 + 响应式合同）；根工程 vitest 256 文件 1541 项全过 | ✅ | 完整退出码 0（corepack 在 node 22.22.3 下的 dynamic import 崩溃为环境问题，改用 corepack 缓存 pnpm.cjs 直执行 + PATH shim 解决，不影响仓库） |
| A5 | `git diff --check` 干净；main 推送 origin（`5b4ea013..c4042bc2`）。推送当晚 Clash Verge 隧道对 github.com 间歇失效，经 mihomo 控制 API 将 Github/默认节点组切至可用 HK 节点并以 `socks5h://`（远端 DNS）绕过本地 fake-ip 解析后成功；仓库代理配置未改动 | ✅ | push 输出；代理切换为会话级操作 |
| A6 | Notma 任务状态：MIW-45/46/48/49/50 全部置 done（`task move done` ×5，ok:true） | ✅ | notma-cli 返回 |

## B. 云函数部署（CLOUDBASE_AUTH_MODE=local）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 本批零数据库迁移、零 schema 变更（5b4ea013..main 不触 `database/`） | ✅ | `git diff --name-only 5b4ea013..main -- database/` 为空 |
| B2 | `mip-opportunities-api`（MIW-48 cooperation 域 + MIW-50 opportunities 域）部署 + 验证：配置已一致、代码回读一致、MySQL 健康检查 `persistence=cloudbase-mysql` 通过 | ✅ | `[mip-cloud-deploy] verified mip-opportunities-api` |
| B3 | `mip-admin-api`（MIW-50 opportunities 域三端对齐：targetSummary 500 / description 6000）部署 + 验证：同上 | ✅ | `[mip-cloud-deploy] verified mip-admin-api` |
| B4 | 部署产物不含环境 ID、身份值或密钥 | ✅ | deploy 输出 `no AppID, environment ID, database URI, or secret was persisted` |
| B5 | 管理 API Key 通道 SCF Invoke 被 CAM 拒绝（与 2026-09-26/09-27 证据同现象）；本批在既有 Device Flow 登录态（当日 22:54 授权）+ `CLOUDBASE_AUTH_MODE=local` 下部署，**重启 mcporter 守护进程刷新凭证缓存后 Invoke 恢复**，健康检查全部通过（较上批 B5 的 ⏳ 前进一格） | ✅ | daemon restart 后 `invokeFunction` 返回 InvokeResult:0；无需重走 Device Flow |

## C. 管理后台（admin-web）部署与验收

本批 `admin-web/` 变更仅 MIW-50 `content-mutation-forms.ts`（targetSummary 300→500、description 5000→6000，与会员端服务端口径对齐）。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实构建（`admin:web:verify` 内 vite build）+ BFF 打包（`build:cloudbase`）成功，新入口 `index-DZvhtVHV.js` | ✅ | 构建输出；产物内嵌入口核对一致 |
| C2 | CloudBase 静态托管隔离前缀 `mip-admin-console/` 上传并逐文件回读一致；**downloadDirectory 回读已走新版 MCP `result.Contents` 嵌套结构（MIW-46 修复上线生效）** | ✅ | `filesVerified:14, listingSource:"result-contents", listingFiles:51, directoryReadbackFiles:51, status:"VERIFIED"` |
| C3 | BFF `mip-admin-web-api` 重新部署：active、客户端调用关闭、0 timer、Cloudflare 不变；BFF 源站根路由 200 并引用新入口 `index-DZvhtVHV.js` | ✅ | deploy 输出 JSON + tcloudbase origin curl |
| C4 | 线上 MIW-50 特征校验：CloudBase 通道 JS 含 `targetSummary:…(500)` / `description:…(6e3)` | ✅ | 本地构建与 BFF 源站产物特征比对 |
| C5 | Cloudflare Pages 边缘（mipmini.01mvp.com 当前 200 承载方）仍为旧构建（入口 `index-9erprWtl.js`，特征 300/5e3）；`wrangler` OAuth 令牌过期且刷新需交互式登录，无 `CLOUDFLARE_API_TOKEN` | ⏳ | `/assets/index-9erprWtl.js` 特征比对；**待维护者 `wrangler login` 后 `pnpm --dir admin-web deploy:pages`**（迁移期内 CloudBase 通道已承载新代码，见 C3/C4） |
| C6 | 真实登录 + 14 读模块云端验收 | ⏳ | 同上批 C5 限制（本机未配置 `MIP_ADMIN_TEST_PHONE/PASSWORD`） |

## D. 小程序端（weapp）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm setup:local` 重生成 DevTools 编译条件（路由 58→59，新增 M18C 城市选择）后 `pnpm runtime:preflight` 全绿（真实 AppID wx2705…、DevTools 已登录、服务端口 53425、59 条路由条件完整） | ✅ | preflight devtoolsLoggedIn:true / servicePortEnabled:true |
| D2 | 微信开发者工具 CLI 对合并后代码重新编译（`cli open`，IDE server 53425；构建 5.3s，主包 1.11 MB + member 1.27 MB + admin 85.4 KB）；dist 由 `pnpm verify` 内 `verify:build` 产出（含全部合并代码） | ✅ | `✔ open` + test:runtime 构建报告（本项目 dist 无 npm 依赖，`build-npm` 不适用） |
| D3 | 运行时路由验收 `pnpm test:runtime`（DevTools automator 驱动真实产物，59 路由）：53 passed / 3 failed / 2 external-wait。3 failed + 2 WAIT 全部落在既有归因（见下节），**零新增失败根因** | ⚠️ | `.tmp/runtime/report.json` |
| D4 | 本批全部相关路由运行时 PASS：合作卡详情/编辑（MIW-48）、超级案例详情/编辑/城市选择新页（MIW-49）、机会详情/编辑（MIW-50）、机会首页、我的页 | ✅ | report.json pages 全 passed（含 375KB 机会首页截图证据） |
| D5 | 交互旅程双通过（MIW-45 修复验证）：`opportunity-search-and-filter` 4/4 步（open-talent-tab / **enter-keyword** / open-filter / close-filter 全部带 rendered-nodes 视口证据）；`profile-content-tabs` 2/2 步。原 `enter-keyword` 视口断言失败点已由 element-rect 兜底路径覆盖 | ✅ | report.json interactions；`.tmp/runtime/interaction-*.png` |
| D6 | MIW-48 合作卡样式对齐（头像/名称/等级/勋章、竖线标签、目标引荐 icon 居中、常混圈子+需要筹码模块、底部 fixed 编辑按钮、无下架/编辑/删除三按钮组） | ✅（合同级） | `mip-cooperation-card/editor-visual/public-profiles/publication-lifecycle` 等测试随 verify 全绿 + mip-cooperation 两路由运行时 PASS；视觉逐屏对设计稿 ⏳（由 confirm-page 单页 HTML + fullpage 截图任务承接） |
| D7 | MIW-49 超级案例时间线（点-线-点、无尾线、文件夹 icon 与项目名对齐）+ 案例管理收敛「我的」tab | ✅（合同级） | `mip-case-list-detail-visual/mip-cases/publication-lifecycle/city-selector` 测试全绿 + 三路由运行时 PASS；真机视觉走查 ⏳ |
| D8 | MIW-50 机会编辑流：底部「编辑/分享」横排、编辑器去合作角色、去取消按钮、返回直达机会详情、未改动内容可保存（targetSummary 500 / description 6000 三端对齐） | ✅（合同级） | `mip-opportunities/editor-required-fields/figma-surfaces/review-fixes/runtime-ux-regressions` + 云函数 `change-gated-validation.test.js` 全绿 + 双路由运行时 PASS；真机回归 ⏳ |

## 运行时失败归因（D3 补充）

3 个 failed + 2 个 external-wait 与 MIW-42..44 批次 D3 归因逐项一致，均非本批代码引入（本批不触这些页面/旅程定义）：

1. **packages/admin/managed-events**：需 Web 登录确认身份（设计如此）；其 fixture 依赖导致 **event-console / event-registrations** 按设计记 external-wait。
2. **packages/member/mip-access**：登录拦截夹具（受保护访问控制流）。
3. **packages/member/mip-ai/voice**：MIW-34 记录在案的能力门控（ASR 密钥未配置到云函数，页面按设计落 error 态）。

首轮曾在代表性状态 `loading`（pages/membership）失败，为 DevTools 冷启动时序；重开工具后复跑同阶段通过，与 MIW-42..44 记录的 automator 会话抖动同类。

## E. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 本批无迁移；回滚 = 回退 2 个云函数代码版本（云端保留历史版本）+ 静态托管前缀旧资产（未删除）+ Cloudflare 不动 | ✅ | B1/C2 事实 |
| E2 | 函数无新增 timer/权限/客户端调用；安全规则收敛检查随部署通过（admin-web-api clientInvocation:false、0 timer） | ✅ | 部署脚本终检输出 |

## 遗留与后续

- **C5 Cloudflare Pages 边缘更新**：维护者交互式 `wrangler login` 后执行 `pnpm --dir admin-web deploy:pages`；或配置 `CLOUDFLARE_API_TOKEN`。迁移验收确认后此通道可退役。
- **C6 / D6-D8 真机项**：真实账号登录、支付、手机号、ASR 语音仍需真机（本批无支付/手机号改动，风险不变）。
- **confirm-page 单页 HTML**：MIW-48..50 设计页面按业务数据变体生成至 `~/project/ame-project/mip-minip-dev/confirm-page`（合作卡 6 角色类型详情页等），用于逐屏视觉确认；见同日交付。
- **全量重截任务**：沿用 MIW-48 交付的 `scripts/fullpage-shot.mjs` 截图基架，承接前一会话的全量重截计划（见 sess_742e7d1b 交接）。
- 代理说明：当晚 Clash 隧道对部分目标间歇失效，已按节点健康度切换 Github/默认兜底组；若后续推送复现 `SSL_ERROR_SYSCALL`，优先检查 mihomo 节点或改用 `socks5h://` 远端 DNS。
