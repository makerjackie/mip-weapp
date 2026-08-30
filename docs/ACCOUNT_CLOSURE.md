# 账号注销合同

账号注销由 `mip-identity-api` 的 `closeAccount` mutation 完成。客户端只提交固定确认短语、当前 `mip_users.version` 和稳定幂等键；AppID、用户 ID、OpenID 和注销结果均由可信 CloudBase 上下文与服务端事实决定。

## 前置阻塞

注销事务先锁定当前微信身份和用户，再锁定并检查以下未结状态。任一存在时返回 `ACCOUNT_CLOSURE_PENDING_SETTLEMENT`，不写入部分注销结果：

- `mip_orders`: `CREATED`、`PAYMENT_CREATED`、`REFUND_PENDING`
- `mip_payment_attempts`: `CREATED`、`PARAMETERS_ISSUED`、`PENDING`
- `mip_refunds`: `PENDING`、`PROVIDER_CREATED`、`PROCESSING`
- `mip_event_registrations`: `PAYMENT_PENDING`、`CANCELLATION_PENDING`
- `mip_event_seat_holds`: `ACTIVE`

`expectedVersion` 防止使用过期账号状态提交；幂等键与确认短语、版本的请求摘要绑定。网络失败后客户端复用同一幂等键，完成记录只回放不重复执行。

## 注销事务会修改的表

| 表 | 处理 |
| --- | --- |
| `mip_users` | 状态改为 `CLOSED`，清空主分会，记录 `closed_at` 并增加版本 |
| `mip_user_identities` | 原身份摘要移入 `closed_identity_key`，运行身份改为不可匹配墓碑并清空 UnionID 摘要；同一当前 OpenID 仍会命中关闭记录，不会自动创建新账号 |
| `mip_profiles` / `mip_private_profiles` | 公开档案改为不可见占位内容；清空头像绑定、介绍、公司组织、手机号 hash/ciphertext 和验证时间 |
| `mip_branch_memberships` | 当前有效归属改为 `INACTIVE` |
| `mip_admin_role_bindings` | 所有有效角色改为 `REVOKED` |
| `mip_opportunities` / `mip_cooperation_cards` / `mip_super_cases` | 当前已发布内容改为 `UNPUBLISHED`；草稿和历史版本保留但不公开 |
| `mip_referral_intents` / `mip_profile_interests` | 用户发起、被引荐或指向用户/其机会的有效互动改为 `CANCELLED`；同步收敛机会的引荐计数 |
| `mip_user_blocks` | 用户主动发起的有效屏蔽改为 `INACTIVE`；他人主动屏蔽该用户的事实保留 |
| `mip_notification_grants` / `mip_delivery_tasks` | 将 `AVAILABLE` / `RESERVED` 授权改为 `REVOKED`，清空 reservation 与收件凭据并取消未完成外部投递 |
| `mip_admin_export_tickets` | 未消费导出票据改为 `REVOKED` |
| `mip_ai_drafts` | 清空音频绑定、转写和结构化草稿，状态改为 `DELETED`；已确认正式资源由其领域表保留 |
| `mip_ai_draft_requests` | 清空全部响应内容，未完成请求改为 `FAILED` 并记录 `ACCOUNT_CLOSED`；保留稳定请求事实避免注销后重放 |
| `mip_membership_invitation_codes` | 将 `PENDING` / `READY` 邀请码改为 `EXPIRED` 并清空生成租约；保留 allocation 与对象引用供受控清理 |
| `mip_idempotency_keys` / `mip_audit_logs` | 保存幂等响应并追加 `IDENTITY_ACCOUNT_CLOSED` 审计；审计元数据只含受影响行数 |

注销不投递 outbox。`CLOSED` 与身份墓碑在事务提交后立即生效，通知 worker 也会重新验证有效用户；注销本身没有需要发送给其他用户的业务通知。

## 外部上传与注销并发

