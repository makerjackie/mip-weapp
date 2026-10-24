# 本批验收 Checklist（MIW-128 / MIW-129 / MIW-130，2026-10-25）

- 源码：main `7c7ebcb3`（merge MIW-130），含 MIW-128 `c7caea39`、MIW-129 `a5cbd2ec`
- 门禁：`pnpm verify:all` 全绿（根 312 测试文件、Web 283 用例、双端契约、构建断言、docs 检查）
- 环境：同一 CloudBase 环境；TEST=mip-t-*（mip_test 库）、PROD=mip-*（默认库）
- 明细证据：[README.md](README.md)

## 一、部署 Checklist

| # | 项 | 结果 |
| --- | --- | --- |
| D1 | TEST 云函数 mip-t-events-api 部署 + health verified | ✅（invoke 健康门通过，persistence=cloudbase-mysql） |
| D2 | TEST 云函数 mip-t-identity-api 部署 + health verified | ✅ 同上 |
| D3 | TEST 云函数 mip-t-opportunities-api 部署 + health verified | ✅ 同上 |
| D4 | TEST 云函数 mip-t-admin-api 部署 + health verified | ✅ 同上 |
| D5 | PROD 云函数 mip-events-api 部署 + health verified | ✅（invoke 健康门通过） |
| D6 | PROD 云函数 mip-identity-api 部署 + health verified | ✅ 同上 |
| D7 | PROD 云函数 mip-opportunities-api 部署 + health verified | ✅ 同上 |
| D8 | PROD 云函数 mip-admin-api 部署 + health verified | ✅ 同上 |
| D9 | admin-web 静态部署 TEST（mip-admin-console-test/） | ⚠️ 上传成功 + 云端清单回读 60 文件通过；CDN 下载式回读与 HTTPS 送达被账号欠费 451 阻塞 |
| D10 | admin-web 静态部署 PROD（mip-admin-console/） | ⚠️ 上传成功 + 云端清单回读 115 文件通过；同上欠费阻塞 |
| D11 | MCP 守护进程 CAM 会话修复 | ✅（`CLOUDBASE_AUTH_MODE=local` 重启 mcporter daemon 后 Invoke 恢复，2026-10-12 同因先例） |

> **外部阻塞（需维护者处理）**：CloudBase 账号欠费，静态托管 CDN 侧 test.admin.mip.cool 与 admin.mip.cool 均返回 451「account is arrears…recharge」。云函数、MySQL、函数部署不受影响。充值后静态托管自动恢复送达；本轮静态文件已照常上传，HTTPS 送达验证与 admin 活体复测在恢复后补做。

## 二、小程序 Checklist（开发者工具重编译 + 聚焦 E2E）

DevTools 重编译：`MIP_ENV_DIR=envs/test pnpm build`（主包 1.12MB / member 1.04MB / admin 86.3KB）→ `cli open` → `runtime:preflight` 全绿（路由 52 条完整、登录态有效、服务端口 62842）。

