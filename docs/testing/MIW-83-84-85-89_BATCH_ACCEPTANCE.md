# MIW-83/84/85/89 批次验收清单（2026-10-14）

本批合并范围：四支 review 分支合入 main 并全量部署（云函数 + 管理后台）、重编译小程序、发布体验版。

| 任务 | 分支 | 主题 |
| --- | --- | --- |
| MIW-83 | `MIW-83/feat/growth-level-benefits-swipe` | 玩家等级页改版：档位横滑、权益跟随与未解锁锁定态、任务全量展示、会员操作栏回归「邀请入会」分享 |
| MIW-84 | `MIW-84/feat/growth-task-direct-jump` | 等级任务「去完成」改为后台配置动作（PAGE_JUMP 跳页 / SHARE 分享），移除提交+核验入口 |
| MIW-85 | `MIW-85/fix/inviter-latest-attribution` | 邀请人展示统一为「最近一次活动邀请人」且玩家不显示；报名页「邀请来源」下线 |
| MIW-89 | `MIW-89/feat/opportunity-value-amount-modes` | 机会表单价值金额改「面谈 / 千单位」双模式并转选填 |

## 一、合并与门禁

- [ ] 四支分支基于 main 无冲突合并（MIW-89 状态文档冲突、MIW-83×84 growth 冲突面已 rebase 消解；onShareAppMessage 去重、迁移 108→109 重编号 + lock 注册）
- [ ] 合并后完整 `pnpm verify:all` 全绿（小程序 + CloudBase + admin-web）
- [ ] `git diff --check` 干净；推送 origin main 成功

## 二、数据库迁移（staging 真库）

- [ ] 迁移 108 `mip_opportunity_value_mode`（MIW-89，value_mode 列 + CHECK）应用成功，rowsAffected 回读
- [ ] 迁移 109 `mip_task_card_actions`（MIW-84，action_type/action_target 列）应用成功；存量全 NULL、无回填
- [ ] `mip_schema_migrations` 追加两行且 checksum 与 lock 一致

## 三、云函数与管理后台部署

- [ ] 受影响函数部署并回读 Active：`mip-tasks-api`（action 字段）、`mip-opportunities-api` + `mip-admin-api`（value_mode）、`mip-events-api`（邀请人门控，如本批重部署）
- [ ] 全量核心函数 `cloud:deploy` 通过 `cloud:verify`
- [ ] admin-web BFF（`mip-admin-web-api`）+ 静态托管 `mip-admin-console/` 发布，入口 HTML 与新构建一致
- [ ] 管理后台浏览器验证：任务表单「点击动作/目标页面」配置（MIW-84）、机会表单价值模式（MIW-89）保存与回显

## 四、小程序（DevTools 重编译 + 运行时）

### MIW-83 等级页改版

- [ ] 档位条横滑切换，lv 数字与权益区跟随；未解锁档位锁定态（锁图标/置灰）
- [ ] 非会员头部渲染问号箱子、无 Lv 大字；锁定档权益具名展示
- [ ] 任务区在档位切换前后数据不变；后台配置任务全量展示（游标聚合）
- [ ] 会员操作栏「邀请入会」按钮出现且可拉起转发；到期窗口内展示「立即续费」

### MIW-84 任务点击动作

- [ ] AVAILABLE + PAGE_JUMP（→活动 Tab）：点击整卡落在 `pages/events/index`（switchTab）
- [ ] AVAILABLE + SHARE：卡内胶囊为转发按钮，点击拉起转发面板（onShareAppMessage 固定邀请文案，真机目检）
- [ ] AVAILABLE + 未配置：整卡不可点、不渲染胶囊；COMPLETED/ENDED 灰态不可点
- [ ] 等级页点击任务不再进入任务详情页（提交/核验入口移除；详情页能力保留但无入口）

### MIW-85 邀请人展示

- [ ] 嘉宾卡 footer 展示「最近一次活动邀请人」；无归档嘉宾显示「MIP 平台」；玩家一律无邀请人
- [ ] 我的档案页不显示邀请人；报名成功页无「邀请来源」块

### MIW-89 机会价值金额

- [ ] 编辑器「价值金额（选填）」：面谈/千双模式切换、千输入 ×100,000 换算、留空可提交
- [ ] 详情卡/列表卡按 面谈 / X 千 / 区间 回退展示；admin 列表与导出同口径

### 通用

- [ ] dist 健康：嵌套依赖树 `dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm/` 存在；主包 < 2048KB
- [ ] `pnpm runtime:preflight` 全绿

## 五、体验版

