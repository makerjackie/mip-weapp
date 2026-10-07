# MIW-34..40 批次验收 Checklist（2026-10-06）

本批次覆盖 7 个 review 状态任务合并、部署与端到端验收：MIW-32、MIW-34、MIW-35、MIW-36、MIW-38、MIW-39、MIW-40（MIW-37 已在上一批关闭；本批编号跳过它）。
部署目标为 `.env.local` 指定的 CloudBase 环境（staging，下文以 `<EnvID>` 指代）。

图例：✅ 本轮已验证 · ⏳ 需真机/人工登录后验收 · ➖ 不适用本轮

## A. 合并与门禁（全批共用）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 7 个任务工作全部提交：MIW-38（我的活动两 tab + 取消胶囊）、MIW-39（日历筛选器）在 worktree 内新提交 `7c4d58d6`/`44de6a73`；MIW-35/36/40 已有提交 `cf6fab4d`/`8464ce19`/`280b0b9d`；MIW-32/34 工作此前已在 main（`050d8f5c`/`7b0602a9`） | ✅ | git log 各分支 |
| A2 | 5 个分支按序合并 main，冲突已解决（PROJECT_STATUS 两处、mip-events module.ts 双函数并存、profile wxml 注释保留） | ✅ | merge commits `6e6c14f7`/`cac193af`/`fb1f7de6`/`459bd82f`/`1aeacda8` |
| A3 | `pnpm verify:all` 全绿（小程序全门禁 + admin-web lint/类型/164 项 React 测试/构建/响应式合同） | ✅ | exit 0；Test Files 27 passed (27) |
| A4 | `git diff --check` 干净；main 已推送 origin | ✅ | `cfae2294..1aeacda8 main -> main` |
| A5 | Notma 任务状态：7 张卡全部 done，各附批次收尾评论 | ✅ | task move done ×7 |

## B. 数据库与云函数部署

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 本批零数据库迁移、零 schema 变更（cfae2294..1aeacda8 不触 `database/`）；迁移 dry-run 无待应用项 | ✅ | `git diff --name-only cfae2294..HEAD -- database/` 为空 |
| B2 | MIW-35 运行时权限收敛：`mip_membership_plans` 增 UPDATE 后 `exact mip_* runtime grants verified` | ✅ | deploy 输出 `converged`/`reused` |
| B3 | `mip-admin-api`（MIW-35 会员方案 list/save）部署 + 健康检查证明 MySQL 持久化 | ✅ | `verified mip-admin-api`（API Key STS 拒绝 InvokeFunction 后按 AGENTS §8 切 Device Flow 本机登录态完成） |
| B4 | `mip-events-api`（MIW-36 心动 helper 收敛 + MIW-39 calendarDates）部署 + 健康检查 | ✅ | `verified mip-events-api` |
| B5 | `pnpm cloud:verify`：schema、最小权限、函数健康、受保护调用规则全部通过 | ✅ | `verified` |
| B6 | 匿名身份门控：`mip.events.calendarDates`（新公开 action）与 `mip.events.list` 匿名调用均返回结构化 `ok:false AUTH_REQUIRED`，无运行时崩溃 | ✅ | invoke RetMsg 结构化拒绝 |

## C. 管理后台（admin-web）部署与 HTTPS 验收

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | 真实模式构建（`VITE_MIP_ADMIN_DEMO_MODE=false`）并上传静态托管隔离前缀 `mip-admin-console/`，逐文件 SHA-256 回读一致（部署脚本自带的 downloadDirectory 回读因 MCP 响应结构变化失真，改用逐文件 downloadFile 等效校验：14/14 一致；`_headers` 为脚本约定跳过项） | ✅ | per-file sha256 pass=14 fail=0 |
| C2 | BFF 函数 `mip-admin-web-api` 重新打包部署 | ✅ | active、0 timer、客户端调用关闭、Cloudflare 不变 |
| C3 | 真实 HTTPS：`/` 200 HTML 引用新入口 `index-DMDusKyA.js`（与本地构建同名同大小 457226B、MIME `text/javascript`）；缺失资产严格 404 不回落 SPA | ✅ | HTTP 200/200/404 |
| C4 | API 防护：非信任 Origin 登录 403「请求来源无效」；可信 Origin + 错误密码 401 INVALID_CREDENTIALS（打到 MySQL 认证存储） | ✅ | HTTP 403 / 401 JSON |
| C5 | 会员方案页签真实改价链路（list/save + 元↔分换算 + 乐观锁冲突提示） | ⏳ | 本机未配置 `MIP_ADMIN_TEST_PHONE/PASSWORD`；React 面板测试与服务端 domain 测试已绿，建议配置账号后人工走查或跑 `verify-admin-cloudbase.mjs` |

