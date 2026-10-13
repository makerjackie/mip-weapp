# MIW-80/81 批次验收 Checklist（2026-10-13）

本批次覆盖 2 个 review 任务合并、全量部署与端到端验收：MIW-80（机会-人才合作无法加载：客户端 `parseCooperationTalentPage` 放宽 `cards: []`，与服务端 MIW-78 名单册契约对齐）、MIW-81（我的页非玩家会员等级横幅嘉宾变体：`mip-level-banner` 立即解锁 0/100、整卡点击进会员页，导航栏与头像面板带融合，会员 FAQ 文案同步）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`，`MIP_DEPLOYMENT_STAGE=staging`）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ⚠️ 有条件通过（已归因） · 🚫 环境阻断 · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | review 任务工作全部提交：MIW-80 `c1aa744d`（2 文件 +17/−2）、MIW-81 `322503df`（5 文件 +16/−46）+ review 追加 `dd033e98`（导航栏融合，2 文件）；两 worktree 提交后干净 | ✅ | `git status` 干净、`git log` |
| A2 | 两分支基于 main HEAD `7f01592d` 顺序无冲突合并：merge commits `67f577d5`（MIW-80）/`e700b1e5`（MIW-81） | ✅ | merge commits |
| A3 | `pnpm verify:all` 合并后全绿：小程序（lint/stylelint/typecheck/构建/预算/server contract/vitest 265 文件 1670 项，含 MIW-80 新增合作卡空数组正向用例与 MIW-81 结构 pin）+ admin-web（28 文件 177 项 + 构建 + 响应式合同） | ✅ | 后台任务退出码 0 |
| A4 | `git push origin main`：`7f01592d..e700b1e5` | ✅ | push 输出 |
| A5 | Notma 看板：MIW-80/MIW-81 状态置 done，timeline 各留合并交付评论（live_posted） | ✅ | task move ok + comment `evt_42fc…`/`evt_fdf3…` |
| A6 | 本批零数据库迁移、零云函数源码改动（`git diff 7f01592d..e700b1e5 -- database/ cloudfunctions/` 为空） | ✅ | 空 diff |

## B. 云函数部署（staging，全量口径）

本批云函数零源码改动，全量部署为一致性确认。API Key 通道 Invoke 健康门被 CAM 拒绝（`Cam authentication failed`，与 MIW-77/78、MIW-79 轮一致），按根 AGENTS §8 口径复用本机 Device Flow 登录态（`pnpm cloud:auth:device -- --allow-device-auth` 返回 existing local authorization usable，未发起新授权），`CLOUDBASE_AUTH_MODE=local` 完成部署。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 核心 16 函数全量部署 + 逐一真实 invoke 健康门（identity/media/events/opportunities/community/commerce/admin/growth/game/tasks/banners/ai/notifications/payment-ledger/notification-worker/outbox-worker，全部 configuration already current + verified） | ✅ | deploy 输出 16/16 verified |
| B2 | `pnpm cloud:verify -- --confirm-env=…`：schema、最小权限 grants、函数健康、受保护调用规则、禁 timer 全部通过 | ✅ | `[mip-cloud-verify] … verified` |
| B3 | 支付三函数（mip-cloudpay / mip-cloudpay-callback / mip-refund-worker，`MIP_PAYMENT_MODE=test`）部署 + verified | ✅ | `[mip-payment-deploy] verified ×3` |
| B4 | 部署产物不含环境 ID、AppID、数据库 URI 或密钥 | ✅ | 各部署终检输出 |

## C. 管理后台（admin-web）

本批 `git diff 7f01592d..e700b1e5 -- admin-web/` 为空（零源码改动）；按「全量部署」要求完成 BFF + 静态重新发布，产物与线上入口哈希一致（`index-Zv-qltiC.js`）。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建 + `build-cloudbase.mjs` 产物就绪；入口与线上一致（同源码同依赖，无资产断档风险） | ✅ | `.tmp/admin-cloudbase-function/`；线上与新 dist 入口均 `index-Zv-qltiC.js` |
| C2 | BFF `mip-admin-web-api` 以默认 CloudBase origin 重新部署：Active、客户端不可调用、0 timer、Cloudflare 未变 | ✅ | `{"active":true,"clientInvocation":false,"timers":0,"cloudflareUnchanged":true}` |
| C3 | 静态托管上传隔离前缀 `mip-admin-console/`：目录回读 63 文件，逐文件 SHA-256 14/14 VERIFIED | ✅ | `status:VERIFIED, filesVerified:14` |
| C4 | 公开 HTTPS 字节校验（verify-admin-live-assets，实际入口域名）：staticAssetsVerified 14/14、入口一致 | ✅ | `assets.public.json` |
| C5 | 线上回读：根 HTML 200、入口 JS 200（476454B）、`/api` 未知道由 BFF 归一化 NOT_FOUND 响应（路由可达、防泄漏） | ✅ | curl 实测 |
| C6 | 账号级 HTTPS 模块验证（verify-admin-cloudbase）：本机缺 `MIP_ADMIN_TEST_*` 验证账号 | 🚫 | 与 MIW-79 等历轮一致，非本批回归 |

## D. 小程序端端到端（微信开发者工具实机，真实环境）

前置：`pnpm build` 最新 dist（主包 1.10MB / member 1.25MB / admin 85.8KB）；`cli open` 打开项目编译；`pnpm runtime:preflight` 全绿（真实 AppID、55 路由完整、开发者工具已登录、服务端口 62842）。聚焦自动化走仓库 host 目录（`~/Library/Caches/mip-weapp-devtools/…`，`cli auto --auto-port 9701`）——直接对源码根开 auto 会折叠进已打开父工作区导致会话永久等待。

### MIW-80 机会-人才合作

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | 机会广场 `pages/opportunities/index` runtime ready + 整页旅程通过（test:runtime `PASS pages/opportunities/index 147KB`、交互旅程 `opportunity-search-and-filter` PASS） | ✅ | `.tmp/runtime/` 截图与报告 |
| D2 | 人才合作 Tab 打开即 ready，不再落错误态 | ✅（F 节服务端修复后） | 聚焦 E2E `mode=cooperation state=ready` |
| D3 | 无发布卡 ACTIVE 人才渲染为正常卡片（无角色标签行） | ✅ | `talents=13`，首卡 `roleNames=[]`；截图 `.tmp/miw80-81-e2e/opportunities-cooperation.png`（「MIP 用户」无角色标签正常卡） |
| D4 | 合作卡详情不回归 | ✅ | 真实卡 id `…0106` 详情 `state=ready` |
| D5 | 服务端契约测试（cooperation-discovery `cards: []` 正向 + 卡 id 重复拒绝）全量 vitest 内通过 | ✅ | verify:all 1670 项内 |

### MIW-81 我的页等级横幅

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D6 | 个人中心 runtime ready + 交互旅程通过（`interaction:profile-content-tabs` PASS） | ✅ | test:runtime + 聚焦 E2E `growthState=ready` |
| D7 | 登录态横幅渲染正确：玩家变体黄色横幅（`Lv.1`、`50 / 500` 进度、右上「玩家等级」标签） | ✅ | 聚焦 E2E `variant=player levelBannerText="Lv.1"`；截图 `profile-banner.png` |
| D8 | 嘉宾变体整卡点击跳会员成长页 | ⚠️ | 开发者工具会话为玩家账号，嘉宾分支 tap 无法实测；嘉宾变体结构由 `tests/mip-level-art-visual.test.ts` pin，点击目标成长页 `mip-growth` runtime ready（D8b PASS） |
| D9 | 未登录游客帧保持「请登录后查看」 | ✅ | `tests/mip-profile-journey.test.ts` 结构 pin |
| D10 | 导航栏与头像面板带融合视觉（dd033e98）无遮挡/错位 | ✅ | `profile-banner.png`：顶部导航与面板底色连续，无遮挡 |
| D11 | 会员权益 FAQ 文案「点击等级横幅（未开通时显示立即解锁）」 | ✅ | `src/packages/member/help/index.wxml` + verify |
| D12 | 昵称旁会员徽标（`membershipLabel`）保留 | ✅ | `membershipLabel="玩家"`；截图昵称旁皇冠徽标可见 |

### 回归

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D13 | 机会域不回归：公开档案 `profileRef` 直开 ready；对TA感兴趣页到 `blocked`（「仅玩家可查看」成员门控定义态，与本批无关；基线轮该页本就是 external-wait） | ✅/⚠️ | 聚焦 E2E `public-profile state=ready`、`interests state=blocked` |
| D14 | `pnpm test:runtime` 全量旅程：54 PASS / 3 FAIL / 6 external-wait；3 FAIL（managed-events 控制台登录、mip-access 本地登出夹具、mip-ai/voice 麦克风权限错误态）与 MIW-79 基线归因完全一致，非本批回归 | ⚠️ | `.tmp/runtime/report.json` |

## E. 端到端发现的服务端回归与修复（F）

聚焦 E2E 首轮发现人才合作 Tab 恒落「机会服务暂时不可用」：同一 `mip-opportunities-api` 的 `getCatalogs`/`listOpportunities`/`listCooperationCards` 全部正常，仅 `listCooperationTalents` 服务端 500（客户端路径 951ms 后失败）。经本地以函数原代码 + staging MySQL 复现（`.tmp/diagnose-talents.mjs`），根因是 **MIW-78 review 内联（`cbf1d376`）把 `LEFT JOIN mip_profiles p` 留成两行**，MySQL 报 `Not unique table/alias: 'p'`，被 `failure()` 归一化为 SERVICE_UNAVAILABLE——即 MIW-80 用户报障的服务端第二层根因，MIW-80 客户端修复合并后仍未暴露。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| F1 | 删除重复 JOIN（`eec4de62`）+ 外层 JOIN 别名唯一性回归测试；`mip-opportunities-api` 152/152 通过 | ✅ | `npm test` 152 pass |
| F2 | 修复后主查询在 staging MySQL 实际执行无 SQL 错误 | ✅ | `.tmp/diagnose-talents.mjs` |
| F3 | `--only=mip-opportunities-api` 重部署 + 真实 invoke 健康门 + `pnpm cloud:verify` 全绿 | ✅ | deploy verified |
| F4 | 复跑聚焦 E2E：11/12 PASS，人才 Tab `state=ready`、13 人才渲染（含无卡人才无角色标签行）、合作卡详情/公开档案 ready | ✅ | `/tmp/focused_e2e6.log` + 截图 |
| F5 | 修复提交推送 origin main（`99227da3..eec4de62`） | ✅ | push 输出 |

## G. 体验版发布

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | `pnpm verify:all` 上传门禁全绿（含 F 节修复与 lint 修复 `prune-unreachable-npm.mjs` 非捕获组；根 266 文件 1673 项 + Web 177 项） | ✅ | 后台任务退出码 0 |
| E2 | 开发者工具登录态通道上传体验版 `0.2.0.20261013.5`（dist 平铺 + 等效 project.config.json 临时上传工程，`/tmp/mip-weapp-upload-20261013-5/`）：主包 1.7MB / member 1.2MB / admin 134.9KB 均在限额内，`✔ upload` | ✅ | DevTools CLI 输出 |
| E3 | 真机支付/手机号/扫码签到/录音/嘉宾变体真机表现仍待真机（历轮一致边界） | ⏳ | 见 RUNTIME_ACCEPTANCE.md |

备注：本批进行期间另一并行会话处理 MIW-79 主包 dist 损坏遗留（npm prune 顺序）并已上传体验版 `0.2.0.20261013.4`（`99227da3`）；本批体验版顺延为 `0.2.0.20261013.5`，两者均基于含 MIW-80/81 合并的 main。
