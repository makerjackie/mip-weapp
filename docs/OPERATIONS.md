# Operations

运营工作台是任务入口，不是报表大屏。入口：`packages/admin/dashboard`。

- 活动：统一列表 → 单场管理 → 编辑/名单/相册/团队
- 退款：服务端角色校验；到账后重算权益
- 名册导出：含手机号的导出走安全票据，页面只显示掩码票码
- 公告与举报：版本冲突保护；举报需原因，无批量封禁
- owner 引导：`pnpm admin:bootstrap`，拒绝 demo 身份

脚本产物不得写入 EnvID 或 OpenID。完整活动操作说明可参考仍保留的页面规格 `page-specs.md`。
