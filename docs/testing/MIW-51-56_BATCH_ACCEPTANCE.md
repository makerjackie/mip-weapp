# MIW-51..56 批次验收 Checklist（2026-10-08）

本批次覆盖 6 个 review 状态任务合并、部署与端到端验收：MIW-51（我的页玩家等级 Lv.数字横幅与间距）、MIW-52（竖版用户卡四处列表统一 + 心动值列表按人聚合）、MIW-53（活动详情吸底栏两态/主办方介绍后台可配/下线活动变更模块）、MIW-54（合作卡/超级案例/机会删除弹窗带对象标识 + 下线超级案例孤儿列表页）、MIW-55（机会卡片三列表面对齐 Figma 状态）、MIW-56（AI 语音草稿误报修复 + mip-dialog 确认键文案修复）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ⚠️ 有条件通过（已归因） · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 6 个任务工作全部提交：MIW-51 `b97f96a5`、MIW-52 `571fbb22`、MIW-53 沿用已有三提交 `2b178fa9`/`2e7f5999`/`c7f05fcc`、MIW-54 `8b38b620`、MIW-55 `e30c054d`+`467f112a`、MIW-56 `0c5d7ac6`；四个 worktree 提交后工作区全部干净 | ✅ | 各 worktree `git log`/`git status` |
| A2 | 6 个分支按序合并 main：MIW-51/52/53 无冲突；MIW-54 与 MIW-53 在 `docs/mip/PROJECT_STATUS.md` 统计行冲突，按合并后事实解决（路由 59−1=58 条、迁移 102+1=103 个，逐项与 `config/runtime-pages.json` routeCount=58、`database/mysql/mip/*.sql` 103 个核对一致）；MIW-55/56 无冲突。merge commits：`287d823a`/`cc881a98`/`63fd5801`/`44e2487b`/`68621eb6`/`cdf091a9` | ✅ | merge commits + 合并后 config 回读 |
| A3 | 路由契约 59→58 同步：MIW-54 下线 `packages/member/mip-cases/list/index`，app.json / runtime-pages.json / project.json / mip-banners-api allowlist 四处一致；`docs/mip/PROJECT_STATUS.md` 更新为 58 条（5 主包 + 48 用户分包 + 5 管理分包）、103 个迁移 | ✅ | dist/app.json 无该路由；runtime-preflight appRoutesComplete:true |
| A4 | `pnpm verify:all` 全绿：小程序 verify（构建 + 预算 + server contract + docs 事实校验 + vitest 全量，含 MIW-53 带入的 admin-api 743 / events-api 159 云函数测试与根工程 1543+ 项）+ admin-web verify（lint + 类型 + 27 文件 164 项 React 测试 + 构建 + 响应式合同） | ✅ | 后台运行退出码 0 |
| A5 | `git push origin main`：`2d4041e4..cdf091a9` | ✅ | push 输出 |
| A6 | Notma 任务状态：MIW-51..56 全部置 done（`task move done` ×6 ok:true），并逐卡发布合并记录评论（live_posted ×6；首轮带 `--author` 被 invalid_author 拒绝进入 outbox，按 skill 口径省略 `--author` 重发成功，outbox 文件保留未回放） | ✅ | notma-cli 返回 |

