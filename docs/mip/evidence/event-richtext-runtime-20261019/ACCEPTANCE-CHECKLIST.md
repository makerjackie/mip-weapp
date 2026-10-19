# 活动富文本渲染修复 · 发布验收 Checklist（2026-10-19）

批次：`fix/events-rich-text-render`（main 合并提交 `6ab31870`，修复提交 `8546d041`）
范围：小程序活动详情页富文本渲染修复（解析器 + 详情页空态条件）；云函数与管理后台无代码变更，按指令全量重新部署。同批并入上游 `6503f2db`（等价的空态占位修复）与 MIW-120/121 批次。

## A. 代码合并与推送

- [x] 修复分支 `fix/event-detail-richtext-render` 提交（8546d041）
- [x] origin/main 分叉合流（`7fe9822e`，与上游空态修复同行同改法自动收敛）
- [x] 修复分支并回 main（`6ab31870`），合并后合同测试 14/14 + tsc 通过
- [x] `git push origin main`（6503f2db..6ab31870）

## B. 云函数全量部署（本批零函数变更，按指令全量重部）

- [x] 测试链（ops.mjs --target=test）：迁移 dry-run → 备份（154 表/838 行，row-count-verified）→ 迁移 apply（全部已应用）→ project-init → 函数部署 → 授权收敛 → cloud:verify 全绿
- [x] 生产链（ops.mjs --target=production）：同链全绿，18 个 `mip-*` 函数逐一 verified，`cloud verify` schema/最小权限/健康/受保护调用规则通过
- [x] 过程处理：本机 Device Flow 临时令牌过期致 Invoke 健康探针 CAM 拒绝（历轮同噪音）——`CLOUDBASE_AUTH_MODE=local` 重启项目 MCP 守护进程后恢复；tasks-api 代码回读一次未收敛，按断点续跑重跑即过；mcporter 守护进程重启后备份步骤 MCP 报错，按踩坑录 `daemon stop && start` 恢复
- [x] 证据：`.tmp/ops-test-run5.log`、`.tmp/ops-prod-run1.log`（本机留存）

## C. 管理后台全量部署（生产与测试两套独立 BFF/前缀）

- [x] 发布快照：`pnpm verify:all` 全绿后 `admin-web/scripts/build-cloudbase.mjs`
- [x] 生产 BFF `mip-admin-web-api`：Active、客户端禁直调、0 timer
- [x] 生产静态 `mip-admin-console/`：15 文件 VERIFIED；`admin.mip.cool` 真实字节 15/15 一致，入口 `/assets/index-D0iAwe4G.js`
- [x] 生产 HTTPS 全量检查：`verify-admin-cloudbase.mjs --origin=https://admin.mip.cool` 68/68 通过
- [x] 测试 BFF `mip-t-admin-web-api`：Active（envs/test 参数：upstream=mip-t-admin-api、auth schema=mip_test_admin_auth、origin=https://test.admin.mip.cool）
- [x] 测试静态 `mip-admin-console-test/`：15 文件 VERIFIED；`test.admin.mip.cool` 真实字节 15/15 一致（同入口哈希）
- [x] 测试 HTTPS 全量检查：`verify-admin-cloudbase.mjs --origin=https://test.admin.mip.cool`（真实测试账号登录）68/68 通过

## D. 小程序最新代码重编译（微信开发者工具）

- [x] main 最新代码 `pnpm build`（测试包，烘焙 `mip-t-*` 断言通过，主包 1.7MB < 2048KB 预算）
- [x] DevTools 自动化装载宿主工程并编译，详情页真实装载（state=ready + 探针字段通过）

## E. 本批变更端到端测试（部署后复跑）

- [x] 后台真实编辑器 E2E（部署后）：9/9 —— 登录 → 全格式富文本（居中 H2/加粗/斜体/下划线/两种列表/居中段落）→ 编辑器插图上传（cloud:// 落库）→ 保存并预览 → 发布（活动「富文本渲染验收1324」PUBLISHED 入库复核）
- [x] 解析器合同测试：14/14（真实入库 HTML 样例）
- [x] 小程序运行时 E2E（部署后、DevTools 重编译包）：12/12 —— 三 Tab 节点/渲染断言、居中标题保留、列表扁平化、cloud:// 插图水合、负例空态正常
- [x] `pnpm verify:all`（合并后 main 快照）：小程序门禁 + admin-web 33 文件 228 测试全绿
- [ ] 运行时 E2E 对最新活动 1324 的追加复跑：DevTools 多项目窗口 WS 连接抖动未完成（同等覆盖已由活动 1052 的 12/12 + 1324 发布入库复核证明，非阻塞）

