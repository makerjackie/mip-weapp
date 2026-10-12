# MIW-65..69 批次验收 Checklist（2026-10-12）

本批次覆盖 5 个任务合并、部署与端到端验收：MIW-65（下线会员三页，等级页成为唯一会员开通面）、MIW-66（AI 语音草稿超时预算与错误分类）、MIW-67（机会发布人订阅消息投递分支）、MIW-68（勋章未获授置灰）、MIW-69（名片字段上卡、设计对齐、背景图与头像更换）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging：`cloud1-d2gm0vloa9e1b4f31`）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ⚠️ 有条件通过（已归因） · 🚫 环境阻断（CloudBase 账户欠费，待充值） · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 5 个任务工作全部提交：MIW-65 `c0d938ec`（40 文件 +566/−1652）、MIW-66 `d3bba363`（18 文件 +374/−28）、MIW-67 `fa23e1cf`（7 文件 +73/−19）、MIW-68 `8efdeeb4`（4 文件 +21/−1）、MIW-69 `d3e7ae33`（12 文件 +264/−30）；提交后各 worktree 干净 | ✅ | 各分支 `git log`/`git status` |
| A2 | 5 个分支按序合并 main：MIW-66/67 无冲突；MIW-65 在 `packages/member/membership-order/index.wxml` 出现 modify/delete 冲突（main 侧 MIW-64 仅样式改动、本分支整页删除，按删除解决）；MIW-68/69 无冲突。merge commits：`053cfcfb`/`95968616`/`f007ced9`/`dcdb1621`/`f2420f14` | ✅ | merge commits |
| A3 | `pnpm verify:all` 两轮全绿（合并 MIW-65..67 后一轮、合并 MIW-68/69 后最终一轮）：小程序 verify（lint/stylelint/typecheck/构建/预算/server contract 707 源文件/vitest 全量）+ admin-web verify（lint + 类型 + 27 文件 164 项 React 测试 + 构建 + 响应式合同） | ✅ | 两轮后台任务退出码均 0 |
| A4 | `git push origin main`：`89e00401..f007ced9`、`f007ced9..f2420f14` | ✅ | push 输出 |
| A5 | Notma 任务状态：MIW-65..69 五张卡全部 done（MIW-66 由任务 AI 会话自行置 done，其余经本地看板 API `PATCH /api/tasks/{id} status=done` 确认 ok） | ✅ | 看板回读 5/5 done |
| A6 | `git diff --check` 干净；本批零数据库迁移（`git diff 89e00401..HEAD -- database/` 为空） | ✅ | 空 diff |

## B. 云函数部署（staging，CLOUDBASE_AUTH_MODE=local）

首次部署因项目 MCP 守护进程缓存 API Key STS（Invoke 被 CAM 拒绝）失败；按 AGENTS §8 在该次进程设置 `CLOUDBASE_AUTH_MODE=local` 并 `restartCloudbaseMcp` 复用本机 Device Flow 登录态后完成，未发起新授权、未扩大权限。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | `mip-banners-api` 部署 + 验证（MIW-65 allowlist 移除 `pages/membership/index`） | ✅ | `[mip-cloud-deploy] verified` + health `persistence=cloudbase-mysql` |
| B2 | `mip-notifications-api` 部署 + 验证（MIW-67 OPPORTUNITY_NOTICE 模板字段契约） | ✅ | `verified` |
| B3 | `mip-notification-worker` 部署 + 验证（同上契约） | ✅ | `verified` |
| B4 | `mip-outbox-worker` 部署 + 验证（MIW-67 projector 合作/机会感兴趣 → `WECHAT_SUBSCRIPTION` 投递分支） | ✅ | `verified`；云函数测试 295 项绿 |
| B5 | `mip-ai-api` 部署 + 验证（MIW-66 显式 SDK 超时 + 新错误分类透传） | ✅ | `verified` |
| B6 | `mip-ai-draft-provider` 更新：本机 `.env.local` 缺 `OPENAI_API_KEY`/`TENCENT_ASR_*`，整函数重部署会清掉线上语音/ASR 配置，故走代码包更新 + Timeout 20s→60s 的最小控制面链路；线上 11 个环境变量键集合前后一致、值未读取未改动；代码默认语音预算 20s（`normalizeVoiceTimeout` 兜底）随新代码生效 | ✅ | 更新前后 GetFunction 回读 Timeout 20→60、env 键集合不变；Status Active |
| B7 | `mip-identity-api` 部署 + 验证（MIW-69 名片头像资产校验） | ✅ | `verified` |
| B8 | `pnpm cloud:verify`：schema、最小权限 grants、函数健康、受保护调用规则全部通过 | ✅ | `[mip-cloud-verify] … verified` |
| B9 | 部署产物不含环境 ID、AppID、数据库 URI 或密钥 | ✅ | 每函数部署终检输出 |

## C. 管理后台（admin-web）

