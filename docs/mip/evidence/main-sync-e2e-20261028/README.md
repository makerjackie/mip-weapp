# 主分支同步端到端验收（2026-10-28）

本机从 `437734b6` pull 到 `47e41191`（fast-forward，15 个提交，97 文件 +2690/-39），对本批变化做 diff，并在测试环境完成端到端验收。对照报告（diff summary）由本轮临时目录本地服务提供，不写入仓库。

## 关键事实

- **部署源码与本轮 HEAD 运行时代码零差异**：TEST 包 `1.2.11-test.1027` 的源码 `2a22bdc9` 与 `47e41191` 在 `src/`、`cloudfunctions/`、`packages/`、`admin-web/` 上 `git diff --stat` 为空。`2a22bdc9` 之后的提交只有测试夹具格式化、验收站脚本与样式、证据与规范文档。因此 10-27 批次的 TEST 部署与运行证据对当前 HEAD 依然有效。
- **本轮发现并修复一个门禁缺陷**：`2a22bdc9` 之后补入的 `scripts/acceptance-reader/reader.css`（验收站"原始反馈展开"样式）带 11 处 prettier 格式错误，pull 后本机 `pnpm verify:all` 在 lint 阶段失败——说明该功能提交（`cedb8f53` 等）合入前未重跑完整门禁。已用 `eslint --fix` 修复并复检通过；**修复目前只在本机工作区，未提交**，远端 main 在修复合入前无法复现全绿。

## 分层验证结果（本机，2026-10-28）

| 层 | 结果 | 证据 |
| --- | --- | --- |
| 静态/本地行为 | 通过（修复 reader.css 后） | `pnpm verify:all` EXIT:0：小程序 295 文件/1908 用例、Web 42 文件/283 用例全绿；主包 1,365,295B < 2048KB；架构/安全/迁移锁（114）契约通过。[门禁日志](verify-all-47e41191.log) |
| 小程序运行时 | 通过 | `pnpm runtime:preflight` ok：DevTools 在线登录、服务端口 62842、compile hot reload、主包+分包路由完整、真实 AppId 与私钥匹配 |
| TEST 环境（CloudBase） | 通道与站点可用 | `pnpm cloud:status`：env READY、management API Key verified；[批次部署证据](../feedback-20261027/delivery.json)：TEST 函数 events@`d11d51cb`、opportunities@`48ce45fc` 部署并回读，配置保留；本轮未重新部署（代码无差异，无需部署） |
| 验收站 | 在线且内容正确 | `https://miptest.01mvp.com/` 200；`/updates/2026-10-27/` 200（32,172B），含锚点 `feedback-20261027-v1`×4、"原始反馈"×31、"沙龙"×5、"热门"×15、"未读"×5；测试后台 `https://test.admin.mip.cool/` 200 |
| 真机 | 未执行（沿用批次边界） | 手机原生唤起、访客视角、支付/手机号仍待真机；体验版指派未核实；生产未发布，等待用户对本批验收确认 |

业务功能本身的服务端与页面证据由 10-27 批次在同一运行时代码上完成（9 项反馈逐项回归，含未读角标 1→0 真实 TEST 包回归、后台标签配置→小程序结果配对、保存即发布 DRAFT→PUBLISHED 回读），见 [feedback-20261027/README.md](../feedback-20261027/README.md) 与 [verification.json](../feedback-20261027/verification.json)；本轮核实了该证据与当前 HEAD 的代码一致性，未重复采集业务截图。

## 本批业务变化（diff 摘要）

1. **活动标签全链路**：后台配置的自定义标签（如"沙龙"）在活动列表与"我的活动"卡片显示；有标签时不再重复旧类型文案，无标签历史活动保留兼容文案（`mip-activity-card`、`mip-events/mine`）。
2. **活动日历可取消**：再次点击已选日期取消选中；确认空选回"近期"筛选；关闭面板不改变已生效筛选（`pages/events`）。
3. **合作卡保存即发布**：编辑器保存直接 PUBLISHED 且版本递增，toast"合作卡已保存并展示"；配套修复 opportunities 内容安全通道（app 级 HTTP msgSecCheck，`MIP_WECHAT_APP_ID/SECRET` 注入，公网出站），失败不绕过检查。
4. **未读角标即时同步**：消息模块未读数主动通知全部已挂载 TabBar，读后立即清零，组件销毁退订（`custom-tab-bar`、`mip-messaging`）。
5. **个人页身份与热门行业**：当前身份状态改按 careerIdentityKey 映射展示；编辑页新增 13 个热门行业快选（读服务目录）。
6. **分享链接域名兼容**：微信官方 URL Link 现返回 `wxmpurl.cn`，白名单加入该确切域名，仍拒绝仿冒后缀、HTTP 与带凭证 URL；失败日志新增阶段码。
7. **验收站增强**：每个结果可展开"原始反馈"（原文+原截图），修复成果图直接展示；10-27 模板定为项目验收标准。
8. **发布流程规范**：两阶段发布写入规范——测试验收通过且用户确认后才发布生产（AGENTS、DEPLOYMENT、ACCEPTANCE、澄清记录、release skills）。

对照明细与前后截图见本轮 diff summary 报告（本地服务链接见交付说明）。

## 遗留与待办

- **reader.css 格式修复未提交**：需要提交并推送后，远端 main 才能通过完整门禁；推送由维护者确认。
- 真机复测项不变：手机原生唤起分享链接、访客视角、支付与手机号能力。
- 体验版指派未核实；本批生产发布必须等待用户明确确认（2026-10-27 已确认的两阶段流程）。
