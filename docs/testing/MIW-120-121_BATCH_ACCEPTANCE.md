# MIW-120/121 批次验收清单（2026-10-17）

本批合并范围：两支 review 分支合入 main 并推送（`353c18d5..08489048`）、测试环境全量部署（云函数 + 管理后台）、微信开发者工具重编译小程序、端到端验收、发布体验版。

| 任务 | 分支 | 主题 |
| --- | --- | --- |
| MIW-120 | `MIW-120/supa-ai` | 活动/机会左上角地区切换：三入口统一系统原生 `<picker mode="selector">`，选项=全国+后台 ACTIVE 分会城市；项目机会分会过滤改包容匹配（平台级机会全国可见）；项目机会筛选入口迁入状态行「筛选」chip；删除人才合作死草稿链路 |
| MIW-121 | `MIW-121/supa-ai` | 授权手机号弹层强制协议勾选（两形态统一门控，未勾选 toast 且不外发 phone/signin）；《服务协议》《隐私政策》可点跳转、返回保持状态；隐私政策纳入管理后台可配置（identity-api/admin-api 新增 privacy 文档 + admin-web「隐私政策」tab）；privacy-policy 页两态渲染 |

## 一、合并与门禁 ✅

- [x] 两支分支依序合入 main：MIW-120（合并提交 `70e4b42c`）、MIW-121（合并提交 `08489048`），均零冲突
- [x] 合并后完整 `pnpm verify:all` 全绿（根 verify：296 测试套件全过，含新增 `tests/mip-region-switcher.test.ts`、`tests/mip-privacy-policy-page.test.ts`；admin-web vitest + responsive 契约）
- [x] `git diff --check` 干净；推送 origin main `353c18d5..08489048`
- [x] notma 看板 MIW-120/121 置 done，timeline 各留交付评论（Acceptor，2026-10-17）

## 二、数据库 ✅

- [x] 本批无新增迁移（MIW-120 服务端仅改 WHERE 子句；MIW-121 复用 `mip_app_settings` 键值链路）——ops 链迁移 dry-run/apply 无新步骤（`mip_test` 154 表、备份 manifest 留档）

## 三、云函数与测试后台部署（staging 全量）✅

- [x] `node scripts/ops.mjs --target=test`（MIP_ENV_DIR=envs/test + local 模式）全链一次通过（第 3 轮；前两轮分别在 mip-t-commerce-api / mip-t-notifications-api 遇 SCF 回读收敛瞬态，按踩坑录直接重跑续传）：16 个 `mip-t-*` 核心函数全部 verified → 迁移 → 备份 → project-init → 授权收敛（152 表 exact grants）→ `cloud:verify` 全绿；本批增量 `mip-t-opportunities-api`[120]、`mip-t-identity-api`[121]、`mip-t-admin-api`[121] 均在 verified 名单（部署脚本含代码包 SHA 回读收敛）
- [x] 测试后台 BFF `mip-t-admin-web-api` 部署：Active、禁客户端直调、0 timer、legacy hosting unchanged；上一版 24 个不可变资产比对后 16 个并入新包（零同路径冲突），新入口 `index-DVFkkChc.js`；认证密钥缺口（上批未落 `envs/test/.env.secrets.local`）从已部署函数 env 回读补齐，不回显
- [x] 测试后台静态前缀 `mip-admin-console-test/` 部署：15 文件字节 VERIFIED（隔离前缀、共享根未动）
- [x] 公开域字节校验：`test.admin.mip.cool` 15/15 一致，线上入口 = `/assets/index-DVFkkChc.js`（与本次构建一致）
- [x] 测试后台浏览器验证（Playwright + Chromium，1280×720 与 390×844）：标题「MIP 运营管理」，DOM 加载入口 JS = 新入口，console 仅预期内 401（未登录会话探针），390 无横向溢出；截图 `.tmp/admin-release-20261017-test/`
- [ ] 测试后台账号级验证：**BLOCKED**——测试认证库（mip_test_admin_auth）无管理员账号（历轮同缺口，需 owner 引导 + 小程序设密）；账号级 HTTPS 校验器 15 项中仅密码登录相关 2 项失败，其余通过；「隐私政策」tab 的后台保存路径由 React 面板测试覆盖，真界面保存留账号解锁后补验

## 四、小程序（开发者工具重编译 + 运行时）✅

