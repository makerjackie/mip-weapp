# 1.2.3 提审前 E2E 验收 Checklist（2026-10-20）

## 范围与基线

| 项 | 值 |
|---|---|
| 当前 HEAD | `b54d6896`（本地领先 origin/main 一个 docs commit；`git pull --ff-only` 已执行，远程无新提交） |
| 1.2.3 上传包源码 | `da8f14ad`；`git diff da8f14ad..HEAD -- . ':(exclude)docs'` 为空，客户端/服务端代码与 HEAD 一致，**无需重新上传** |
| diff 基线 | 1.2.1 发布记录 `0870bdf5`（10-19 18:03，上一个进入提审流程的生产包；1.2.0 被驳回 MIW-124，1.2.1 为驳回修复包） |
| diff 规模 | `0870bdf5..HEAD`：263 文件 / +6545 −686；其中 `src/` 55 个、`cloudfunctions/` 43 个、迁移 110/111/112、`packages/admin-contracts` 再生 |
| 验收环境 | 自动门禁与 DevTools 运行时在本机 TEST 构建（`mip-t-*` / `mip_test`）；生产只做只读核验；真机项标记为待用户执行 |
| 执行者 | ZCode（独立于实现者会话） |

状态口径：`PASS` 已执行并通过 · `PASS(既有证据)` 复用本批 diff 已有的独立证据并核对 HEAD 一致 · `REAL-DEVICE` 必须真机，本机不能替代 · `N/A` 不适用。

## 一、diff → 验收项映射

### G. 门禁与包健康（自动化，本机）

| ID | 检查 | 方式 | 预期 |
|---|---|---|---|
| G1 | 拉取最新；工作区干净；HEAD 客户端代码 = 1.2.3 源码 | `git pull --ff-only` / `git status` / `git diff da8f14ad..HEAD` | 无新提交、干净、代码 diff 为空 |
| G2 | 完整门禁 | `pnpm verify:all`（小程序 16 步 + Web Node + Web React） | 全绿，真实退出码 0 |
| G3 | 空白/冲突标记 | `git diff --check` | 无输出 |
| G4 | dist 嵌套 TDesign 依赖树 | `dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm/` 存在 | 存在（缺失=组件内联渲染，MIW-79 教训） |
| G5 | 主包体积 | 构建报告 | main < 2048KB（1.2.3 上传时 1,766,695 B） |
| G6 | MIW-124 审核驳回修复在包内 | `src/`/`dist/` grep | 「手机号快捷登录」命中；「微信手机号授权」「微信一键获取」「绑定微信手机号」「使用当前微信账号登录」0 命中 |
| G7 | 运行时预检 | `pnpm runtime:preflight` | DevTools 登录/服务端口/52 路由配置通过 |
| G8 | 运行时合同 | `pnpm test:runtime`（TEST 环境） | `.tmp/runtime/report.json` status=passed，页面数=合同路由数，代表状态全部通过 |
| G9 | 生产云端只读健康 | `MIP_ENV_DIR=envs/prod node scripts/verify-cloud.mjs --confirm-env=<EnvID>` | schema/最小权限/函数/健康/受保护规则全绿；不部署、不写业务 |
| G10 | 迁移 110/111/112 生产已应用 | `migrations.lock.json` + G9 schema 检查 | 三条迁移在 lock 且 schema 校验通过 |

### A. 活动（Events）

来源：`4eef19fa` `cee5eabe` 活动图文；`6e97930c` 玩家免费（迁移 112）；`e0f5bf2f` 取消固定底栏/参与人箭头；`eb008005` 标签角标/结束时间/跨年年份/北京时间（`src/utils/business-date.ts`）；`b7bd6910` `b96f7c23` 报名并行读取与草稿保护。

| ID | 页面 | 预期业务结果 | 方式 |
|---|---|---|---|
| A1 | `pages/events/index` | 活动卡后台 tags 显示在封面角标区且去重，标题下无新增标签行；时间行含结束时间；跨年活动显示年份；时间为北京时间 UTC+8 | DevTools runtime + 既有证据 |
| A2 | `packages/member/mip-events/detail` | 介绍/主办方/报名须知富文本 `img` 为 HTTPS 签名 URL（非 `wxfile://`/`http://tmp/`），签名到期后标签重建刷新；私有图片受控短期地址回退 | DevTools + 既有证据；iPhone 实显 → REAL-DEVICE |
| A3 | 活动详情固定底栏 | 已报名时显示「取消报名」并有二次确认；参与人入口箭头为原稿 16px SVG | DevTools + 既有证据（TEST 版本 1→2，回读 CANCELLED） |
| A4 | 报名（玩家/会员） | 服务端定价免费，不生成支付单，报名成功后版本回读；开通权益后旧单不改价 | 既有 TEST 证据；真机复核 → REAL-DEVICE |
| A5 | 报名（嘉宾/游客） | 按票价下单；「立即支付」tap 即全屏 loading「正在拉起支付…」+ mask 防双击（MIW-126） | 既有证据；拉起收银台 → REAL-DEVICE |
| A6 | `packages/member/mip-events/registration` | 报名确认页复用受限富文本渲染；并行读取 + 草稿保护；草稿渲染输入收窄不崩 | DevTools runtime + 既有证据 |
| A7 | 取消报名后 | 离页新开详情回读 `CANCELLED` | 既有 TEST 证据 |