## B. 云函数与数据库部署（CLOUDBASE_AUTH_MODE=local）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 迁移前仓库外逻辑备份：154 张表 row-count-verified，manifest 校验通过（format/environmentFingerprint/时效） | ✅ | `~/mip-backups/2026-10-08b-miw-51-56/manifest.json`（completedAt 2026-10-08T13:13:38Z） |
| B2 | MIW-53 迁移 `20261008100000 mip_event_organizer_introduction`（mip_events 加列，无新表，权限无需收敛）应用成功，isolated schema verified；dry-run 确认这是唯一待应用迁移 | ✅ | `[mip-schema] applied: mip_event_organizer_introduction 20261008100000` |
| B3 | `mip-events-api` 部署 + 验证（MIW-52 心动值按人聚合 + public-person-details、MIW-53 详情投影 organizerIntroduction）：配置一致、代码回读一致、MySQL 健康检查 `persistence=cloudbase-mysql` 通过 | ✅ | `[mip-cloud-deploy] verified mip-events-api` |
| B4 | `mip-admin-api` 部署 + 验证（MIW-53 主办方介绍全链路 normalizeEventDraft/saveEvent/cloneEvent/content-safety）：同上 | ✅ | `[mip-cloud-deploy] verified mip-admin-api` |
| B5 | `mip-ai-api` 部署 + 验证（MIW-56 未知 action 报 `ACTION_NOT_FOUND` 与「草稿不存在」区分）：同上 | ✅ | `[mip-cloud-deploy] verified mip-ai-api` |
| B6 | `mip-banners-api` 部署 + 验证（MIW-54 allowlist 移除 mip-cases/list）：同上 | ✅ | `[mip-cloud-deploy] verified mip-banners-api` |
| B7 | `mip-opportunities-api` 部署 + 验证（MIW-55 offline 卡可见性规则）：同上 | ✅ | `[mip-cloud-deploy] verified mip-opportunities-api` |
| B8 | `mip-ai-draft-provider` 本批仅 README 变更、`mip-opportunities-api` 测试为伴随测试，均无需单独部署通道（provider 函数零代码变化） | ➖ | `git diff 2d4041e4..main -- cloudfunctions/mip-ai-draft-provider/` 仅 README.md |
| B9 | `pnpm cloud:verify`：schema、最小权限 grants、函数、健康、受保护调用规则全部验证通过 | ✅ | `[mip-cloud-verify] schema, least-privilege grants, functions, health, and protected invocation rules verified` |
| B10 | 云端冒烟：匿名 invoke `mip.events.list` 返回 `AUTH_REQUIRED`（函数存活、路由正确、鉴权门禁按设计拒绝匿名调用） | ✅ | invokeFunction RetMsg ok:false code=AUTH_REQUIRED |
| B11 | 管理 API Key 通道 SCF Invoke 被 CAM 拒绝（与上批 B5 同现象）；Device Flow 登录态（auth.json 当日 10:55 刷新）+ `CLOUDBASE_AUTH_MODE=local` 下重启 mcporter 守护进程刷新凭证缓存后 Invoke 恢复，部署健康检查全部通过，无需重走 Device Flow | ✅ | daemon restart 后 `invokeFunction` InvokeResult:0 |

## C. 管理后台（admin-web）部署与验收