## D. 小程序端（weapp）

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| D1 | `pnpm setup:local` 重生成 DevTools conditions（补 MIW-34 新路由 `packages/member/mip-ai/voice/index`）后 `pnpm runtime:preflight` 全绿（真实 AppID、登录态、服务端口） | ✅ | preflight ok:true |
| D2 | 微信开发者工具对合并后代码完整重新编译并出预览包（CLI preview）无错误 | ✅ | `✔ preview`（AppID wx2705…；首次因 QR 输出路径与 IDE 编译服务抖动各重试一次） |
| D3 | 运行时路由验收 `pnpm test:runtime`（DevTools automator 驱动真实产物，70 路由） | ⚠️ | 44 passed / 16 failed / 10 external-wait。本批改动页面全部通过（机会 mine/editor、参与人、合作/案例/成长/经验值/通知/心动/人脉等）；16 个失败均与本批代码无关：7 页为 DevTools 账号头像 URL 含类手机号数字触发敏感值扫描（账号数据问题）、3 页盲盒+1 页游戏为 guest 身份 forbidden/error、录音页为 MIW-34 已知能力门控未开放、admin 工作台需 Web 确认登录、2 页夹具依赖（profile-interests、登出控制流）。详见下「运行时失败归因」 |
| D4 | MIW-38 我的活动：仅 待参加/已参加 两 tab、点卡进详情、右下角黄色「取消报名」胶囊、无修改报名/查看订单按钮 | ⏳ | 合同测试改判通过（旧入口断言反向）；真机视觉与取消链路待扫预览码走查 |
| D5 | MIW-39 日历筛选器：右上角日历 icon 打开月历、确定后筛选并在右上角显示「今天/M月D日」、有活动日期黄点 | ⏳ | 服务端谓词已按 D6/B6 验证；真机交互待走查 |
| D6 | MIW-39 黄点数据源（真实库）：10–11 月窗口无黄点（无未结束已发布活动）；2030-09..12 窗口命中 4 个活动日期 09-05/10-10/11-14/12-12（+8h 业务日） | ✅ | runQuery 直查与 `listEventCalendarDates` 同谓词 |
| D7 | MIW-32/36 心动夹具（真实库）：演示互动活动 5 条 ATTENDED 报名、2 条 ACTIVE 心动在位；种子脚本幂等保护生效（已存在即拒绝重写） | ✅ | runQuery 计数 + seed 脚本 validate-only `{"valid":true}` |
| D8 | MIW-36 详情页缓存窗口与心动计数同源（详情胶囊 = 参与人页 tab = getHeart counts） | ⏳ | 服务端/模块测试已绿；已签到账号真机往返详情↔参与人页待验 |
| D9 | MIW-40 机会发布人订阅引导：两段式弹层、24h/3 次节奏、模板键缺失不渲染 | ⏳ | policy/组件/时机 373 项新增测试绿；模板 ID 未配置（W26 待甲方），真机触达 external-wait |
| D10 | MIW-34 AI 录音：录音页、分段续录、直传云存储、Flash ASR 转写 | ⏳ | 代码已合并、编译通过；ASR 密钥未配置到云函数环境变量，录音权限/帧回调仅真机可验 |

## E. 回滚与安全

| # | 验收项 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | 本批无迁移，回滚即回退函数代码版本（云函数保留历史版本）与静态托管前缀旧资产（未删除） | ✅ | B1/C1 事实 |
| E2 | 部署产物不含环境 ID、身份值或密钥；函数无新增 timer/权限/客户端调用 | ✅ | 部署脚本终检 + BFF 输出 `clientInvocation:false, timers:0` |

## 运行时失败归因（D3 补充）

16 个 failed 路由逐项归因，均非本批代码引入：

1. **敏感值扫描 ×7**（pages/profile、member/mip-profile、mip-badges、mip-card、mip-card-edit、mip-received、mip-public-profile）：DevTools 登录账号的 `avatarUrl` 含类手机号数字串，被 `raw-phone-like` 扫描命中。属测试账号数据条件；本批未触碰头像链路。建议更换测试账号头像或为云文件 ID/URL 形态放宽扫描白名单。
2. **权限/能力门控 ×5**：mip-blind-box ×3 与 mip-game 为 guest 身份 forbidden/error（需玩家权益）；mip-ai/voice 为 MIW-34 记录在案的能力门控未开放（ASR 密钥未配置到云函数）；packages/admin/managed-events 需网页登录确认身份。
3. **夹具依赖 ×2**：mip-profile-interests 未达可接受态（缺真实互动夹具）；「受保护访问夹具登出控制」未进入访问流。

external-wait ×10 为既有的真机/外部依赖项（支付、订阅触达等），口径不变。

## 遗留与后续

- C5、D4–D5、D8–D10 为需人工/真机/测试账号的验收项，完成后在本文勾选补充。
- `deploy-admin-cloudbase-static.mjs` 的 downloadDirectory 回读与新版 MCP 响应结构不兼容（findFiles 文件清单移入 `result.Contents`），建议单独小卡修复脚本读法。→ 已由 MIW-46 修复并实机验收，见 `docs/testing/MIW-46_ADMIN_STATIC_READBACK.md`（另发现并补偿了 downloadDirectory 并发静默丢文件问题）。
- CloudBase API Key 临时 STS 本轮拒绝 InvokeFunction（Cam authentication failed），已按 AGENTS §8 切本机 Device Flow 完成部署；若复现频繁建议检查环境级 API Key 权限策略。
- MIW-30（勋章迁移部署顺序）、MIW-41（通知链路走查）不在本批范围，状态未动。