本批 `git diff 89e00401..HEAD -- admin-web/` 为空（零源码改动）。按「全量部署」要求执行了静态发布；BFF 因本机缺 `MIP_ADMIN_AUTH_SCHEMA_OWNER`/`MIP_ADMIN_AUTH_DB_PASSWORD`/`MIP_ADMIN_AUTH_SESSION_SECRET`（历史由维护者交互提供）未重新部署，且其源码未变，线上继续由既有版本服务。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false`）+ `build-cloudbase.mjs` 产物就绪 | ✅ | `.tmp/admin-cloudbase-function/` 生成，入口 `index-CYFT5GuB.js` 458369B |
| C2 | 静态托管上传到隔离前缀 `mip-admin-console/`：上传动作成功，清单回读含本批入口资产 | ✅ | `deploy.private.json` upload success；listing 含 `assets/index-CYFT5GuB.js` 458369B |
| C3 | 目录下载回读：共享 CA 文件 `fileauth.txt` 顺序补读大小不符 → 脚本按设计失败退出 | ⚠️→🚫 | 归因见 C4：欠费 451 页顶替了文件内容，属环境阻断非上传失败 |
| C4 | 线上服务探测：静态域名与网关 origin 均 HTTP 451「Due to your account is arrears, it is unavailable until you recharge」；云存储临时 URL 下载同样 451 | 🚫 | curl 实测（admin.mip.cool、tcloudbaseapp.com、tcb.qcloud.la 均复现） |
| C5 | 管理后台 BFF `mip-admin-web-api`：源码未变，网关 `/api` 路由仍在（BFF 域名 404 归一化响应可达） | ➖ | gateway listRoutes：`/api -> mip-admin-web-api` |
| C6 | **行动项（维护者）**：CloudBase 账户充值后，重跑 `node scripts/deploy-admin-cloudbase-static.mjs --confirm-env=… --confirm-prefix=mip-admin-console/` 完成回读闭合；证书续期任务若依赖同 CDN 下载亦需复查 | 🚫 | 本节 C3/C4 |

## D. 小程序端（weapp，微信开发者工具实机）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm build` 最终 main 出包；`pnpm runtime:preflight` 全绿（真实 AppID、登录态、服务端口 62842、compileHotReload、appRoutesComplete） | ✅ | preflight ok:true, missing routes [] |
| D2 | `pnpm test:runtime` automator 全路由验收 | 见 E2E 结果行 | 本文档 E 节 |
| D3 | MIW-65 会员三页下线：`pages/membership`、`packages/member/benefits`、`packages/member/membership-order` 不在 dist/app.json；等级页半屏确认弹层直接拉起微信支付；PENDING「入会审核中」无下单入口；邀请三载体落等级页 | ✅（合同/测试层） | verify:source/verify-build 断言改指 growth；1595 项 vitest 全绿；真机支付按惯例 ⏳ |
| D4 | MIW-66 AI 语音：provider 超时 60s、调用方显式传参、`AI_PROVIDER_TRANSCRIPT_EMPTY`（引导重录）/`TRANSCRIBE_FAILED`（可重试）分类 | ✅（服务端测试 + 部署回读） | 1615 项 vitest + provider 测试绿；Timeout 回读 60s；真实语音链路 ⏳（依赖线上 ASR，账号欠费影响出码链路时以真机复核） |
| D5 | MIW-67 订阅消息：弹窗触发链路本身无缺陷，模板 `OPPORTUNITY_NOTICE` 未在 `MIP_SUBSCRIBE_TEMPLATES_JSON` 配置时引导层按设计不渲染；outbox 投递分支已接（合作/机会感兴趣 → 订阅消息，降级口径不变，站内信无条件兜底） | ⏳（外部依赖） | 客户端 26 项 + 云函数 295 项测试绿；微信平台模板 W26 申请 + 模板 ID 配置 + 重部署后真机验证，见 G 节行动项 |
| D6 | MIW-68 勋章：未获授整枚置灰（列表 + 详情）、获授原色；佩戴往返全链路无错 | ✅（DevTools 实机） | 任务会话以真实云环境 + 铭龙账号实测通过；截图 `.tmp/miw68/`（6 张）；样式契约测试防回退 |
| D7 | MIW-69 名片：编辑保存即按「填了即上卡」推导可见性（实测 `save()` 后 `[false×4]→[true×4]`，四条联系行真实渲染）；卡面无性别行；样式缩略图 `aspectFill` 不再拉伸变形；「更换头像」端到端可用（chooseAvatar → AVATAR 资产上传 → updateCard，服务端校验本人 READY 资产） | ✅（DevTools 实机 + 真实后端） | 1600 项客户端 + 99 项 identity 云函数测试绿（新增 7 项）；截图 `.tmp/miw69/`（8 张） |
| D8 | MIW-69 已知边界：canvas 海报头像用云 fileID 无法 `createImage` 加载（回退首字圆形，页面 image 正常）；名片码需正式发布页面才能出码（重试入口保留） | ⚠️ | 任务报告记录，独立问题不阻断本批 |
| D9 | 体验版发布：发布前在发布 HEAD（`9f12c474`，含本文档）重跑完整 `pnpm verify:all` exit 0 + `pnpm build` 后，经已登录微信开发者工具 CLI 上传（本机 `MIP_WECHAT_CODE_UPLOAD_KEY_PATH` 私钥不存在，按 AGENTS §7 优先 DevTools 登录态通道） | ✅ | `cli upload -v 0.3.0` → `✔ upload`；包体 total 3.1 MB（main 1.7 MB / member 1.2 MB / admin 134.5 KB） |

