# MIW-42..44 批次验收 Checklist（2026-10-07）

本批次覆盖 3 个 review 状态任务合并、部署与端到端验收：MIW-42（机会死页与编辑器「更多设置」删除）、MIW-43（我的活动卡片取消报名按钮布局）、MIW-44（知识/游戏/盲盒用户端下线）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ⚠️ 有条件通过（已归因） · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 3 个任务工作全部提交：MIW-42 工作树补提交 `cac47cb2`（53 文件，-2684 行）、MIW-43 补提交 `c1a24963`、MIW-44 沿用已有提交 `5485b83c` | ✅ | 各 worktree git log |
| A2 | 3 个分支按序合并 main，冲突已解决：`config/runtime-pages.json` routeCount 67/61→58、`docs/mip/PROJECT_STATUS.md` 两处路由事实（58 条 = 5 主包 + 48 用户分包 + 5 管理分包）；合并后三处路由契约（app.json / runtime-pages.json / project.json）逐条一致，被删页面 0 残留 | ✅ | merge commits `0d3d4a7c`/`a82a8632`/`5636327b`；python 交叉核对三契约 set 相等 |
| A3 | 语义冲突修正：MIW-42 与 MIW-44 各自删除一条交互旅程（people-search-and-filter / game-ranking-tabs），合并后契约保留 2 条，`tests/ui-runtime-contract.test.ts` 与 `scripts/verify-runtime.mjs` 下限 3→2 并注明原因（`8b4e8e55`） | ✅ | vitest + verify-runtime 全绿 |
| A4 | `pnpm verify:all` 全绿（根工程门禁含 server contract + docs 事实校验；admin-web lint/类型/164 项 React 测试/构建/响应式合同；exit 0） | ✅ | run 完整退出码 0（注：node 16 默认 PATH 下 corepack 崩溃属环境问题，node 22 重跑通过） |
| A5 | `git diff --check` 干净；main 两次推送 origin（合并后 `20c42ff7..5636327b`，修正后 `..8b4e8e55`） | ✅ | push 输出 |
| A6 | Notma 任务状态：MIW-42/43/44 全部置 done，各附合并留档评论（含 merge commit、部署与待决口径） | ✅ | task move done ×3 + comment live_posted ×3 |

## B. 数据库与云函数部署

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 本批零数据库迁移、零 schema 变更（20c42ff7..main 不触 `database/`） | ✅ | `git diff --name-only 20c42ff7..main -- database/` 为空 |
| B2 | `mip-opportunities-api`（MIW-42 listPeople 全链下线、GLOBAL 口径移除）部署 + 验证：配置已一致、代码回读一致、MySQL 健康检查通过 | ✅ | `[mip-cloud-deploy] verified mip-opportunities-api`（API Key 通道，未动 Device Flow） |
| B3 | `mip-banners-api`（MIW-42/44 目标白名单收敛）部署 + 验证：同上 | ✅ | `[mip-cloud-deploy] verified mip-banners-api` |
| B4 | 部署产物不含环境 ID、身份值或密钥 | ✅ | deploy 输出 `no AppID, environment ID, database URI, or secret was persisted` |
| B5 | 线上行为实测（SCF Invoke `listPeople` 应结构化 404）：API Key STS 与本机 Device Flow 登录态均被 CAM 拒绝 `InvokeFunction`（与上批同现象） | ⏳ | 上批通过重新 Device Flow 解决；本批部署验证已含代码回读一致 + 健康检查，代码行为由 697 项 server contract 测试覆盖；建议维护者重走 `pnpm cloud:auth:device -- --allow-device-auth` 后补 `manageFunctions invokeFunction` 实测 |

## C. 管理后台（admin-web）部署与 HTTPS 验收