本批 `admin-web/` 变更为 MIW-53 `admin-event-mutation-forms.ts` 及表单/移动预览接线（活动表单新增「主办方介绍」多行文本，回填 + 预览）。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false pnpm admin:web:build`），入口 `index-DbZ2ZaG8.js` | ✅ | 构建输出 |
| C2 | CloudBase 静态托管隔离前缀 `mip-admin-console/` 上传并三重回读：云清单 52 文件核对一致、目录整树回读 52/52（topUps=0）、14 构建文件逐文件 SHA-256 一致；`cloudflareUnchanged:true`、`sharedRootUnchanged:true`，status `VERIFIED` | ✅ | deploy 输出 JSON |
| C3 | 部署产物含 MIW-53 特征：入口 JS 含 `organizerIntroduction`（2 处） | ✅ | `grep -c organizerIntroduction dist/assets/index-DbZ2ZaG8.js` |
| C4 | 字段合同测试随 verify 全绿（`admin-event-mutation-forms.test.ts` 覆盖新字段保存/回填/预览） | ✅ | admin-web verify 164 项通过 |
| C5 | Cloudflare Pages 边缘仍为旧构建，`wrangler` 授权与上批 C5 同状态（OAuth 未被授权，无 API Token）；迁移期内 CloudBase 通道已承载新代码 | ⏳ | 待维护者 `pnpm --dir admin-web exec wrangler login` 后 `deploy:pages`，或配置 `CLOUDFLARE_API_TOKEN` |
| C6 | 真实登录 + 活动表单浏览器实操（配置主办方介绍 → 小程序详情页展示同内容） | ⏳ | 本机未配置管理后台测试账号；合同层（admin-api 全链路测试 + C4）与小程序端 fixture 渲染已覆盖（见 D5），端到端写读回路由真机/登录后补验 |

## D. 小程序端（weapp）端到端

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm build` 后 DevTools CLI 重新编译（`cli islogin` true、`cli open` ✔、IDE server 53425）；`pnpm runtime:preflight` 全绿（真实 AppID、devtoolsLoggedIn:true、servicePortEnabled:true、58 路由条件完整、compileHotReload:true） | ✅ | preflight JSON 全 true |
| D2 | MIW-51 我的页实机验证：真实登录态（真实云数据）下等级横幅显示 `Lv.1`（Lv.数字格式，不再显示等级名「起步」），横幅与头像区间距正常，右侧「玩家等级 ›」文案对齐；探针 `levelBannerText` 通过（证明新 bundle） | ✅ | `.tmp/fullpage-shots/profile-miw51-fullpage.png` |
| D3 | MIW-52 心动值页实机验证：`?kind=RECEIVED` 真实云数据按人聚合展示——同一人多条心动合并计数（唐乔/陈远/林夏均显示红心 2），列表按最新互动排序；统一竖版嘉宾卡（左上 Lv 徽标、居中头像、城市MIP\|行业\|身份、定位语、勋章、邀请人行）四处表面之一落地 | ✅ | `.tmp/fullpage-shots/hearts-received-miw52-fullpage.png` |
| D4 | MIW-52 访客列表实机验证：`?scope=influence&category=VISITOR` 真实数据统一竖版卡渲染一致；空态（我的心动 tab）文案正常 | ✅ | `.tmp/fullpage-shots/visitors-miw52-fullpage.png`、`hearts-miw52-fullpage.png` |
| D5 | MIW-53 活动详情实机验证：真实活动（`mip.events.detail` 真实调用）state ready；`organizerIntroductionNodes` 字段存在（新代码探针）；未配置时主办方空态回退（不下发即空态，符合投影口径）；吸底栏两态（客服+分享+立刻报名）符合设计；活动变更模块已不再渲染 | ✅ | `.tmp/fullpage-shots/event-detail-miw53-fullpage.png` + automator data 断言 |
| D6 | MIW-53 主办方介绍渲染通道：fixture 注入富文本节点（段落+列表）后整页截图无异常，渲染通道与活动介绍复用同一 rich-text 管线；后台配置→云端→端上写读回路的浏览器实操归入 C6 | ✅（渲染通道） | `.tmp/fullpage-shots/event-organizer-miw53-fullpage.png` |
| D7 | MIW-54 删除弹窗实机验证：automator 对合作卡触发真实 `longpress`，原生弹窗标题「删除合作卡」、内容「『老保姆 · 把项目稳稳当当交付到…』删除后将无法恢复，是否删除？」（对象类型 + 角色名·定位语截断 16 字），未点确认无破坏 | ✅ | `.tmp/fullpage-shots/delete-dialog-miw54.png` |
| D8 | MIW-54 孤儿列表页下线：dist/app.json 无 `mip-cases/list`，个人页 `openCaseList` 入口删除，banners-api allowlist 同步收窄 | ✅ | dist/app.json 检查 + B6 |
| D9 | MIW-55 机会页实机验证：真实数据卡片渲染（值/城市/地区/寻找四行 + 想合作 pill + 状态），离线卡可见性规则由云函数测试与 `miw55-opportunity-card-alignment.test.ts` 双重钉住 | ✅ | `.tmp/fullpage-shots/opportunities-miw55-fullpage.png` |
| D10 | MIW-56 mip-dialog 确认键实机验证：AI 语音页 review 态触发删除弹窗，「继续编辑」「删除」两键文案均渲染（修复前确认键为空白）； 云端 ACTION_NOT_FOUND 区分已部署（B5） | ✅ | `.tmp/fullpage-shots/voice-dialog-miw56.png` |
| D11 | MIW-56 完整录音流（真实麦克风录音→确认→草稿生成） | ⏳ | 需真机麦克风与真实 AI provider 配额；组件修复已由合同测试 + D10 覆盖 |
| D12 | 完整运行时路由验证 `pnpm test:runtime`（DevTools automator 驱动真实产物，58 路由）：6 代表态全过、2 条交互旅程（opportunity-search-and-filter / profile-content-tabs）全过、`mip-events/detail` 与 `mip-public-profile` 在修复后整跑 PASS；剩余 6 页未达标全部为既有归因——managed-events（需 Web 登录，设计如此）+ event-console/event-registrations（其 fixture 依赖）+ mip-access（登录拦截夹具）+ mip-ai/voice（MIW-34 记录的 ASR 能力门控，按设计落 error）+ mip-cases/detail（external-wait：harness 从「我的」页采样 cases 数据的时序竞争，页面代码本批零改动、合同测试覆盖，需下批观察是否复现）。注：代表态校验在「复用被重度驱动的 automator 会话」时会稳定抖动（WXML 取证 4s 窗口），runner 自管会话（IDE 退出后直跑）即恢复，已连续两轮复现该规律 | ⚠️ | `.tmp/runtime/report.json` |

