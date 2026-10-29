# 生产发布证据（2026-10-29）

本批（10-27 飞书9项反馈修复 + 10-28 活动标签四色）经用户明确指示发布生产。发布快照：main `1dca3abd`（与 origin/main 一致，干净工作区）。

## 生产云函数（ops.mjs --target=production）

- 首跑在 pre-apply backup 失败（`queryMysqlDatabase` MCP 错误，mcporter 守护进程劣化），按踩坑录 `npx mcporter daemon stop && start` 后续跑通过（日志 `.tmp/ops-prod-release-1602r2.log`）。
- 稳定备份：154 表 / 6040 行，仓库外 `/Users/oudouglas/Backups/mip-weapp/ops-production-2026-10-29T080239-282Z`。
- 迁移：`applied: mip_event_tag_colors 20261028010000`（迁移114，四色背景/黑白文字）。
- 部署：16 个 `mip-*` 函数 verified（含本批变更的 mip-admin-api / mip-events-api / mip-opportunities-api），授权收敛 152 表，`cloud:verify` 全绿；未持久化任何密钥。

## 生产管理后台（admin.mip.cool）

- 上一版 BFF 留档：`.tmp/admin-release-20261029-prod/prev-bff.zip`（CodeSha256 `d976f783…`，入口 index-BxitjAfN，13 资产），GetFunctionAddress 下载后 SHA 校验一致。
- 5 个旧不可变资产（含旧入口 index-BxitjAfN）并入新包，同名文件逐字节核对无冲突；新包 14 资产。
- BFF `mip-admin-web-api`：Active、禁客户端直调、0 定时器、legacy hosting 未动；重新下载线上 ZIP（`2479cf07…`）与本地产物 22 文件逐字节一致。
- 静态 `mip-admin-console/`：15 文件 VERIFIED，前缀内 113 文件清点，共享根与 legacy hosting 未动。

## $DEFAULT 别名钉旧版本（本轮发现并修复）

- 部署后公网探测：新入口 `/assets/index-D2-c6lHh.js` 404（SCF 上游返回），旧资产 200——网关流量停留在旧数字版本。
- ListAliases 回读：identity/events/admin `$DEFAULT`=v3、BFF=v4（2026-10-20 预置并发时期建立）；GetFunctionAddress 对比确认 v4 = 部署前旧代码、$LATEST = 新代码。
- 处置：四函数 PublishVersion（描述 `20261029 production release`）→ Active → UpdateAlias `$DEFAULT` 迁移：identity 3→4、events 3→4、admin 3→4、BFF 4→5（`.tmp/admin-release-20261029-prod/alias-release.mjs`）。
- 预置并发保持关闭（2026-10-28 用户授权的临时测速状态），未恢复常驻实例；恢复待用户决策。

## 生产验收（别名迁移后）

- 公网资产：`verify-admin-live-assets` 15/15 字节一致，新入口 index-D2-c6lHh 生效。
- HTTPS 检查：68/68、14 模块（真实测试账号认证、Cookie、来源防护、只读模块、退出）。
- 浏览器（IAB 真实登录，production 真实数据）：活动列表 4 条真实活动；活动编辑预览弹窗渲染正常（时间折叠/地点拼接/费用角标/参与人数）；用户详情「开通玩家权益」入口在位；1280×720、1440×900、390×844 均无横向溢出；控制台 0 错误。截图 `shots/`（events-1440x900.png、events-390x844.png、event-edit-preview-modal.png）。
- 边界：生产 4 条活动均未配置标签（标签列为空），预览无标签角标属正确表现；标签四色展示待运营在生产配置标签后复验。

## 小程序正式版 1.2.10

- `pnpm release:prod --version 1.2.10`：内置 verify:all 全绿、烘焙断言通过（仅 mip-*）、平铺通道上传成功；源码 `1dca3abd`，主包 1.16MB / member 1.04MB；回执 `.tmp/release-prod-1.2.10.json`。
- 平台状态：developmentUploadSucceeded=true；trialAssignmentVerified / reviewSubmitted / publicReleased 均 false——体验版指派、提审、公开发布待公众平台人工操作。

## 发布后复验

- 独立 `verify-cloud`（envs/prod）：首跑遇同款 mcporter 守护进程劣化，重启后 r2 全绿（schema/最小权限/函数/健康/受保护调用规则）。
- 独立复验期间未再变更任何生产代码或配置。

## 待办

1. `wrangler login` 后 `node scripts/acceptance-site.mjs publish` 发布生产验收页（prod-release-20261029-v1，已链接 feedback-20261027-v1 测试记录）并回读线上。
2. 公众平台：将开发版本 1.2.10 设为体验版（如需）、提交审核、审核通过后全量发布。
3. 真机：线上版走通登录 → 活动列表 → 一笔真实会员购买（live 支付+到账）；标签颜色、复制链接唤起、消息角标、合作卡访客视角复测。