- [ ] 上述全部通过后 `pnpm wechat:upload`（含 verify:all 门禁）发布新体验版，记录版本号
- [ ] 真机补验：SHARE 任务转发面板目检、支付/手机号/扫码等真机项按仓库边界另卡跟踪

## 结果记录（2026-10-14 执行）

### 一、合并与门禁 — PASS

- [x] 四支分支合入 main（`1e6fb44a`/`40a438bf`/`82f403d3`/`9f7f5aab`）；冲突消解：MIW-89 状态文档双段合并、MIW-84 rebase（growth 三文件）、`onShareAppMessage` 去重（`1c63efba`）、迁移 108→109 重编号 + lock 注册 + rollback（`0bf884b7`）
- [x] 合并后完整 `pnpm verify:all` 全绿（根 709 owned sources / 299 test files；admin-web 28 文件 177 项 + responsive contract）
- [x] `git diff --check` 干净；推送 origin main `e477cdd9..c5724dce`（含清单文档）；四任务 notma 置 done

### 二、数据库迁移（staging）— PASS

- [x] 备份先行：`pnpm database:backup`（154 表 5138 行，row-count-verified，仓库外 `~/Backups/mip-weapp/`）
- [x] 迁移 108 `mip_opportunity_value_mode` + 109 `mip_task_card_actions` 应用成功（`apply-mip-schema` applied × 2 + isolated schema verified）；`mip_task_cards` 存量 action_type/action_target 全 NULL 无回填

### 三、云函数与管理后台 — PASS（账号级浏览器验证沿历轮 BLOCKED）

- [x] 全量 16 核心函数部署 verified（API Key Invoke 健康门 CAM 拒，按既定口径本机 Device Flow `CLOUDBASE_AUTH_MODE=local` 重启 MCP 后全过）；`cloud:verify` 全绿
- [x] BFF `mip-admin-web-api` Active（禁客户端直调、0 timer）；上一版 2 个不可变资产保留；静态 `mip-admin-console/` 14/14 字节 VERIFIED
- [x] 双入口（admin.mip.cool 与默认域）HTML 均引用新入口 `index-B5VlXNzm.js`；`verify-admin-live-assets` 14 files matched
- [ ] 账号级 HTTPS 验证器：缺 `MIP_ADMIN_TEST_*`，BLOCKED（历轮一致）；任务表单/价值模式表单由 admin-web 合同测试覆盖（10/10）

### 四、小程序（DevTools 重编译 + 运行时）— PASS

- [x] `pnpm build`：主包 1.11MB（<2048KB）、member 1.28MB、admin 85.8KB；嵌套 vendor 树存在；`runtime:preflight` 全绿（devtoolsLoggedIn）
- [x] 全量 `test:runtime`：56 PASS / 4 FAIL / 3 WAIT。3 FAIL（managed-events/mip-access/mip-ai-voice）与 MIW-79 基线一致；新增 `mip-profile-interests blocked` 判定为**数据条件非回归**：门控代码自 `f7328fa5`（本批前）未变，会话经聚焦 E2E 证实为玩家（isPlayer=true），置顶人才档案（于书伟 Dylan/程序员helps程序员）`visibility_json.influence=false` → 目标侧门控正确拒绝；该路由契约本就声明 blocked 为定义态
- [x] 聚焦 E2E（automator，staging 真库，10/10）：MIW83 玩家态/2 档合并+1 档锁定/权益槽位；MIW84 PAGE_JUMP→活动 Tab switchTab 落地、SHARE 按钮渲染（AVAILABLE+actionType=SHARE，dist wxml 含 open-type="share"）、未配置卡点击无跳转；MIW85 我的档案页无邀请人；MIW89 编辑器 valueMode/valueQian/valueSummary 字段就位
- [x] E2E 演示数据（staging）：完善资料→PAGE_JUMP pages/events/index、演示·整理活动收获→SHARE；贡献者档挂第 5 项权益形成 2 档（相邻同权益合并为一档的派生逻辑由 mip-growth-tiers 单测覆盖）

### 五、体验版

- [x] 门禁复跑 `pnpm verify:all` 通过后，dist 平铺临时工程上传体验版（见下方版本记录）
- [ ] 真机补验（另卡跟踪）：SHARE 任务转发面板真机目检、手机号/支付/扫码签到真机项、嘉宾变体横幅真机

### 体验版记录

- `0.2.0.20261014.1`：MIW-83 等级页档位横滑改版 + MIW-84 任务点击动作后台可配（PAGE_JUMP/SHARE）+ MIW-85 邀请人统一为最近一次活动邀请人（玩家不显示）+ MIW-89 机会价值金额面谈/千双模式