本批 `admin-web/` 与 `packages/admin-contracts` 零代码变更（20c42ff7..main 为空）；按指示照常重新部署，确保线上与 main 一致。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false`）+ BFF 打包成功，新入口 `index-CaPiX84Z.js` | ✅ | vite build + build-cloudbase 输出 |
| C2 | 静态托管隔离前缀 `mip-admin-console/` 上传并逐文件回读一致 | ✅ | `filesVerified:14, status:VERIFIED, cloudflareUnchanged:true, sharedRootUnchanged:true` |
| C3 | BFF `mip-admin-web-api` 重新部署：active、客户端调用关闭、0 timer、Cloudflare 不变 | ✅ | deploy 输出 JSON |
| C4 | 真实 HTTPS：`/` 200 且引用新入口 `index-CaPiX84Z.js`；入口 JS 200 `text/javascript`；缺失资产严格 404 不回落 SPA | ✅ | curl 200/200/404 |
| C5 | 真实登录 + 14 读模块云端验收（`verify-admin-cloudbase.mjs`） | ⏳ | 本机未配置 `MIP_ADMIN_TEST_PHONE/PASSWORD`（与上批 C5 相同限制），建议配置后人工走查 |

## D. 小程序端（weapp）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm setup:local` 重生成 DevTools 编译条件（路由 70→58）后 `pnpm runtime:preflight` 全绿（真实 AppID、DevTools 已登录、服务端口 53425、路由条件完整） | ✅ | preflight ok:true，missingAppRoutes/missingConditionRoutes 均空 |
| D2 | 微信开发者工具 CLI 对合并后代码完整重新编译并出预览包（`cli preview`） | ✅ | `✔ preview`（AppID wx2705…；TOTAL 3.1 MB = 主包 1.7 MB + member 1.26 MB + admin 134 KB；首次因 IDE 编译服务抖动失败，重试一次通过，与上批现象一致）；QR 与 size 证据存 `.tmp/miw-42-44-acceptance/` |
| D3 | 运行时路由验收 `pnpm test:runtime`（DevTools automator 驱动真实产物，58 路由） | ⚠️ | 54 passed / 4 failed。4 个失败均与本批代码无关（见「运行时失败归因」）；本批相关路由全过：机会首页（含 queryFixture mode=cooperation 取数）、我的活动 mine（MIW-43）、全部保留路由；被删 12 条路由（机会 mine/合作卡列表/人才名录 + 知识×3/盲盒×4/游戏×2）不在契约中且 0 残留 |
| D4 | MIW-43 取消报名胶囊改为卡片 footer 行（提示居左、按钮居右，不再悬浮遮挡时间/地点） | ✅（代码/合同级） | `event-registration-experience.test.ts` 断言无绝对定位、footer 布局类名；mip-events/mine 路由运行时 PASS；真机视觉走查 ⏳ |
| D5 | MIW-42 编辑器「更多设置」删除但字段原值随 save() 带回（不误清存量机会） | ✅（合同级） | MIW-42 新增/更新测试随 verify:all 全绿；真机编辑存量机会回归 ⏳ |
| D6 | MIW-44 入口清理：首页「更多内容」知识入口、设置页「团队 PK」行、内容订单「返回内容」、消息 GAME/KNOWLEDGE 目标不可跳转 | ✅（合同级） | 删除类断言随 verify:all 全绿；运行时 0 残留；真机走查 ⏳ |
| D7 | 交互旅程（opportunity-search-and-filter / profile-content-tabs） | ⚠️ | 旅程第 1 步（open-talent-tab）通过且截图证据显示人才合作 Tab、搜索框、筛选按钮渲染正常（`.tmp/runtime/interaction-*.png`）；`enter-keyword` 步骤的 automator 视口断言连续 2 轮失败（"target is outside the measured viewport"），旅程定义与本批未触碰；基线 87b48084 对照结论见下节 |

## 运行时失败归因（D3 补充）

4 个 failed 路由逐项归因，均非本批代码引入（与上批 D3 归因一致）：

1. **packages/admin/managed-events**：需 Web 登录确认身份（设计如此）。
2. **packages/member/mip-access**：登录拦截夹具（受保护访问控制流）。
3. **packages/member/mip-profile-interests**：夹具依赖（缺真实互动夹具）。
4. **packages/member/mip-ai/voice**：MIW-34 记录在案的能力门控（ASR 密钥未配置到云函数）。

## 交互旅程 A/B 归因（D7 补充）

- 合并代码 2 轮完整运行均在同一旅程步骤 `enter-keyword` 的视口断言失败；步骤 1 tap 通过、真实视觉 diff 0.379，且截图证明人才合作 Tab、搜索框、筛选按钮在视口内渲染正常（`.tmp/runtime/interaction-*.png`）。
- automator 套件当晚整体抖动：合并代码第 1 轮挂在代表性状态 `loading` 场景、第 2/3 轮通过该阶段；基线 87b48084 首轮挂在代表性状态 `error` 场景——两份代码都在不同阶段出现过环境性失败。
- 基线工作树对照运行（runtime-baseline2/3）因 DevTools host automator 连接超时未能完成（环境性，与代码无关）；改以静态等价性归因：两条保留旅程（`opportunity-search-and-filter`、`profile-content-tabs`）与 87b48084 基线逐字节一致，视口断言代码本批仅改旅程数量下限（3→2），机会首页本批改动（新增 onLoad mode 解析、删除列表底部「打开更多入口」区块）不触及搜索行布局。
- **结论：`enter-keyword` 视口断言失败为既有工具链测量问题（native `<input>` rect 上报疑似兼容性缺陷），非本批引入。** 建议单独小卡排查 `renderedNodes` 对 input 元素的 rect 上报。

### MIW-45 复核结论（2026-10-07）

