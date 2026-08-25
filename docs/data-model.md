# MIP MySQL 8 数据模型

MIP 的运行时数据位于 `database/mysql/mip/`，迁移跟踪表为 `mip_schema_migrations`。所有业务表使用 InnoDB、`utf8mb4`、UTC `DATETIME(3)` 和可信 `app_id`；金额使用 CNY 整数分。仓库不保存或执行其他项目的 schema。

## 表清单

| 迁移域 | 表 |
| --- | --- |
| 基础身份 | `mip_users`, `mip_user_identities`, `mip_media_assets`, `mip_city_branches`, `mip_branch_memberships`, `mip_profiles`, `mip_private_profiles`, `mip_agreement_acceptances`, `mip_tags`, `mip_profile_tags`, `mip_admin_role_bindings`, `mip_app_settings`, `mip_idempotency_keys`, `mip_outbox_events`, `mip_audit_logs` |
| 活动和交易 | `mip_membership_plans`, `mip_orders`, `mip_events`, `mip_event_changes`, `mip_event_seat_holds`, `mip_event_registrations`, `mip_event_invitation_attributions`, `mip_event_checkin_credentials`, `mip_event_checkins`, `mip_event_checkin_transitions`, `mip_event_hearts`, `mip_event_feedback`, `mip_event_album_photos` |
| 机会和协作 | `mip_opportunities`, `mip_opportunity_roles`, `mip_opportunity_tags`, `mip_referral_intents`, `mip_profile_interests`, `mip_cooperation_cards`, `mip_super_cases`, `mip_super_case_media`, `mip_opportunity_comment_settings`, `mip_opportunity_comments`, `mip_opportunity_comment_calls`, `mip_opportunity_comment_reports` |
| 社区安全 | `mip_user_blocks`, `mip_reports` |
| 公告 | `mip_announcements` |
| 支付和权益 | `mip_payment_attempts`, `mip_refunds`, `mip_membership_entitlements`, `mip_membership_attributions`, `mip_payment_callbacks` |
| 成长、消息和 AI | `mip_growth_levels`, `mip_growth_rules`, `mip_growth_accounts`, `mip_growth_entries`, `mip_operations_messages`, `mip_inbox_messages`, `mip_notification_grants`, `mip_delivery_tasks`, `mip_message_delivery_reviews`, `mip_ai_drafts` |
| 管理 | `mip_user_access_controls`, `mip_admin_export_tickets` |

迁移文件和 lock 文件是字段、CHECK、外键、索引、版本与 checksum 的唯一事实；本文只说明跨域关系和运行时约束，不替代 SQL。

## 核心关系

```text
mip_users
  ├─ mip_user_identities / mip_profiles / mip_private_profiles
  ├─ mip_branch_memberships → mip_city_branches
  ├─ mip_membership_entitlements ← mip_orders ← mip_membership_plans
  ├─ mip_events → mip_event_registrations → mip_event_checkins → mip_event_checkin_transitions
  │             └─ mip_event_album_photos → mip_media_assets
  ├─ mip_opportunities → mip_referral_intents
  ├─ mip_user_blocks / mip_reports
  ├─ mip_announcements → mip_city_branches / mip_events / mip_opportunities
  ├─ mip_growth_accounts → mip_growth_entries
  └─ mip_operations_messages → mip_inbox_messages → mip_delivery_tasks
```

所有关系都使用 `(app_id, id)` 或 `(app_id, user_id)` 复合外键/唯一键，避免共享 CloudBase 环境中的跨 AppID 串读。对象资源通过 `mip_media_assets` 关联，`object_key` 必须以 `mip/` 开头；删除媒体前必须先解除业务外键。

## 统一订单模型

`mip_orders` 是会员和活动的唯一交易容器：

| `order_type` | 关系 | 支付后事实 |
| --- | --- | --- |
| `MEMBERSHIP` | `membership_plan_id` 非空，`resource_id` 为空 | ledger 更新 `PAID`，重建 `mip_membership_entitlements` |
| `EVENT` | `resource_id` 非空，`membership_plan_id` 为空 | ledger 消耗 `mip_event_seat_holds`，把报名收敛为正式资格 |

订单同时保存 `merchant_order_no`、可选 provider transaction ID、幂等键、金额、货币、商品快照、支付状态和版本。状态包括 `CREATED`、`PAYMENT_CREATED`、`PAID`、`FAILED`、`CLOSED`、`REFUND_PENDING`、`PARTIALLY_REFUNDED`、`REFUNDED`。所有写入由 commerce/ledger 事务完成，客户端不能改变金额、状态或权益。

## 身份、分会和管理

- `mip_users.status` 为 `ACTIVE`、`BLOCKED`、`CLOSED`；`CLOSED` 必须带 `closed_at`。主分会通过 `mip_branch_memberships` 约束归属。注销时 `mip_user_identities.closed_identity_key` 保留不可逆身份墓碑，运行身份摘要不再供其他领域解析。
- `mip_profiles` 保存公开资料和可见性 JSON；`mip_private_profiles` 仅保存手机号 hash、加密 ciphertext 和验证时间。
- `mip_admin_role_bindings` 记录平台、分会或活动范围的角色绑定；`mip_user_access_controls` 记录用户级 allow/block 控制。页面只接收 capability，不以菜单显示决定权限。
- `mip_audit_logs` 是追加事实，runtime 账号只允许 `SELECT`、`INSERT`；导出只通过 `mip_admin_export_tickets` 的短期票据消费。

## 活动和报名