## F. 体验版发布（正式 MP 平台 · 按 Runbook 锁定为测试环境包）

- [x] `pnpm release:trial -- --desc "活动详情富文本渲染修复：管理后台富文本（居中标题/列表/行内样式/插图）原样渲染，清除死空白与误显示空态文案"`
- [x] 内置门禁：verify:all 全绿 + 烘焙断言（trial 包仅含 mip-t-*）+ dist 平铺上传 → **体验版 0.2.0.20261019 上传成功**（主包 1.7MB / member 1.2MB / admin 134.5KB）
- [ ] MP 后台「体验版」指向确认 + 真机扫码走查（人工边界：真机项外部等待）
- [ ] 说明：体验版按仓库红线指向测试环境（mip_test 库）；正式环境发版走 `release:prod`（提审阶段）

## F2. 微信支付切换正式环境（测试后端热切换，2026-10-19 追加指令）

- [x] 前置确认：测试/生产支付函数为两套独立部署（`mip-t-*` vs `mip-*`），切换只影响测试后端；商户号取正式商户 `1739928668`（与生产一致，即「正式环境」口径）
- [x] `envs/test/.env.local`：`MIP_PAYMENT_MODE` disabled→live、`WECHAT_PAY_MERCHANT_ID` 补正式商户号（原为空）
- [x] 部署测试支付三件套（此前从未部署）：`mip-t-cloudpay` / `mip-t-cloudpay-callback` / `mip-t-refund-worker` 全部 verified（deploy-payment-function.mjs --confirm-live）
- [x] 热切换核心函数：`switch-payment-mode.mjs --mode=live --confirm-live` → events/commerce/ledger 更新并回读收敛，community/admin 已同目录值，ledger 的测试会员 HMAC 按 live 规则移除
- [x] `verify-cloud.mjs`（envs/test）全绿；独立回读断言：6 个承载支付键函数全部 `mode=live` 且 `Active/Available`
- [x] 生产未受影响：生产支付函数（`mip-cloudpay` 等）与本轮操作无交集（不同函数名），生产目录本就 mode=live
- [ ] **购买前置**：mip_test 库 `mip_membership_plans` 当前 0 条——需在测试后台「会员方案」创建 ACTIVE（TEST 目录）方案后购买闭环才可走通
- [ ] 真机验证：真实微信支付一笔（live 扣款+到账+可退）+ 支付回调，属真机外部边界；若发起支付报商户绑定错误，需在 CloudBase 控制台确认环境已绑定商户号 1739928668
- [x] 回滚方式：`MIP_ENV_DIR=envs/test node scripts/switch-payment-mode.mjs --confirm-env=<EnvID> --mode=test`（或 disabled，可逆、不发版）

## G. 文档与状态

- [x] 修复报告 `report.html` + 运行时/admin 证据入库本目录
- [x] `docs/mip/PROJECT_STATUS.md` 记录本批
- [ ] 提审材料（人工阶段）：演示视频/截图/隐私指引，见 mip-release skill 阶段 3

## H. 正式版 1.2.0 发布（生产环境包 + 生产微信支付，2026-10-19 夜）

- [x] 生产支付红线核对：`envs/prod` 本就 mode=live + catalog=LIVE + 正式商户 1739928668；LIVE 目录 ACTIVE 方案在库（`annual_live "MIP 玩家" ¥6600/年`，经生产连接默认库直查确认；同实例另一 schema 为 mip_test）
- [x] `pnpm release:prod -- --version 1.2.0`：上传前 verify:all 全绿、烘焙核对通过（mip-*；dist 复核 `mip-identity-api`=1 / `mip-t-identity-api`=0）、平铺通道上传成功
- [x] 发布后生产 `verify-cloud.mjs` 复验全绿
- [ ] 提审（人工）：mp.weixin.qq.com → 版本管理 → 开发版本 1.2.0 → 提交审核（向导：平台规则→安全测试→接口未配置勾选→隐私指引；演示视频 ~/Downloads/MIP-YANSHOU-VIDEO.mp4、截图 .tmp/review-shots/）
- [ ] 审核通过后全量发布（人工）；发布后真机验证一笔 live 支付与会员到账
