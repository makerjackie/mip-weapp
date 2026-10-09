# 任务：修复机会模块审计问题 G1 / G3 / G4 / F1

你在 git worktree 分支上工作（基于 origin/main）。请先读仓库根目录 `AGENTS.md`（必读，含边界规则与完成门禁），再读本文档，按四个问题逐项修复。**只在本分支提交，不合并 main、不 push。**

设计稿参照图在本 worktree `design-refs/`（本目录） 下（Figma 2x 导出）：
- `14-想跟TA合作页.png`（G1 目标形态）
- `15-对TA感兴趣页.png`（G3 目标形态）
- `18-玩家档案-相关机会.png`（G4 目标形态）

完成后运行 `pnpm verify` 并保证全绿（本任务不改 admin-web，无需 admin verify），最后把四个问题各自的改动以独立 commit 提交（commit message 用 `fix(opportunities): Gx ...` 风格，F1 用 `fix(profile): F1 ...`）。不要提交 `.tmp/`。

---

## G1.【高】「+N想合作」跳转的「想跟TA合作」独立页面缺失

- 设计：`figma/14-想跟TA合作页.png` —— 机会详情页点「+N想合作」应跳转**独立二级页**，用 2 列竖版人才卡展示想合作的人，按时间从新到旧（入口仅在详情页，列表卡胶囊不承担跳转——产品裁决 2026-10-09）。
- 现状：详情页点胶囊只打开底部弹层（`t-popup`），内容是简单行卡（头像+昵称+一句话），不是竖版人才卡，也没有页面态。
- 代码：`src/packages/member/mip-opportunities/detail/index.wxml:101-116`（cooperators 弹层）、`index.ts:159`（`openCooperators`）。
- 服务端排序已按 `activated_at DESC`（`cloudfunctions/mip-opportunities-api/domain/opportunity-cooperations.js:77`），**只差 UI**。
- 实现要求：
  1. 新增独立页面（建议 `packages/member/mip-opportunity-cooperators/index`，路由带 `id`），页面标题「想跟TA合作」，返回入口 + `<app-page-exit>`。
  2. 列表用 `mip-talent-card layout="grid"`（2 列 grid），数据口径对齐 `mip-profile-interests` 页（Lv / 三标签 / 两行简介 / 勋章 / 邀请人），按服务端返回顺序展示（服务端已是最新在前），支持游标分页。
  3. 详情页胶囊点击从弹层改为 `caseNavigateTo` 跳该页面；原 t-popup 弹层及配套 data/方法清理干净（`loadCooperators` / `openTeamMember` 等迁移或删除，不留死代码）。
  4. 权限语义保持不变：数据走现有合作名单接口（服务端已做可见性/登录校验），页面加载失败有错误重试态，空态文案「暂无合作意向」。
  5. 更新/新增合同测试：旧弹层相关 pin（`mip-opportunity-journey-review` / `figma-surfaces` 等）同步为新页面契约；新页面加真实字段结构测试（参照 `mip-profile-interests` 的测试写法）。
  6. `app.json` subPackages 注册新页面。

## G3.【中】「对TA感兴趣」名单缺邀请人信息

- 设计：`figma/15-对TA感兴趣页.png` 每张竖版卡底部有「邀请人Bear + 头像」。
- 现状：页面已存在（`packages/member/mip-profile-interests`，2 列竖版卡、按 `updated_at DESC` 排序✓），但 DTO 无邀请来源，不渲染邀请人行（代码注释明示「DTO 暂无邀请来源」，`src/packages/member/mip-profile-interests/index.wxml:10`）。
- 实现要求：
  1. 服务端 roster 查询（`cloudfunctions/mip-opportunities-api/domain/profile-influence.js` 的公开感兴趣名单）补 inviter 字段，口径与人才列表同源：复用/同步 `public-person-details.js` 的 `loadHeartInviters`（邀请归档 `mip_event_invitation_attributions` 最新一条；USER=昵称+头像走可见性门控；PLATFORM=「MIP平台」；无归档省略）。不造值，缺省省略。
  2. 客户端 DTO（`src/modules/mip-opportunities` 的 `ProfileInterestPerson` 及 validation/transform）补 inviter 严格校验（参照 `src/modules/mip-cooperation/validation.ts` 的 `responseAuthorInviter` 口径：未知键拒绝、畸形整页拒绝）。
  3. `mip-profile-interests` 页面把 inviter 传给 `mip-talent-card`（grid 分支已有 `inviter-name/inviter-avatar-url/inviter-kind` props，接上即可）；未返回时不渲染。
  4. 云函数测试 + 客户端合同测试同步补 pin；**注意这是云函数改动，改完在报告里注明需要部署 `mip-opportunities-api`**（部署由维护者执行，你不用部署）。