- 独立会话（`@weapp-vite/miniprogram-automator` `Automator.launch`，独立端口、当前 bundle）复测：`renderedNodes('#opportunities-search-input')` 返回 1 个节点，rect `top=154.30 left=44 bottom=176.70 right=271 width=227 height=22.4`（视口 390x753），与 `element.size()/offset()`（227x22 @ 44,154.3）一致，t+0ms 即稳定，重复 4 次不变——**排除库的 rect 数据缺陷与 wx:if 测量时机问题**。
- 失败轮特征：`preferOpenedSession=true` 附加到已开共享会话后，同会话内 view 选择器（步骤 1）rect 证据通过、截图渲染正常，仅 native `<input>` 选择器连续 3 次重试拿不到可用 rect。归属为**长寿命共享 DevTools 会话的测量上下文退化**（与「开发者工具旧窗口陷阱」同类），而非选择器或页面缺陷。
- 修复（调用侧，`scripts/verify-runtime.mjs`）：① renderedNodes 无可用 rect 时，用 `queryFreshRenderedActionElement` + `element.size()/offset()`（DOM 属性协议，独立测量路径）构建等价视口证据（`source: 'element-rect'`）；② 两路均失败抛 `unmeasurableInteractionTarget` 标记错误，归入可恢复运行时错误（`interaction-target-unmeasurable`），复用既有 attempt 2 新会话重启机制。未改 node_modules。
- 库 issue 线索：`@weapp-vite/miniprogram-automator@1.2.22` `Page.renderedNodes`（`App.callFunction` + `SelectorQuery.selectAll().fields({rect,size})`）在长寿命共享会话中对部分 native 元素可返回无 rect/空结果；同页同帧 `element.size()/offset()` 正常。复现依赖已开会话状态，暂不可稳定重装；若再次出现，记录 DevTools 版本与 `App.callFunction` 返回体。

### MIW-45 验收运行（2026-10-07，run 4 attempt 2 完整轮）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 两条交互旅程全部步骤 passed | ✅ | `opportunity-search-and-filter` 4/4（open-talent-tab diff 0.424、**enter-keyword diff 0.00252**、open-filter diff 0.143、close-filter diff 0.125）；`profile-content-tabs` 2/2（show-cases 0.123、show-opportunities 0.139）；全部步骤带视口证据（`.tmp/runtime/report.json` interactions） |
| `enter-keyword` 视口判定（原失败步骤） | ✅ | renderedNodes rect `227x22.4 @ (44, 90.8)`（视口 390x753），`source: rendered-nodes`；top 90.8 ≈ chromeBottom(83)+8，证明 `revealScrolledInteractionTarget` 补偿把输入框滚出胶囊遮挡区，真实视觉 diff 0.00252 ≥ 0.001 门限 |
| 6 个代表状态 | ✅ | loading/empty/error/forbidden/conflict/disabled 全 passed（证据窗口 1200→4000ms 后稳定） |
| 导航（tabs/back/deepLink） | ✅ | 4 tab + 返回流 + deepLink 全 passed |
| 58 路由不回归 | ✅ | 53 passed / 3 failed / 2 external-wait。3 个 failed 与 2 个 WAIT 全部落在既有 4 项归因内：managed-events（需 Web 登录；本轮独立新会话无登录态，数据未 settled，其 fixture 依赖 event-console/event-registrations 按设计记 external-wait）、mip-access（登录拦截夹具）、mip-ai/voice（ASR 密钥门控）；mip-profile-interests 本轮 passed（较 D3 基线改善）。今日全部完整轮次失败模式一致（run 1 与 run 4 双 attempt 相同），与本次改动无关；无新增失败根因 |
| 尝试与恢复机制 | ✅ | attempt 1 因 `App.callFunction` 12000ms 超时（connection 类）触发既有恢复 → attempt 2 新会话完成全程；recoveries 记录 prewarmed-devtools-project / cleared-stale-port-lease(10248) / reconnect-target-project；cleanup closed |
| 聚焦单元测试 | ✅ | `tests/runtime-page-privacy-states.test.ts` 10 passed（element-rect 兜底证据、guardrail 标记、可恢复分类断言齐全） |

说明：`pnpm test:runtime` 退出码仍为 1——runner 末段断言要求 0 个非 passed 页面，既有归因失败按批次口径记录在本文档而非使运行转绿（与 D3 的 ⚠️ 同一处理方式）。MIW-45 目标（enter-keyword 视口判定）已修复并通过完整运行验证。

## E. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 本批无迁移，回滚即回退 2 个函数代码版本（云函数保留历史版本）与静态托管前缀旧资产（未删除） | ✅ | B1/C2 事实 |
| E2 | 函数无新增 timer/权限/客户端调用；安全规则收敛检查随部署通过 | ✅ | 部署脚本终检 + `assertNoTimerTriggers` |

## 遗留与后续

- B5、C5、D4 真机项、D5/D6 真机回归为需人工/测试账号的验收项，完成后在本文勾选补充。
- MIW-44 任务体中的四项「保留待决」不变：`mip-game-api`/`mip-knowledge-scheduler` 云函数下线、admin-web 知识/游戏页签、相关表数据清理、`defaults.ts` 的 `gameFunctionName` 配置，需产品决定后另卡处理。
- automator 交互旅程的「视口外」断言对 native `<input>` 目标疑似存在测量兼容问题（本批未触碰该断言与旅程定义），建议单独小卡排查 `renderedNodes` 对 input 元素的 rect 上报。
