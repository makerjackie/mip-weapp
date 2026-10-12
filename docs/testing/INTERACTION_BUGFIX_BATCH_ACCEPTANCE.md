# 交互类 Bug 修复批次验收（BUG-01..12）— 2026-10-12

- 发布提交：`2d7f74c2`（Merge branch 'audit/interaction-bugs'；修复提交 `0eb951e0`、`98ff402d`，审计报告 `docs/research/weapp-interaction-bugs-audit-2026-10-12.md`）
- 范围：小程序交互类使用 bug 12 类 20+ 处（单击双触发、双击双开页面、双击连退两级、授权窗口无锁、重复提交、分页卡死、竞态重复项、错误态覆盖正文、重复请求）。零云函数/零 admin-web 源码/零数据库迁移变更。
- 版本：体验版 0.3.1（基于 0.3.0 批次之后）

## A. 门禁

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 单元/合同测试全量：vitest 268 文件 1664 用例 | ✅ | 全绿（含新增 6 个回归测试文件、45+ 用例） |
| A2 | `tsc -b --noEmit`、`eslint .` 零错误零警告 | ✅ | 修复批次内 3 处 lint 错误后归零 |
| A3 | `pnpm verify`（小程序 + CloudBase 门禁） | ✅ | verify passed |
| A4 | `pnpm admin:web:verify`（Web 独立门禁） | ✅ | 含 responsive 契约 |
| A5 | `pnpm verify:all`（上传前完整门禁） | ✅ | 上传 0.3.1 前在发布 HEAD 重跑通过 |
| A6 | `git diff --check` 干净；本批零迁移（`database/` 无变更） | ✅ | 空 diff |

## B. 云函数（无源码变更，健康复核）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 源码核对：`git diff 9f12c474..HEAD -- cloudfunctions/` 为空——0.3.0 批次部署的 7 个函数（mip-ai-api、mip-ai-draft-provider、mip-banners-api、mip-identity-api、mip-notification-worker、mip-notifications-api、mip-outbox-worker）代码与当前 main 一致，无需重部署 | ✅ | 空 diff；MIW-65..69 验收文档 B1-B7 部署记录 |
| B2 | `pnpm cloud:verify`：schema、最小权限 grants、函数健康、受保护调用规则 | ✅ | `[mip-cloud-verify] … verified`（API Key STS 被 CAM 拒绝后，按 AGENTS §8 以 `CLOUDBASE_AUTH_MODE=local` 复用本机 Device Flow 完成复核；未发起新授权） |
| B3 | 订阅模板 G2 行动项（OPPORTUNITY_NOTICE）：`.env.local` 仍缺该模板配置，mip-notifications-api/mip-notification-worker 暂无重部署意义 | ➖ 挂起 | 模板键仅 EVENT_REMINDER/CHECKIN_RESULT/HEART_RECEIVED；待 W26 申请后另行部署 |

## C. 管理后台（admin-web，静态托管回读闭环 = 0.3.0 批次 C6 行动项）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 欠费解除确认：静态域名 HTTP 200（0.3.0 时 451） | ✅ | curl 实测 |
| C2 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false`）：产物入口 `index-CYFT5GuB.js` 458369B，与线上现行入口一致（源码零变更，幂等重传） | ✅ | 构建输出 |
| C3 | 静态托管上传 + 三层回读：listing 56 文件、目录级 SHA-256 全对、逐文件 14/14 `VERIFIED`，Cloudflare 与共享托管根未动 | ✅ | `.tmp/admin-cloudbase-static/`（首次逐文件回读瞬时失败，重试通过） |
| C4 | 线上字节级验证：`verify-admin-live-assets` 对正式域名 14/14 文件匹配，入口 `/assets/index-CYFT5GuB.js` | ✅ | `.tmp/admin-release-interaction-20261012/assets.public.json` |
| C5 | BFF `mip-admin-web-api`：源码零变更未重部署，线上 67/67 HTTPS 验收证据沿用 2026-10-09 域名绑定记录 | ➖ 不适用 | `git diff 9f12c474..HEAD -- admin-web/` 为空 |

## D. 小程序端（weapp）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm build` 最终 main 出包：主包 1.11 MB / member 1.27 MB / admin 85.8 KB | ✅ | 构建输出 |
| D2 | 微信开发者工具重新打开并编译最新代码 | ✅ | `pnpm open` 完成打开流程 |
| D3 | `pnpm runtime:preflight`：真实 AppID、登录态、服务端口、compileHotReload、appRoutesComplete | ✅ | ok:true，missing routes []，服务端口 62842 |
| D4 | 修复页面真机/工具抽查（BUG-01 设置页单击一次只开一层、BUG-02/03 双击卡片/返回、BUG-04 双击报名/支付） | ⏳ 真机 | 本批以 vitest 回归 + automator E2E 覆盖逻辑层；真机双击时序见 G 节 |
| D5 | 体验版发布：发布前在发布 HEAD（`2d7f74c2`）重跑完整 `pnpm verify:all` exit 0 + `pnpm build` 后，经已登录微信开发者工具 CLI 上传（本机 `MIP_WECHAT_CODE_UPLOAD_KEY_PATH` 私钥不存在，按 AGENTS §7 走 DevTools 登录态通道，同 0.3.0） | ✅ | `cli upload -v 0.3.1` → `✔ upload`；包体 total 3.1 MB（main 1.7 MB / member 1.2 MB / admin 134.9 KB） |

