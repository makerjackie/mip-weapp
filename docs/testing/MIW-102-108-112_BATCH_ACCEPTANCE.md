# MIW-102/108/112 批次验收清单（2026-10-14 夜·第二批）

本批合并范围：三支 review 分支合入 main 并部署（云函数有更新则部署；admin-web 本批无变更不部署）、微信开发者工具重编译小程序、端到端验收后发布体验版。

| 任务 | 分支 | 主题 |
| --- | --- | --- |
| MIW-102 | `MIW-102/supa-ai` | 「发现」首页模块整体下线：tab + 路由 + 公告页 + `mip-announcements` 客户端模块，落地页改活动 Tab；`mip-banners-api`/`mip-tasks-api` 白名单收缩 |
| MIW-108 | `MIW-108/supa-ai` | 管理后台退款修复：平台超管可退「已签到报名」订单（REQUIREMENTS Q-ADMIN-03 例外通道，原因必填 + 审计） |
| MIW-112 | `MIW-112/supa-ai` | 合作卡烘焙图回退 PNG（真机不支持无损 VP8L webp）+ 成长页主角色/宝箱恢复 + mip-login-sheet 品牌锚点 `styleIsolation: apply-shared` 修复 |

## 一、合并与门禁 ✅

- [x] 三支分支依序合入 main（102→112→108）；MIW-112 与 main 两处状态/验收文档冲突（双段合并，取 MIW-112 侧含 doc-links 合规措辞）；MIW-108 落后 28 提交但无冲突
- [x] 合并后完整 `pnpm verify:all` 全绿（根 271 test files / 1724 tests + 服务端合同 + docs；admin-web 含 responsive）；`git diff --check` 干净
- [x] notma 看板三任务置 done
- [x] 推送 origin main `25a82a1d..26d5bf00`

## 二、数据库（staging 真库）

- [x] 本批无新增迁移（MIW-108 走服务端状态机例外分支，不改表结构）；无 seed

## 三、云函数部署（staging）✅

- [x] 通道修复：API Key Invoke 健康门连续 CAM 拒绝（含本地模式探针复现）；定位为主仓 mcporter 孤儿守护进程（周二启动）持有 API Key 会话，`daemon stop` + 清孤儿进程后以 `CLOUDBASE_AUTH_MODE=local`（本机 Device Flow，沿用昨晚登录）重启守护进程即恢复
- [x] `mip-admin-api` 部署 verified（MIW-108 退款例外；上传后 SHA 收敛 + 配置回读 + 健康探针 `cloudbase-mysql` 通过）
- [x] `mip-banners-api` 部署 verified（MIW-102 目标白名单移除首页/公告路径——MIW-102 留言的「下次部署窗口」即本批）
- [x] `mip-tasks-api` 部署 verified（MIW-102 跳转白名单收缩）
- [x] `pnpm cloud:verify` 全绿（schema、最小权限、函数、健康、受保护调用规则）
- [x] admin-web / packages/admin-contracts 本批零变更，不部署（上一批 `index-CACKBtAz.js` 版本仍在线）

## 四、小程序（构建 + 开发者工具重编译 + 运行时）

- [x] `pnpm build` 通过：主包 1.09MB / member 1.18MB / admin 85.8KB；嵌套 vendor 树存在；`Package size contract` 过（member 2,076,715B / 2,097,152B，MIW-102 公告页下线释放 ~11.7KB 抵消 MIW-112 PNG 回退增量）
- [x] `pnpm runtime:preflight` 全绿（52 路由契约、真 AppID 匹配、工具登录态、服务端口 62842）
- [x] `pnpm test:runtime`：53 PASS / 4 FAIL / 3 WAIT——FAIL（managed-events、mip-access、mip-profile-interests、mip-ai/voice）与 WAIT（event-console、event-registrations、mip-cases/detail）均与 MIW-99..107 批记录的基线完全一致，零回归；本批相关页面全部 PASS（活动 Tab、成长页×3 态、合作卡详情/编辑、个人页、公开档案）

## 五、本批专项端到端

- [x] MIW-102：dist `app.json` 启动页 = `pages/events/index`，tabBar 恰好 3 项（活动/机会/我的），路由契约 3+49=52（55→52）；运行时 `pages/events/index` PASS（tab 切换合同在 verify-runtime 三处随动并随套件通过）；全仓无 `pages/index/index` 与公告页残留引用（verify-source 门禁）
- [x] MIW-112：dist 内零 VP8L 无损 webp（全仓扫描）；6 张合作卡 `coop-card-*@3x.png` 与成长页 `hero-character.png`/`mystery-box.png` 全部落位；运行时成长页三态与合作卡页面 PASS；`mip-login-sheet/index.json` 含 `styleIsolation: apply-shared`（dist 回读确认）
- [x] MIW-108：`mip-admin-api` 合同测试（已签到报名 + 超管例外 + 非 SuperAdmin 拒绝 + 审计字段）随 `pnpm verify:all` 全绿（mip-admin-api 800+ 项）；staging 部署后健康探针 `cloudbase-mysql` 通过；线上真实退款操作留管理后台人工验证（external-wait）

## 六、体验版发布 ✅

- [x] 上传前完整 `pnpm verify:all` 复跑通过（exit 0：271 文件 / 1724 测试 + 全部合同）
- [x] dist 平铺临时工程 `.tmp/upload-flat-0.2.0.20261014.4`（沿用 .3 完整 project.config.json：es6+enhance）经开发者工具 CLI 登录态通道上传成功：**体验版 `0.2.0.20261014.4`**（quit+pkill 冷启动后直传；总计 3.0MB / 主包 1.6MB / member 1.2MB / admin 134.9KB）
- [ ] 体验版二维码真机打开巡检（external-wait）

## 七、真机边界（external-wait，记录不阻塞）

- 六张合作卡 + 成长页主角色/宝箱在真机的 PNG 渲染（MIW-112 的最终证明）
- 登录/授权弹层底部品牌锚点不可见（真机）
- 管理后台真实退款操作（已签到订单 + 超管账号）走查
- 发现模块下线后的启动落地与分享回流（旧邀请卡失效口径沿 MIW-44/54/65 先例）

## 结论

- **通过**：合并（三支）、双端门禁（合并后 + 上传前两次完整 `pnpm verify:all` 全绿）、云函数三函数部署 verified + `cloud:verify` 全绿、构建与运行时预检、运行时合同与基线一致零回归、本批专项（路由契约/资产回退/退款合同）全部通过、体验版 `0.2.0.20261014.4` 上传成功。
- **阻塞项**：无。
- **通道备注**：部署通道遇 API Key Invoke CAM 拒绝（含 local 模式探针复现），定位为主仓 mcporter 孤儿守护进程持有 API Key 会话；清进程 + `CLOUDBASE_AUTH_MODE=local`（本机 Device Flow）重启守护进程后恢复。上传私钥仍缺失，沿上一批走开发者工具 CLI 登录态 + 冷启动直传。