图片、AI 语音和签到海报上传成功并通过对象范围校验后，先写入 `owner_user_id=NULL`、`status=PENDING` 的非公开清理事实，再进入锁定 `ACTIVE` 用户的最终事务。只有该事务能够绑定 owner 并把素材改为 `READY`；AI 语音同时创建草稿。注销先提交时，最终事务不会写入 `READY` 或业务草稿。

最终事务报错时不能直接删除对象。服务先按 AppID 和素材 ID 重读：已经是当前 owner 的 `READY` 表示事务已提交，保留对象并恢复成功结果；明确为 ownerless `PENDING` 或明确不存在时才尝试精确删除。只有 CloudBase 返回同一文件 ID 且状态成功后才把已有 tombstone 改为 `DELETED`；删除失败、响应不明确或最终状态更新失败均保留 `PENDING`。图片和签到海报由媒体孤儿清理重试，ownerless AI 语音由 AI app-scoped 清理在租约到期后重试，清理时仍校验 AppID 范围和完整 object key。

对象存储上传和 MySQL 写入无法形成同一原子事务。若首次 tombstone 写入明确未发生，服务会重试登记后再删除；若数据库状态读取本身不确定，则为避免误删可能已经提交的 `READY` 对象，服务不会继续删除。数据库明确无记录且精确存储删除也失败时，仍可能留下无法从 MySQL 枚举的对象，这是现有 CloudBase 存储接口下的剩余边界；该请求返回失败，运营排查需同时核对该时间窗的函数错误和 `mip/` 私有对象清单。

管理导出下载在最终授权事务中同时锁定 `ACTIVE` 用户、当前角色与 capability、导出票据，并在保持这些锁时完成私有文件读取、摘要校验和临时地址签发。该事务禁用死锁自动重试，避免重复签发。若注销先提交，新的签发请求会被拒绝；若签发先完成，注销事务会等待该授权事务结束后再撤销票据。CloudBase 已签发的 HTTPS 临时地址不能通过数据库票据撤销即时收回；当前有效期不超过 120 秒，且不超过票据的下载租约。这个已签发的短时窗口是现有存储机制的剩余风险；客户端完成下载后仍会消费一次性票据并尝试删除私有对象。CloudBase SDK 调用本身无法强制取消；超时后事务回滚，未开始的签发不再执行，已在进行的签发结果会被丢弃，不返回客户端、不提交票据与审计。

## 明确保留的事实

以下数据不物理删除，也不伪造终态：

- 订单、支付尝试、支付回调、退款、会员权益和邀请归属：`mip_orders`、`mip_payment_attempts`、`mip_payment_callbacks`、`mip_refunds`、`mip_membership_entitlements`、`mip_membership_attributions`
- 全部活动业务事实：`mip_events`、`mip_event_changes`、`mip_event_seat_holds`、`mip_event_registrations`、邀请归属、签到凭据、签到、心动和反馈
- 成长余额与只追加流水：`mip_growth_accounts`、`mip_growth_entries`
- 协议接受、举报、访问控制、运营消息、站内消息、审计和已完成通知事实
- `mip_profile_tags` 与已解绑 `mip_media_assets` 记录；用户 `CLOSED` 后它们不进入公开查询，媒体对象后续只通过受控孤儿清理处理

## 迁移与回滚

结构由 `011_account_closure.sql` 追加，并为迁移前已经是 `CLOSED` 的用户补齐关闭时间和身份墓碑。rollback 只移除 `closed_at`、`closed_identity_key`、索引和 CHECK，不尝试恢复已匿名化的档案、手机号、UnionID 或运行身份摘要。只要环境中存在已关闭账号，就不得把结构 rollback 当作账号恢复工具；恢复诉求只能走新的受审计迁移和人工流程。

真机/生产仍需验证：微信上下文下注销后重新进入不会创建新账号；支付、退款和活动退款处理中能正确阻塞；共享 CloudBase runtime 账号已获得 `mip_user_identities.UPDATE` 且没有额外权限。
