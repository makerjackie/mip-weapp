# 用户角色四需求 · E2E 复测（2026-10-22）

对 10-21 落地的四项用户角色规则需求（`6a5ec139` feat: align user roles, profile requirements and roster consent）做的独立 E2E 复测。执行者 ZCode，独立于实现会话；全程只读验收（SELECT-only SQL + QUERY-only 后台 action），零业务写入。

**结论：4/4 需求通过。** 明细见 [report.html](report.html)。

## 范围

| 需求 | 结论 |
|---|---|
| R1 后台用户管理正确显示 匿名访客/普通用户/嘉宾/玩家 | 通过（匿名访客为会话状态不落库，后台无 ANONYMOUS 伪用户） |
| R2 报名成功未签到的普通用户进入活动参与人嘉宾列表 | 通过（嘉宾 6 = 4 已签到 + 2 已报名未签到，玩家 1） |
| R3 登录后资料表单除性别外全部必填 | 服务端/表单层通过；小程序真实页面保存流待 DevTools 重新登录补测 |
| R4 人才合作列表只显示 嘉宾(最新花名册=愿意) 和玩家 | 通过（合格恰 3 人：嘉宾愿意、到期嘉宾、玩家） |

## 证据层

1. **单测/合同**：identity 111、admin-api 787、events-api 194+1 跳过（需 SQL 直连，由第 2 层等效覆盖）、opportunities 167、admin-web 合同 339、小程序 profile/opportunities 16，全绿。
2. **真实测试库推导**：以云函数同源 SQL 片段在 `mip_test` 只读推导 7 个「验收1021」合成用户的角色、花名册最新选择、人才资格、资料完整度 → [fixture-matrix.json](fixture-matrix.json)、[event-matrix.json](event-matrix.json)。
3. **真实测试后台 API**：HTTPS 登录 test.admin.mip.cool 后 26 项只读检查全部通过，期望值全部来自第 2 层推导 → [admin-live.json](admin-live.json)（用户 ID 仅哈希，无凭据/Cookie）。
4. **界面实拍**：用户列表桌面 1440×900 / 搜索 / 身份=嘉宾筛选 / 手机 390×844，活动详情参与情况与报名名单、反馈花名册意愿列 → [shots/](shots/)。
5. **部署身份**：`991796d7..HEAD` 对 cloudfunctions/admin-web/contracts/database/mip-profile 零改动；SCF 回读 5 个测试函数 ModTime 仍为 10-21 18:16–18:18 部署窗口 → [function-source.json](function-source.json)。
6. **门禁**：`pnpm verify:all` 退出码 0（小程序 vitest 1891、后台 Node 339+、React 262、verify:server 731 受管源）；`git diff --check` 干净。HEAD `f97398cb`。

## 待验收（不视为已通过）

- DevTools 登录态失效（需用户扫码）：小程序真实页面链路 —— 匿名访客强制资料流保存回读、活动参与人嘉宾页签实拍、人才合作列表实拍。
- 真机项沿用上一轮清单（手机号/扫码签到/支付/订阅消息）。
- 状态迁移类操作（签到撤销、反馈改选、权益到期翻转）本轮未执行写入，依据上一轮变更证据 + 本轮真实库终态 + 单测覆盖。

原始账号信息、数据库连接、二维码与本轮完整请求日志留在本机 `.tmp/`（不入库）。