`mip_events` 支持 `OFFLINE`、`ONLINE`、`HYBRID`，范围为平台或城市分会；`access_type` 为 `FREE`、`MEMBER_INCLUDED`、`PAID`。付费活动必须 `registration_policy=AUTO`、`waitlist_enabled=0` 且 `price_cents>0`。已发布内容变更追加到 `mip_event_changes`，不覆盖历史事实。

`mip_event_registrations.status` 允许：

`PENDING_REVIEW`、`WAITLISTED`、`PAYMENT_PENDING`、`REGISTERED`、`CANCELLATION_PENDING`、`CANCELLED`、`REJECTED`、`ATTENDED`。

付费活动先创建 `mip_event_seat_holds` 和报名记录；支付回调在 ledger 事务中校验 hold 尚未过期后完成报名。名额、候补、取消、签到和撤销签到使用行锁、版本号和幂等键；活动取消不得抹除已发生的 `ATTENDED`。

`mip_event_checkin_credentials` 只保存短期 token hash，`mip_event_checkins` 保存当前到场状态，`mip_event_checkin_transitions` 只追加每轮签到和撤销。撤销显式关联原签到 transition，与 outbox 同一事务写入。凭证不包含 OpenID、手机号或可预测票码。

`mip_events.album_enabled` 控制相册入口，`album_submission_policy` 为 `AUTO` 或 `REVIEW`。`mip_event_album_photos` 只允许 `PENDING`、`PUBLISHED`、`REJECTED`、`WITHDRAWN`，素材唯一绑定一个照片事实；提交、审核和本人撤回都以 AppID、活动、用户、版本和 `EVENT_ALBUM` 素材状态为边界。拒绝或撤回后照片记录保留，媒体对象可在最短保留期后由受控孤儿清理回收。

## 机会、成长、消息和 AI

- `mip_opportunities`、`mip_cooperation_cards`、`mip_super_cases` 等内容表都带状态、版本和内容安全状态；关系表使用 app-scoped 复合主键。机会草稿通过 `ARCHIVED` 保留归档时间、操作人和原因，不物理删除。
- 机会评论支持普通评论和结束后的项目评价。参与人标识由发布人或团队关系推导；编辑限时、删除、隐藏和举报均保留状态与版本，打 call 使用独立关系表和服务端计数。
- `mip_user_blocks` 保存可解除的主动屏蔽关系；公开档案和公共列表按已识别查看者双向过滤 `ACTIVE` 屏蔽。`mip_reports` 保存幂等举报和审核版本，不生成对方通知，也不自动改变用户状态。
- `mip_announcements` 保存平台或城市分会公告、展示窗口、内容安全结果和可选活动/机会关联；草稿、发布、撤回和置顶都保留版本与审计，不提供物理删除。
- `mip_growth_levels` 和 `mip_growth_rules` 是配置；`mip_growth_accounts` 是余额快照；`mip_growth_entries` 只追加，每个用户/来源/指标保持幂等。签到撤销的反向流水引用撤销 transition，delta 等于原实际入账值的反数，不依赖后续修改的规则。
- `mip_inbox_messages` 以收件人和 dedupe key 唯一，是站内消息事实；`mip_notification_grants` 记录用户手势授权，并用任务、随机 token 和租约表达 `RESERVED` 状态；`mip_delivery_tasks` 使用 lease、attempts 和可恢复状态，不由高频 timer 驱动。reservation 使用短事务；实际微信调用和最终状态写入由锁定 `ACTIVE` 用户、任务及授权的专用投递事务串行化，完整边界见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。
- `mip_message_delivery_reviews` 通过 `(app_id, source_type, source_id)` 唯一关联消息活动派发或投递任务，只保存证据哈希和 `OPEN | CLAIMED | RESOLVED` 工作流。来源状态、正文、收件人和 provider 结论不复制到该表；已闭环来源只有在新证据再次属于处理超时、结果未知或终止失败时重新成为活动项，后续成功或安全自动重试保持已闭环。同一行只表达最新复核状态，状态变更由审计流水留痕。
- `mip_operations_messages` 是按收件人展开的不可变运营发布事实，以 `(app_id, publication_id, recipient_user_id)` 去重。范围、创建者、活动目标和可选订阅消息快照都保留在服务端；runtime 账号只允许读取和追加。
- `mip_ai_drafts` 的状态由 `UPLOADED`、`TRANSCRIBING`、`STRUCTURING`、`DRAFT_READY`、`FAILED`、`CONFIRMED`、`EXPIRED`、`DELETED` 组成。只有 `CONFIRMED` 才能关联正式资源。

## 迁移与权限

迁移必须追加，不得修改已应用 migration 的 SQL/checksum；完整版本写入 `mip_schema_migrations`，语句级状态写入 `mip_schema_migration_steps`。执行器要求显式 `--confirm-env=<精确 EnvID>` 和 `--confirm-prefix=mip_`，待应用迁移或首次安装 step journal 时必须提供仓库外逻辑备份。任何 `RUNNING` 状态都按不确定 DDL 失败关闭，先恢复或人工核对，不自动重放。部署前后复核 MIP 表清单、runtime table→privilege 映射、函数健康和通知 timer 缺失。

runtime 账号只拥有代码实际使用的 `mip_*` 表级权限：无 schema-level `ALL PRIVILEGES`、无全局权限和无业务需要的 `DELETE`。共享环境中的 `member_*`、`dating_*`、`sewing_*` 表保持只读，不纳入 MIP 迁移、seed 或函数连接。

账号注销的状态撤销、数据最小化、事实保留和不可逆 rollback 约束见 [ACCOUNT_CLOSURE.md](ACCOUNT_CLOSURE.md)。
