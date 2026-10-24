# MIW-128 / MIW-129 / MIW-130 批次 E2E 与发布证据（2026-10-25）

- 源码：main `7c7ebcb3`（三分支合并后）；TEST/PROD 云函数与 admin-web 静态均以该源码部署
- E2E：DevTools automator 聚焦动线（TEST 构建，烘焙 `mip-t-*`，真实调用已部署的测试函数）
- 执行口径：真实页面/真实服务响应为准；模拟数据逐张标注；阻塞项如实记录

## 一、部署验证

| 环境 | 对象 | 结果 |
| --- | --- | --- |
| TEST | mip-t-events-api / mip-t-identity-api / mip-t-opportunities-api / mip-t-admin-api | 4/4 部署 + 真实 invoke 健康门通过（persistence=cloudbase-mysql） |
| PROD | mip-events-api / mip-identity-api / mip-opportunities-api / mip-admin-api | 4/4 同上 |
| TEST | admin-web 静态 `mip-admin-console-test/` | 上传成功 + 云端清单回读 60 文件；HTTPS 送达被账号欠费 451 阻塞 |
| PROD | admin-web 静态 `mip-admin-console/` | 上传成功 + 云端清单回读 115 文件；同上 |

- 部署过程修复：mcporter 守护进程缓存 API Key 会话导致 invokeFunction 被 CAM 拒绝（2026-10-12 同因先例），以 `CLOUDBASE_AUTH_MODE=local` 重启守护进程后 Invoke 恢复，健康门全部真实执行。

## 二、聚焦 E2E 结果（DevTools automator，390 视口）

| # | 检查 | 结论 | 证据 |
| --- | --- | --- | --- |
| M1 | 活动详情页（未报名/已报名两态）底栏均无「取消报名」节点 | **PASS（真实页面）** | `mip-event-cancel-action` 查询为空 + shots/01、05；底栏只剩客服/分享/立刻报名 |
| M2 | 订单详情取消报名卡片随服务端 `canCancel=true` 渲染 | **PASS（真实页面+模拟订单数据，SIM 单号）** | 差分渲染 `eventCancelAvailable` false→true 时页面 view 节点 +2（条件卡片+按钮宿主）；shots/04 实见红色「取消报名」按钮 |
| M4 | `canCancel=false` 时取消卡片不渲染 | **PASS（同上口径）** | 同差分；false 时无该节点 |
| M5 | 免费报名 → toast「报名成功」→ 自动返回详情 | **BLOCKED（环境边界，非本批回归）** | 提交动作真实执行，被资料完善守卫重定向到资料页（守卫路径工作正常）。automator 会话身份资料不完整 + TEST 头像上传通道（IMAGE_SAFETY）自 10-24 起故障，无法完成资料保存；与 10-24 会话同一边界。逻辑由合同测试 `tests/mip-registration-page-recovery.test.ts` MIW-129 用例覆盖（toast+returnToEventDetail、签到续办保留结果页），verify:all 全绿 |
| M6 | 返回后详情页呈已报名态 | 随 M5 同边界（缓存失效逻辑由同一合同测试覆盖） | — |
| M8 | 小程序「当前身份」四类映射 | 合同测试覆盖（mip-access membershipLabel ← productRole 映射，verify:all 全绿）；动线进入依赖 M5 同款身份前置 | — |

- 本批触碰的服务端路径经真实服务验证：E2E 的活动列表/详情数据全部来自新部署的 `mip-t-events-api`（真实 MySQL 响应→页面渲染）。

## 三、test:runtime（只读合同）漂移分析

本轮 31 passed / 13 external-wait / 8 failed（10-20 基线为全绿、10-14 为 4 FAIL/3 WAIT）。逐条核对：

- 8 个 failed 页面（admin/managed-events、mip-card、mip-received、mip-hearts、mip-blocked、mip-ai/voice、registration 敏感值检查）均不在本批改动范围（本批仅 events detail / order-detail / registration 提交流 / access 身份映射）；`git diff` 确认 organizer avatar 返回 `cloud://` 的服务端代码路径（event-service 1418 行）未被本批触碰，失败源于夹具数据漂移（新验收活动带主办方头像）。
- 13 个 external-wait 均为夹具依赖（orders/opportunities/cooperationTalents 等真实数据缺口）。
- 环境因素：TEST 图片安全检查通道自 10-24 起故障（IMAGE_SAFETY_UNAVAILABLE），影响媒体类页面。

结论：无本批回归证据；媒体通道故障与夹具漂移为既有问题，建议另行建卡。

## 四、真机待验（沿用既有边界）

1. 真实已报名链路（免费/支付）→ 报名成功 toast → 自动返回详情（M5/M6 的最终确认）
2. 真实支付订单上的取消报名操作（M2 的真实数据形态）
3. 原生手机号授权、扫码签到、真实支付与权益到账
4. 体验版 1.2.9 · 生产环境确认（上传后由维护者在公众平台指派）

## 五、外部阻塞（需维护者处理）

1. **CloudBase 账号欠费**：静态托管 CDN 侧 test.admin.mip.cool / admin.mip.cool 返回 451（account is arrears）。云函数、MySQL、托管上传均正常。充值后静态站点自动恢复，届时需补做 admin-web 双端 HTTPS 回读与 MIW-130 真实后台复测。
2. DevTools 自动化桥在本仓库（60+ worktree 大文件树）下新实例易受 256 fd 软限影响；本次以 shell 高 fd 限启动 + 满编译等待解决。后续跑 automator 前建议先确认 `lsof -p <主进程> | wc -l` 余量。