## G4.【中】玩家档案「相关机会」Tab 缺「发布机会 N / 引荐机会 N」子筛选

- 设计：`figma/18-玩家档案-相关机会.png` 有两个带计数的子 chips（「发布机会 2」「引荐机会 1」），可切换发布的机会与引荐的机会。
- 现状：只有一行静态「招募中的机会 N 个」，没有引荐机会列表与切换（`src/packages/member/mip-public-profile/index.wxml:293-295`）。
- 实现要求：
  1. 服务端公开档案聚合（`opportunity-cooperations.js` / 公开档案接口所在域）补「引荐机会」列表能力：该档案用户作为**引荐人/推荐人**关联的机会（数据源先查证：`referral` 相关表/字段，如 `mip_opportunities.referral_*` 或引荐事件表；若现库无引荐事实数据，则在返回体中回 `referrals: []` 空数组并在代码注释说明，前端 chip 显示计数 0、切换后走空态，不得造数据）。
  2. 前端两个子 chips：「发布机会 N」（默认）/「引荐机会 N」，激活态黄底（同档案页既有 chip 风格），切换渲染对应列表；机会卡复用 `mip-opportunity-card`（黄标/想合作胶囊/下架置灰同口径，参照相关机会 Tab 现有用法）。
  3. 空态文案：发布=「暂无招募中的机会」；引荐=「暂无引荐机会」。
  4. 合同测试 pin 子 chips 切换与两条列表的数据字段。

## F1.【高】玩家/嘉宾档案页点「我感兴趣」按钮没有反应（优先修）

- 现象：档案页底部 Sticky 条的黄色「我感兴趣」按钮点了没有任何可见变化。
- 根因（已代码定位）：**`mip-pill-button` 双触发 + 档案页快速路径无防重入闩锁**，一次点按被处理两次、开与关相互抵消：
  1. `mip-pill-button` 内部根节点是 `bind:tap="handleTap"` → `triggerEvent('tap')`。自定义 tap 打到组件宿主节点的同时，原生 tap 事件继续冒泡、穿越组件边界再次命中宿主——页面 `bind:tap="toggleInterest"`（`src/packages/member/mip-public-profile/index.wxml:332`）一次物理点按会执行两次。
  2. `toggleInterest` 唯一防重入条件是 `interestState === 'loading'`（`index.ts:405`）。玩家身份已缓存时走快速路径 `runProfileAction → hasCachedInterestAccess() → updateInterest()`，只置 `'syncing'` 从不置 `'loading'` → 第二次触发通过守卫。
  3. 第一发 `active=false→true`，第二发读到已翻转的 `interestActive` 再取反 `true→false`，`mutate` 覆盖 `desiredActive=false` → 按钮弹回「我感兴趣」，服务端也落回未感兴趣。净效果 = 无反应。
- 仓库先例：`tests/mip-industry-selector.test.ts:42`（chip 包装 view 防双触发）、`tests/mip-cooperation-intent.test.ts:23`（详情页双击闩锁）。
- **修复方案（采用组件层一次修）**：`src/components/mip-pill-button/index.wxml` 两个根节点（native button 分支与 view 分支）内部 `bind:tap="handleTap"` 改为 `catch:tap="handleTap"`——挡掉原生冒泡、只留 `triggerEvent`，所有绑定点变单触发。已有闩锁的页面（详情我想合作 acting、编辑器 saving）行为不变。
  - 必须做全量回归核查：`grep -rn "mip-pill-button" src --include="*.wxml"` 列出所有 `bind:tap` 用点逐一确认改后行为（筛选清除/确定、详情 CTA、编辑器发布、档案互动条、登录引导等），把核查清单写进 commit message 或 PR 描述。
  - 补合同测试：pin `catch:tap="handleTap"`（两个分支都 pin），并写一条「单次触发」用例（参照 industry-selector 那条断言组件模板上不存在 `bind:tap` 双通道的写法）。
  - 若你实机验证发现组件层修复后档案页仍有问题，再在 `toggleInterest`/`runProfileAction` 加同步闩锁（参照 cooperation-intent latch），并在报告中说明原因。

---

## 验收清单（全部满足才算完成）

- [ ] `pnpm verify` 全绿（含新增/修改的合同测试）
- [ ] G1：详情页胶囊跳新页面，弹层代码清理干净，`app.json` 注册，测试 pin 更新
- [ ] G3：服务端 inviter + 客户端严格校验 + 页面渲染三层齐备，云函数测试绿
- [ ] G4：子 chips 切换 + 引荐机会列表（无事实数据时空态，不造数），测试 pin
- [ ] F1：pill-button `catch:tap` 双分支 + 全用点回归清单 + 合同测试
- [ ] 四个独立 commit；报告里列出：改动文件清单、verify 结果、需要部署的云函数（如 G3 落了服务端改动：`mip-opportunities-api`）、遗留风险