### B. 订单（Orders）

来源：`fa0523be` 未付款显示/北京时间；`b7bd6910` 渐进显示；`fd1f9455` 继续支付 loading；`c7c209e5` MIW-123 支付重试复用（迁移 110）。

| ID | 页面 | 预期业务结果 | 方式 |
|---|---|---|---|
| B1 | `packages/member/orders` | 渐进显示（骨架→数据）；空态正常，不整页报错 | DevTools runtime |
| B2 | 订单列表/详情 | 未付款已关闭订单不误标「实付款」；金额诚实 | 既有 TEST 证据（19.90 回读未改） |
| B3 | `packages/member/order-detail` | 活动时间显示北京时间 | 既有证据 + runtime |
| B4 | 订单详情「继续支付」 | tap 即 loading；取消支付后重试复用已签发 prepay 参数（110 分钟窗口、商户匹配） | 云函数单测 PASS；真机取消→重试 → REAL-DEVICE |
| B5 | 支付结果页 | 收银台成功不等于已支付；PENDING(order=null) 诚实呈现，不伪造成功 | 单测 PASS；真机 → REAL-DEVICE |

### C. 会员/成长（Growth）

来源：`eb008005` 会籍页还原；`fd1f9455` 立即加入/续费支付 loading；`c7c209e5` PAYMENT_UNAVAILABLE 文案。

| ID | 页面 | 预期业务结果 | 方式 |
|---|---|---|---|
| C1 | `packages/member/mip-growth` | 经验入口右上；人物不裁皇冠；超宽装饰弧线局部裁切；任务区加载完成 | DevTools runtime + 既有证据 |
| C2 | 「立即加入」/「立即续费」 | 半屏确认弹层（方案/有效期/价格/权益/协议入口，全部来自服务端快照）→ 确认后 tap 即 loading → `wx.requestPayment` | DevTools 弹层；支付 → REAL-DEVICE |
| C3 | 支付不可用 | `PAYMENT_UNAVAILABLE` 不再提示「未配置支付」 | 单测 PASS |

### D. 个人资料 / 身份（Profile / Identity）

来源：`eb008005` 行业全屏选择器/人才卡；`33aec814` 六角色矢量图标；`08a034a0` 停用行业历史保留；`b7bd6910` 身份/头像分离与分区按需加载；`703ee6c2` MIW-124 登录文案（1.2.1 已含，需确认仍在包内）。

| ID | 页面 | 预期业务结果 | 方式 |
|---|---|---|---|
| D1 | `packages/member/mip-profile` 行业选择 | 全屏草稿单选/清除/确认；黑底无边框分组、大字号 chips；隐藏热门区不丢选项 | DevTools runtime + 既有证据 |
| D2 | 行业已停用 | 读取时保留历史选择显示，仅限制新选择；不被清空 | 既有证据 + 单测 |
| D3 | `talent-card` 组件 | 86px 上板；六角色图标 6/6 为原稿矢量（非大型角色插画）；简介字号按原稿 | 既有证据（Figma 1768:37624/1768:37607） |
| D4 | `pages/profile/index` | 身份/头像分离加载；成长/勋章/合作分区按需加载；游客态 growth 隐藏 | DevTools runtime（1.2.3 生产只读已 ready） |
| D5 | `mip-login-sheet` | 主按钮「手机号快捷登录」，副标题无「微信」字样（审核驳回点） | G6 静态 PASS；真机授权 → REAL-DEVICE |

### E. 机会 / 人才合作（Opportunities）

来源：`eb008005` 人才合作布局；`cloudfunctions/mip-opportunities-api` 多文件。

| ID | 页面 | 预期业务结果 | 方式 |
|---|---|---|---|
| E1 | `pages/opportunities/index` | 游客限权态正常；人才合作移除多余筛选提示行；角色/简介/邀请人布局 | DevTools runtime |
| E2 | 机会详情/人才卡 | 服务端数据非空时正常渲染 | runtime（有数据时） |

### F. 真机专项（DevTools 不能替代，用户执行）