| # | 项 | 对应任务 | 结果 |
| --- | --- | --- | --- |
| M1 | 活动详情页底栏无「取消报名/继续处理退款」按钮，已报名外观只留客服+分享 | MIW-128 | ✅ 真实页面两态节点查询为空 + 截图（shots/01、05） |
| M2 | 订单详情页新增「取消报名」入口卡片（含继续处理退款变体） | MIW-128 | ✅ 真实页面渲染（差分 +2 节点 + 截图 shots/04；订单数据模拟，SIM 单号） |
| M3 | 可取消订单：确认弹窗→取消成功→订单状态更新（幂等） | MIW-128 | ⏸ 真实支付订单取消待 iPhone 真机（既有边界）；确认弹窗/幂等/CONFLICT 由合同测试覆盖（verify:all 绿） |
| M4 | 不可取消订单不显示取消入口（服务端 canCancel 裁决） | MIW-128 | ✅ canCancel=false 时节点不渲染（差分法） |
| M5 | 免费活动直接报名成功：toast「报名成功」并自动返回活动详情页，不停留结果页 | MIW-129 | ⏸ 阻塞：automator 会话身份资料前置 + TEST 头像通道故障（10-24 同边界）；提交被守卫正确重定向资料页（守卫路径实证）；逻辑由合同测试 MIW-129 用例覆盖（绿） |
| M6 | 返回后详情页即呈现已报名态（缓存已失效） | MIW-129 | ⏸ 随 M5 同边界；缓存失效逻辑由合同测试覆盖 |
| M7 | 签到续办流保留结果页「继续签到」；候补/待审核/待支付等非直接成功态保留结果页 | MIW-129 边界 | ✅ 合同测试覆盖（verify:all 绿） |
| M8 | 小程序「我的」当前身份展示四类口径一致 | MIW-130 | ✅ 映射合同测试覆盖（绿）；动线进入依赖 M5 同款身份前置，现场画面待真机/体验包 |
| M9 | dist 健康：TDesign 嵌套依赖树存在、主包 < 2048KB | 发布门 | ✅ build 断言通过，主包 1.12MB（envs/test 构建） |

本批触碰的服务端路径经真实服务验证：E2E 的活动列表/详情数据全部来自新部署的 `mip-t-events-api`（真实 MySQL 响应→页面渲染）。

## 三、admin-web Checklist（桌面 1440 + 手机 390）

| # | 项 | 对应任务 | 结果 |
| --- | --- | --- | --- |
| A1 | 用户列表「当前角色」列按匿名访客/普通用户/嘉宾/玩家正确显示 | MIW-130 | ⏸ 活体复测被欠费 451 阻塞（两环境后台均不可达）；逻辑由 React/合同测试覆盖（350+283 绿），部署后待充值补测 |
| A2 | 身份筛选：按「匿名访客」筛选结果全部为匿名访客 | MIW-130 | ⏸ 同 A1 |
| A3 | 用户详情当前身份与列表一致 | MIW-130 | ⏸ 同 A1 |
| A4 | 历史数据口径：未绑手机号或资料未完善用户此前显示为普通用户，本轮起显示匿名访客（展示逻辑修正，无数据迁移） | MIW-130 | ✅ 只读审计完成（生产 34 用户中 25 个此前误标，属展示缺口）；活体复核随 A1 |
| A5 | 双视口（1440/390）布局无溢出 | MIW-130 | ✅ 响应式合同 + React 测试通过（verify:all）；欠费恢复后补线上双视口实拍 |
| A6 | 用户列表为真实非空服务端数据（非演示夹具） | 通用 | ⏸ 同 A1（服务端函数健康门已通过，users.list 真实调用待后台恢复后复核） |

## 四、test:runtime 漂移说明

31 passed / 13 external-wait / 8 failed（10-20 基线全绿）。逐条核对：8 个 failed 页面均不在本批改动范围；organizer avatar 返回 `cloud://` 为未被本批触碰的既有服务端设计（夹具数据漂移）；媒体类失败与 TEST 图片安全通道自 10-24 起故障相关。无本批回归证据；媒体通道与夹具漂移建议另行建卡。

## 五、真机待验（不在本轮自动化范围）

1. 真实已报名链路截图与报名成功 toast 自动返回（M5/M6 最终确认）
2. 真实支付订单上的取消报名操作（M3）
3. 原生手机号授权、扫码签到、真实支付与权益到账（每轮固定待真机项）
4. 体验版 1.2.9 · 生产环境真机确认

## 六、发布记录

| 项 | 值 |
| --- | --- |
| 版本 | 1.2.9（prod 通道，连接生产环境，烘焙只含 mip-*） |
| 源码 | `abad26ea`（origin/main 一致，工作区干净） |
| 门禁 | release 流程内完整 verify:all 再次通过 |
| 上传 | 2026-10-25 03:46 开发版本上传成功（.tmp/release-prod-1.2.9.json） |
| 待维护者 | 公众平台将该版本设为体验版；提审与公开发布未执行 |