## E. 端到端验收发现并修复的回归（本批新增提交）

| # | 项 | 说明 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| E1 | MIW-55 公开档案聚合 500 | `getPublicProfileAggregate` 的 typeKeys 投影把 mysql2 JSON 列过 `jsonObject`——它对数组与 NULL 的兜底都是 `{}`（对象），`.filter` 抛 TypeError 崩掉整个请求；实机稳定复现（真实 profileRef → 「机会服务暂时不可用」），回滚到合并前版本即恢复，定位为云端改动引入。修复：新增 `common.arrayOrEmpty`（数组/双编码字符串/NULL 三态收口），投影改用它；附 SQL 指纹假库回归测试（NULL 行不崩、数组与双编码行照常投影）。修复后重新部署并实机复测：`state: ready`、6 张合作卡 | ✅ | commit `b1218e13`；`[mip-cloud-deploy] verified mip-opportunities-api`；automator 复测输出 |
| E2 | MIW-53 详情页敏感数据回退 | 主办方资料卡下线时未把 `organizer` 移出页面数据，原始 `cloud://` 头像引用重新落入 data，运行时验收敏感值断言失败（`event.organizer.avatarUrl` 命中 `cloud://` 模式）。修复：`normalizedEvent` 剥离 organizer 再 setData。修复后整跑中该页 PASS | ✅ | commit `b1218e13`；automator 复测 `event.organizer ABSENT`；最终轮 `mip-events/detail PASS` |

## F. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| F1 | 本批 1 个迁移（102）；回滚 = 回退 5 个云函数代码版本（云端保留历史版本）+ 静态托管前缀旧资产（未删除）+ 迁移 rollback 脚本 `database/mysql/mip/rollback/102_event_organizer_introduction.sql` + Cloudflare 不动 | ✅ | B1–B7 与 C2 事实 |
| F2 | 函数无新增 timer/权限/客户端调用；部署产物不含环境 ID、身份值或密钥（每次部署均有 no-persist 声明）；安全规则收敛检查随部署与 cloud:verify 通过 | ✅ | 部署脚本终检输出 |

## 真机/后续待验清单（⏳ 汇总）

1. Cloudflare Pages 边缘部署（同上批：待 wrangler 浏览器授权或 `CLOUDFLARE_API_TOKEN`）。
2. 管理后台真实登录后配置某活动「主办方介绍」，回扫码端验证详情页同内容展示（C6 + D6 闭环）。
3. MIW-56 真实录音流（真机麦克风 + AI provider 真配额）与 MIW-52 心动值微信订阅消息提醒（订阅消息类必须真机）。
4. 支付/手机号能力本批未触及，不适用。
5. 观察项：`mip-cases/detail` 的 harness fixture 采样时序竞争（D12）是否在后续批次复现；复现则按「列表加载合同测试」要求补 profile 作品集加载的运行时合同断言。