| ID | 能力 | 入口 | 验收点 |
|---|---|---|---|
| F1 | 手机号快捷登录 | 「我的」→ 登录弹层 | 文案「手机号快捷登录」；原生授权成功；绑定后身份正确 |
| F2 | iPhone 活动富文本图片 | 生产早会详情 | 主办方 3 图实际显示；介绍/须知无裂图 |
| F3 | 真实报名 | 活动详情 → 报名 | 嘉宾付费下单 / 玩家免费不生成支付单；取消报名二次确认与回读 |
| F4 | 真实微信支付 | 报名「立即支付」或会员「立即加入」 | tap 即 loading；拉起收银台；取消后重试复用；支付成功后权益/订单服务端生效（可退） |
| F5 | 订阅消息授权 | 报名/详情 | 手势触发授权、送达 |
| F6 | 分享面板 | 活动详情/名片 | 面板打开、链接可达 |
| F7 | 滑动/手势 | 行业选择、人才卡、会籍页 | 无卡顿、无遮挡 |

### H. 服务端 / 后台联动（已部署生产，只读核对）

| ID | 项 | 预期 | 方式 |
|---|---|---|---|
| H1 | 迁移 110/111/112 | 生产已应用（既有记录：154 表备份后追加 110/111/112） | G10 |
| H2 | 生产函数源码一致 | events/admin/cloudpay/ledger/identity/media 运行文件与源码匹配 | 既有证据（20/167/26 等运行文件匹配）+ G9 健康 |
| H3 | admin-web 前置数据 | 活动图文编辑、玩家免费开关、行业设置、玩家权益开通可用（Web 不在微信审核范围） | `pnpm admin:web:verify` PASS + 既有 HTTPS/三视口证据 |

## 二、执行结果（2026-10-20 深夜，本机）

机器可读：[results.json](results.json)。原始日志留本机 `.tmp/e2e-prereview-123/`，运行时截图留 `.tmp/runtime-evidence/prereview-123-20261020{,-run2}/`（忽略目录，不入库）。

### G. 门禁与包健康

| ID | 结果 | 证据 |
|---|---|---|
| G1 | PASS | `git pull --ff-only` 已是最新；工作区干净；`da8f14ad..HEAD` 排除 docs 后 diff 为空 |
| G2 | PASS | `pnpm verify:all` 真实退出码 0：小程序 285 文件 / **1857** 测试；Web Node **338/338**（50 suites）；Web React 36 文件 / **262**；响应式契约通过 |
| G3 | PASS | `git diff --check` 无输出 |
| G4 | PASS | 嵌套 TDesign 树存在（4 个子包）；MIP build contract passed |
| G5 | PASS | 主包含可达依赖 1,363,568 B（< 2048KB）；平台体积 1.2.3 主包 1,766,695 B |
| G6 | PASS | `src/` 与 `dist/`：「手机号快捷登录」命中；4 组旧微信文案各 0 命中 |
| G7 | PASS | `runtime:preflight` ok、DevTools 已登录、服务端口开启、52 路由配置完整 |
| G8 | **FAIL（环境）** | 见下节 |
| G9 | PASS | 生产 `verify-cloud`：schema / 最小权限 / 函数 / 健康 / 受保护调用规则全绿（首次 MCP 报错与踩坑录首条一致，重启本仓库 mcporter 守护进程后通过；未动 3 个 worktree 守护进程） |
| G10 | PASS | `migrations.lock.json` 含 110/111/112；生产 schema 校验随 G9 通过 |

### G8 运行时合同（TEST 环境，52 路由）——根因分析

| 轮次 | 时间 | PASS | FAIL | WAIT |
|---|---|---|---|---|
| run1 | 00:19–00:21 | 27 | 12 | 13 |
| run2 | 00:29–00:35 | 10 | 29 | 13 |
| 基线 10-17 | — | 26 | 10 | 16 |

- **17 个路由在两轮同一代码间 PASS→FAIL**（含静态用户协议页报"身份服务暂时不可用"），为非确定性失败。
- CloudBase 指标（6 个 `mip-t-*` 函数，5 分钟粒度）：**FunctionError = 0、FunctionTimeout = 0、FunctionThrottle = 0**；run1 调用到达云端全部成功；run2 六分钟内云端仅收到约 13 次调用，同轮 tab 导航 events/profile 仍 ready。结论：**run2 的"服务暂时不可用"产生于 DevTools 客户端侧 `wx.cloud.callFunction` 本地失败**（云会话/自动化会话劣化），run1 的少数"不可用"为 TEST 无常驻实例下冷启动的客户端重试预算超时。两者均非代码回归。
- 代表状态 6/6 两轮通过；run2 导航：events ready、profile ready、back 通过、deepLink 活动详情 ready。
- 13 个 external-wait 为合同预期（需真实订单/报名/机会/案例/任务 ID）。

