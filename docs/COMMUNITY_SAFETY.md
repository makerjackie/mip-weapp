# 社区安全

MIP 的社区安全入口位于公开档案和“隐私与账号”。用户完成互动所需身份信息后，可以举报或屏蔽其他用户；不能对自己操作。

## 用户合同

- 客户端只提交 AppID 绑定的 `profileRef`，不提交或接收目标用户 ID、OpenID。
- 举报类别固定为垃圾信息、骚扰行为、欺诈风险、不当内容、冒充他人和其他问题；补充说明可不填，最多 300 字。
- 一次举报意图使用稳定 `requestId`。网络失败重试相同类别、说明和目标时复用该标识；相同标识携带不同内容会被拒绝。
- 举报只形成待审核事实，不通知目标用户，也不自动处罚或改变账号状态。
- 屏蔽不通知对方，不影响已经产生的订单和活动报名。用户可在屏蔽列表解除屏蔽。

## 服务端合同

`mip-community-api` 是自包含 CloudBase 函数。可信 AppID 和微信身份来自 CloudBase 上下文；函数通过 `MIP_IDENTITY_PEPPER` 解析身份摘要和 AppID 绑定的 `profileRef`。所有查询都带 `app_id`。

`mip_user_blocks` 保存主动屏蔽、解除时间和版本。已识别查看者与目标之间任一方向存在 `ACTIVE` 屏蔽时，公开档案读取失败；机会、合作卡、超级案例、活动参与人、心动和收到的互动等已接入列表按同一关系过滤。匿名浏览没有可用于匹配屏蔽关系的本地用户事实，保持原公开范围。

机会评论列表和打 call 同样执行双向屏蔽过滤。评论举报写入独立的 `mip_opportunity_comment_reports`，复用固定举报类别和“不通知目标、不自动处罚”的原则；运营处理举报与隐藏评论是两个显式动作，均使用 `messages.manage`、资源范围、乐观锁和追加审计。

`mip_reports` 以 `(app_id, reporter_user_id, request_id)` 保证幂等，保存审核版本、审核人、审核时间和结论。用户函数只允许新增举报；运营审核另由 capability、乐观锁和不可变审计控制。

## 运营审核合同

- 独立页面 `packages/admin/community-reports/index` 只允许拥有平台范围 `community.reports.manage` capability 的 `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS` 使用。
- 列表按 `PENDING`、`REVIEWING`、`RESOLVED`、`DISMISSED` 查询当前 App 的举报，返回固定类别、说明、时间、版本，以及举报人和目标用户按公开可见性脱敏后的昵称、简介和城市摘要；不返回手机号、OpenID 或内部用户 ID。
- 状态机固定为 `PENDING → REVIEWING → RESOLVED | DISMISSED`。领取、处理和驳回都提交 `expectedVersion` 和 1–300 字原因；服务端事务内锁定事实、校验状态与版本，并仅在成功后追加审计。
- 领取原因仅写审计，结论原因写入举报事实。版本或状态已变化时返回稳定冲突，管理端重新加载后再操作。
- 当前审核只更新举报事实，不自动封禁账号、隐藏资料、解除关系或向被举报用户发送消息；这些动作需要以后单独定义权限和工作流。

## 验收

- 服务端定向测试：`node --test cloudfunctions/mip-community-api/tests/*.test.js`
- 客户端和迁移合同：`pnpm vitest run tests/mip-community-safety.test.ts tests/mip-migrations.test.ts`
- 管理端审核：`node --test cloudfunctions/mip-admin-api/tests/*.test.js && pnpm vitest run tests/mip-admin.test.ts`
- 静态门禁：`pnpm verify:source && pnpm verify:server`
- 运行时仍需在微信开发者工具验证公开档案操作、身份恢复、空列表、失败重试和解除屏蔽。