## E. 端到端运行时验收（`pnpm test:runtime`，automator 驱动真实产物）

单轮完整巡检：**56 条路由 50 PASS / 3 FAIL（既有归因）/ 3 external-wait（夹具依赖）**；交互旅程 2/2 全过。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 本批改动页面全部 PASS：privacy（BUG-01 受害页）、mip-tasks（+detail）、mip-growth、mip-card（+edit）、order-detail、mip-branches、announcements、pages/events、mip-events detail/mine/registration/participants、pages/opportunities（+mip-opportunities detail/editor）、mip-opportunity-cooperators、mip-cases editor/city-selector、mip-cooperation detail/editor、orders、payment-result、admin dashboard/web-login-confirm | ✅ | `.tmp/runtime/report.json` 50 passed |
| E2 | 交互旅程 2 条（opportunity-search-and-filter / profile-content-tabs）全过 | ✅ | run 报告 PASS ×2 |
| E3 | 6 个未过项逐一比对 0.3.0 基线 E3，归因一致、零新增：managed-events（admin 工作台需 Web 确认登录，settled on error，设计如此）→ 级联 event-console/event-registrations external-wait；mip-access（登录拦截夹具）；mip-cases/detail（需 profile 真实案例夹具）；mip-ai/voice（MIW-34 ASR 能力门控落 error，与本批双击/删除/计时修复无关，页面能力门控先于这些流程） | ⚠️ 既有归因 | 与 MIW-65..69 批次 E3 同口径 |
| E4 | 相对 0.3.0 的改善：events detail/registration/participants 由 external-wait 转为 PASS（真实夹具可用） | ✅ | report.json |

## H. 简要测试报告

**结论：PASS（含 6 项既有归因的已知边界，与上一发布批次口径一致，无新增失败）。**

1. **静态质量**：vitest 268 文件 1664 用例全绿（较 main 基线新增约 69 用例：6 个新回归测试文件 + 4 个既有文件扩充，全部针对本批 12 类 bug 的"双击/单击只生效一次、竞态不产生重复项、错误态不覆盖正文"等断言）；tsc 零错误；eslint 零问题。
2. **端到端**：automator 真实产物巡检 56 路由，本批触及的 20+ 页面全数 PASS；两条交互旅程全过；6 个未过项与 0.3.0 基线逐一比对归因一致（admin 登录门禁 ×1 + 级联 ×2、登录拦截夹具 ×1、真实案例夹具 ×1、ASR 能力门控 ×1）。
3. **部署面**：云函数零变更 + `cloud:verify` 全绿；admin-web 静态 14/14 字节级验证（0.3.0 遗留 C6 回读闭环完成）；线上入口 `index-CYFT5GuB.js` 与本批构建一致。
4. **遗留真机边界**（不阻断体验版）：双击/单击时序类修复的最终确认依赖真机转场时序（G1）；订阅模板 W26 配置与重部署待维护者（G2）。


## F. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| F1 | 回滚即回退小程序包（体验版重传 0.3.0 即可）；admin-web 静态旧资产未删除；云函数未变更 | ✅ | C3（cloudflareUnchanged、sharedRootUnchanged） |
| F2 | 部署与验证全程未打印/未持久化密钥、环境 ID 不入验收产物；`.env.local` 仅新增本地 origin 配置 | ✅ | 脚本设计 + 本文档 |

## G. 行动项与真机边界

| # | 事项 | 责任 |
| --- | --- | --- |
| G1 | 真机抽查双击/单击交互（设置页 10 行单击只开一层；列表卡、返回按钮、报名、发布机会、继续支付、申请退款、设为主分会双击单次生效；保存按钮 300ms 窗口；语音页双击录完/处理中删除/切后台计时） | 维护者 |
| G2 | 订阅模板 W26 申请 → `.env.local` 配置 → 重部署 mip-notifications-api/mip-notification-worker（沿 0.3.0 批次 G2） | 维护者 |
| G3 | BFF 完整重部署（含认证 schema 三密钥）待下次 admin-web 源码变更时一并执行 | 维护者 |