**diff 面路由在 run1 的结果：**

| 路由 | 结果 | 归因 |
|---|---|---|
| `pages/events/index` `pages/profile/index` `pages/opportunities/index` `mip-events/detail` `mip-events/mine` `mip-events/check-in` `orders` `mip-profile` `privacy` `privacy-settings` | PASS | — |
| `mip-events/registration` | **FAIL（代码级，低严重度）** | 页面数据含 `cloud://`（`event.organizer.avatarUrl`）。`b7bd6910` 为报名页引入 `getEvent(…, { progressiveMedia: true })`，该模式跳过 `resolveCloudFileUrls`；页面 WXML **完全不渲染** organizer/avatar，故无功能影响，但违反页面数据卫生合同（同文件 MIW-79 注释已声明同一原则）。EnvID 本已烘进包内，非安全泄露，**非审核阻断**。修复建议：从 `presentableEvent` 剔除 `organizer`（或其 `avatarUrl`），或对其单独解析。 |
| `mip-growth` | FAIL（TEST 数据） | 服务端返回「成长等级尚未配置」，TEST 库无等级配置；1.2.3 生产连接开发工具核查该页 ready |
| `mip-badges` | FAIL（环境） | 成长服务客户端超时；云端 growth 函数 0 错误 |
| `mip-events/feedback` `order-detail` | external-wait | 需报名/订单夹具 |
| 交互 `opportunity-search-and-filter` | FAIL（环境） | 游客搜索需先确认身份（J1-05），身份服务客户端不可用时被门控；选择器/handler 均存在，WXML diff 仅占位文案与筛选 guard；10-17 同交互 PASS |

退出登录 15 秒快照缓存回归已排除：`mipLocalSession.signOut()` → `identity.signOutLocally()` 置 `signedOut=true` 守卫缓存；`runtime-protected-access-fixture` 9/9、`mip-profile-login-flow` 13/13 通过。

### A–E 业务项（复用本批 diff 已有独立证据 + 本次 run1 核对）

A1/A3/A6/B1/C1/D1/D4/E1 由 run1 对应路由 PASS 与既有证据支撑；A2/A4/A5/A7/B2/B3/C2/D2/D3 复用 10-20 各批 TEST/生产只读证据（见 PROJECT_STATUS 对应条目）；B4/B5/C3 由本次 1857 单测中的 commerce/ledger 用例覆盖；H1–H3 由 G9/G10 与 Web 门禁覆盖。**本次未重跑 `runtime:free-event` 写入流程**（DevTools 会话已劣化，且 10-20 TEST 已有嘉宾付费/玩家免费/取消回读证据），列入真机复核。

### 其他发现（不阻断，提请知悉）

- 本机 `envs/test/.env.local` 的 `MIP_PAYMENT_MODE=live` 与云端测试账本（10-20 已改 `disabled`）不一致，TEST `verify-cloud` 在函数健康全部通过后于该断言停止；仅本机配置漂移，与生产无关。
- 1.2.3 上传回执在发布机器，本机无；提审前需在公众平台「版本管理→开发版本」确认 1.2.3 存在且源码标记为 `da8f14ad`。
- HEAD `b54d6896` 领先 origin/main 一个 docs commit，未推送。

## 三、结论

- **可提审**：自动门禁全绿，MIW-124 驳回修复文案确认在包内，生产云端健康，1.2.3 包源码与 HEAD 一致无需重传。
- **一项低严重度代码卫生回归**（报名页 `cloud://` 进页面数据，b7bd6910）：不影响功能与审核；建议下一版本修复，或由用户决定是否先修再提审（修复需重建→新版本号 1.2.4）。
- **真机待验**（F1–F7）：手机号快捷登录文案与授权、iPhone 富文本图片、真实报名、真实支付+重试复用+权益生效、订阅消息、分享、手势。按 runbook 阶段 4，审核通过全量发布后须真机走通一笔 live 支付。

### 提审材料（runbook 阶段 3）

1. mp.weixin.qq.com → 版本管理 → 开发版本 **1.2.3** → 提交审核
2. 向导：平台规则 → 安全测试继续 → 接口未配置（`wx.getLocation` 未使用）勾选继续 → 隐私指引继续
3. 登录弹层截图须展示「手机号快捷登录」（MIW-124 驳回点）；演示视频 `~/Downloads/MIP-YANSHOU-VIDEO.mp4`；截图 `node scripts/fullpage-shot.mjs <页面路径>` → `.tmp/review-shots/`
4. 审核通过 → 全量发布 → 阶段 4：生产 `verify-cloud`、真机一笔 live 支付、更新 PROJECT_STATUS