## E. 端到端运行时验收（`pnpm test:runtime`，automator 驱动真实产物）

两轮巡检：第 1 轮完整（56 条路由）、第 2 轮自管会话复核（在 mip-blocked 触发既有会话抖动中断，中断前已复核全部批次页面）。两轮结论一致。

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 批内改动页面全部 PASS：mip-growth（新开通面）、mip-badges/mip-badge-detail（置灰口径）、mip-card/mip-card-edit（名片修复）、mip-opportunities/detail（订阅引导挂载点）、payment-result（MIW-65 仅改跳转 URL） | ✅ | 两轮各 51 页 PASS；`.tmp/runtime/report.json` + 截图 |
| E2 | 交互旅程 2 条（opportunity-search-and-filter / profile-content-tabs）全过 | ✅ | run1 interactions passed ×2 |
| E3 | 既有归因失败（与本批无关，两轮同口径）：`managed-events`（admin 工作台需 Web 确认登录，设计如此）、`mip-access`（登录拦截夹具）、`mip-ai/voice`（MIW-34 记录的 ASR 能力门控，按设计落 error）、6 条 external-wait（events detail/registration/participants、cases/detail、event-console/event-registrations 的真实夹具依赖） | ⚠️ | 与 MIW-51..56 批次 D12 归因一致 |
| E4 | `payment-result` 未在 20s 窗口落定：夹具采样到已支付的 2030 演示活动订单（EVENT），报名就绪轮询 6 次退避超出 harness 窗口；页面本体渲染正常（截图：支付已确认/订单已支付/五个动作按钮齐全），该重试分支在本批之前即存在，本批仅改 `openMembership` 跳转 URL（1 行）；归因：演示活动报名夹具缺失，非本批回归 | ⚠️ | 截图 `packages-member-payment-result-index.png`；`git show 89e00401` 已含 attempts>=6 分支 |
| E5 | 会话抖动已知项：代表态校验在被重度驱动的 automator 会话下抖动（run2 mip-blocked 重试中断），runner 自管会话即恢复（MIW-51..56 批次已记录同一规律） | ⚠️ | run2 WARN retry 日志 |

## F. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| F1 | 本批无迁移，无 schema 变更；回滚即回退函数代码版本与静态托管旧资产（未删除） | ✅ | A6 |
| F2 | provider 最小链路未触碰环境值，回滚仅需回传旧代码包并 UpdateFunctionConfiguration Timeout=20 | ✅ | B6 事实 |
| F3 | 部署全程未打印、未持久化任何密钥；provider 线上凭据零读取 | ✅ | B9 + B6 脚本设计 |

## G. 环境与外部依赖行动项

| # | 事项 | 责任 |
| --- | --- | --- |
| G1 | **CloudBase 账户欠费**：静态托管与云存储下载全部 451（管理后台网页、小程序 banner/头像/海报等媒体、证书续期回读均受影响）。充值后按 C6 复核静态回读并抽查小程序媒体加载 | 维护者 |
| G2 | ~~机会通知模板 W26 需在微信公众平台申请~~ **已闭环（2026-10-12，二次迭代）**：初版选用公共模板「职位感兴趣提醒」并上传体验版 0.3.1 后，按产品口径改绑自有模板「**合作邀请发起提醒**」（`R4g1Y…`，一次性订阅）——字段契约扩为 4 个 `title/initiator/status/receivedAt`（事件名称 thing1/发起人 thing2/备注 thing3/发起时间 time4），projector 投递载荷带表态用户昵称（缺名回退「有人」），两个通知函数 `templateFieldContracts` 同步；`f32b1026` 已合并推送，云函数 41 项相关测试绿，`mip-notifications-api`/`mip-notification-worker` 重部署回读一致，verify:all 全绿后体验版 **0.3.2** 已上传。剩余：真机弹窗/收信走查 | 维护者（真机） |
| G3 | 11 枚启用勋章 `image_url` 为空（笨笨系列/城主/公会长等），需运营在 Web 管理后台上传勋章形象（BADGE_IMAGE） | 运营 |
| G4 | 真机项：微信支付（会员开通新链路）、订阅消息弹窗与接收、AI 语音真实录音链路，按仓库惯例须真机复核 | 维护者 |