- [x] `pnpm build`（envs/test 语义）通过：主包 1.10MB / member 1.02MB / admin 85.8KB；嵌套 vendor 树存在；烘焚断言 `mip-t-identity-api` 命中、零生产函数名（测试包确认）
- [x] 微信开发者工具重新编译：CLI `open --project`（冷启动 GUI 后）编译成功；`pnpm runtime:preflight` 全绿（真 AppID、52 路由合同完整、工具登录态、服务端口 62842）
- [x] `pnpm test:runtime`（automator 全量）：52 路由合同 26 PASS / 10 FAIL / 16 WAIT。**本批相关面全 PASS**：`pages/events/index`、`pages/opportunities/index`（含 `interaction:opportunity-search-and-filter`）、`pages/profile/index`（挂载 mip-login-sheet）、`packages/member/privacy-policy/index`（未配置态静态兜底渲染）、`user-agreement`、`mip-branches`。FAIL/WAIT 归因：测试库无演示数据（seed 按既定计划等首次真机登录后做）导致成员数据页 settle on error、`mip-access` 登出 fixture 控件、`mip-ai/voice` 与 `managed-events` 为既有基线项；无一项落在本批 diff 面内

## 五、端到端验收（staging 真库/真函数）✅

### MIW-120 地区切换

- [x] 服务端数据源：`mip_city_branches` ACTIVE 分会 1 个（测试城市/测试分会）——picker 选项 = 全国 + 后台 ACTIVE 分会城市，来源链路真实可用
- [x] 包容匹配子句已部署（`(o.branch_id = ? OR o.branch_id IS NULL)`，镜像活动「未填城市全国可见」）；SQL 形状由 `mip-opportunities-api` domain 测试 pin 住；`mip_test` 当前 PUBLISHED 机会 0 条（平台级/分会归属均 0），真数据过滤演示待 seed 后补
- [x] 客户端合同：`tests/mip-region-switcher.test.ts`（三入口 picker、默认地区、清除筛选重置）+ figma surfaces 契约随 verify 全绿；运行时三入口页面 PASS + 机会页筛选交互 PASS
- [ ] 真机目检三处 picker 滑动选择与过滤观感（external-wait 留体验版）

### MIW-121 协议勾选 + 隐私政策可配置

- [x] 服务端：`mip_app_settings` 无 `PRIVACY_POLICY` 行 → identity 按合同回退 `body='' + isDemo=true` 静态兜底（真库回读证实）；`AGREEMENT_DOCUMENTS` 含 `privacy` 已部署（identity/admin 代码包 verified）
- [x] 客户端合同：`tests/identity-unlock.test.ts` 弹层门控断言（未勾选 toast、不外发事件、勾选后恢复）+ `tests/mip-privacy-policy-page.test.ts` 两态渲染随 verify 全绿；运行时 privacy-policy 页 PASS、我的页（弹层挂载点）PASS
- [x] DevTools 重编译后弹层挂载页无运行时错误（profile/opportunities PASS）
- [ ] 后台保存 privacy 内容 → 小程序展示配置态正文的闭环：**BLOCKED**（依赖测试后台账号，同上）
- [ ] 真机微信手机号授权（勾选门控后的原生授权链路）：external-wait 留体验版

## 六、体验版发布 ✅

- [x] 上传前完整 `pnpm verify:all` 复跑通过（release:trial 内置门禁：根 296 套件全过 + admin-web 0 fail）
- [x] `pnpm release:trial -- --desc "MIW-120/121: 地区切换与授权协议勾选"`：envs/test 构建 → 烘焙断言通过（trial 包只含 mip-t-*）→ dist 平铺 → DevTools CLI 登录态直传一次成功（冷启动 GUI 后）
- [x] **体验版 `0.2.0.20261017`** 已上传：总计主包 1.10MB（< 2048KB）/ member 1.2MB / admin 85.8KB；下一步 mp 平台「版本管理 → 设为体验版」（若非最新）人工点一下即可分发

## 七、真机边界（external-wait，记录不阻塞）

- MIW-121：真实微信手机号授权弹窗（勾选门控后的原生授权链路）、《隐私政策》《服务协议》真机页面排版、后台配置态正文的真机渲染
- MIW-120：真机原生滚动选择器手感、选择后列表刷新观感
- 支付/扫码签到/订阅消息不在本批变更面，无真机事项

## 结论

- **通过**：合并与双端门禁、测试环境全量部署（云函数 16 函数 + 管理后台 BFF/静态三层证据）、开发者工具重编译与运行时预检、本批变更面运行时与合同测试零回归。
- **阻塞项（非本批引入）**：① 测试后台无管理员账号——账号级验证与「隐私政策」后台保存闭环 BLOCKED（历轮同缺口，等 owner 引导设密）；② 测试库演示数据 seed 未做——成员数据页 runtime FAIL/WAIT、机会地区过滤真数据演示待 seed。
- **通道备注**：ops 链两次 SCF 回读收敛瞬态（commerce/notifications），重跑即过；DevTools automator 首轮 page destroyed，完整 GUI 冷启动后恢复。
