# MySQL 8 数据模型

会员案例复用现有 CloudBase MySQL 8 环境。v0.2 权威定义在 `database/mysql/` 的版本化迁移中，新代码只使用 `member_*` 表，不读取或写入 v0.1 的 `dating_*` 和旧 `membership_plans`。

| 表 | 主键/租户键 | 写入方 |
| --- | --- | --- |
| `member_profiles` | UUID；`app_id + user_id` 或 demo `external_key` 唯一 | `mip-api` / `mip-admin-api` / dev seed |
| `member_private_profiles` | `app_id + user_id` | `mip-api` 手机号换取 |
| `member_media_assets` | UUID；`app_id + asset_key + content_version` 唯一 | 受控上传/seed 工具 |
| `member_plans` | `app_id + id` | 迁移/运营工具 |
| `member_entitlements` | UUID；`app_id + user_id` 唯一 | 仅支付 ledger 事务 |
| `member_events` | UUID；demo 可用 `app_id + external_key` | `mip-admin-api` / dev seed |
| `member_orders` | UUID；幂等键与商户单号均包含 app scope | 下单事务；支付 ledger 更新 |
| `member_registrations` | UUID；`app_id + event_id + user_id` 唯一 | 报名/取消/签到事务 |
| `member_event_reservations` | UUID；`app_id + order_id` 唯一 | 独立付费活动预约；支付 ledger 转换为报名 |
| `member_event_managers` | `app_id + event_id + user_id` | 活动级分角色授权 |
| `member_event_photos` | UUID；活动/状态/时间复合索引 | 用户上传；活动相册审核 |
| `member_checkin_credentials` | UUID；`app_id + token_hash` 唯一 | 服务端签发短期二维码签到凭证 |
| `member_follows` | `app_id + follower_user_id + followee_user_id` | 成员关注关系 |
| `member_event_changes` | auto increment bigint；`app_id + event_id + created_at` | 活动编辑/发布/取消事务只追加 |
| `member_admin_roles` | `app_id + user_id` | 一次性 owner bootstrap / 可信运营工具 |
| `member_refunds` | UUID；订单与退款单号包含 app scope | 运营退款事务；支付 ledger 更新 |
| `member_audit_logs` | auto increment bigint；`app_id` 索引 | 业务函数只追加（runtime 无 UPDATE/DELETE） |
| `member_media_cleanup_outbox` | `(app_id, media_asset_id)` 唯一；status/lease/version | 账号注销后可执行对象清理；DONE 仅在 deleteFile 逐项 status 成功后 |
| `member_notifications` | UUID；业务来源版本幂等 | 通知 worker 被受控调用时写；当前用户读取/标记已读 |
| `member_notification_subscriptions` | UUID；按用户、活动和模板索引 | `mip-api` 保存真机订阅结果；worker 成功送达后消耗 |
| `member_notification_outbox` | UUID；业务来源版本幂等；status/lease/attempts | 通知 worker 被受控调用时领取、发送和收敛 |
| `member_operational_failures` | UUID；`app_id + status + category + updated_at` | 上传/安全审核失败时只记录有限错误码，不保存图片或 provider 原文 |

## 关键约束

- 表使用 InnoDB、`utf8mb4`、参数化查询和 UTC `DATETIME(3)`。客户端 ISO 时间在服务端解析后按 UTC 存储，页面只做本地化显示。
- 金额统一整数分，货币当前固定 `CNY`；数组和审计 metadata 使用 MySQL `JSON`。
- 每个用户查询、公开内容查询、订单、报名、管理员和审计都必须带服务端可信 `app_id`。多租户隔离永不接受客户端 ownership。
- 方案价格、权益天数、会员资格、名额、支付金额和退款金额在 MySQL 事务中重建，不能信任客户端。
- 支付/退款回调在 `mip-payment-ledger` 中使用 `SELECT ... FOR UPDATE` 和条件状态更新；只有事务提交成功才向微信返回成功。
- 退款后根据全部仍为 `PAID` 的订单重算权益，因此退款较早订单不会误删后续购买的有效期。
- demo 内容统一 `is_demo=1`，素材记录 provenance、SHA-256、尺寸和版本；production 禁止 seed。
- `database/mysql/migrations.lock.json` 固定 migration 和 rollback 的 SHA-256；锁定文件不可原地修改，修复必须追加新迁移。

## 活动履约字段（002）

`001` 已提供 `member_events.registration_deadline`、`address`、`cover_asset_id` 与基础报名表。`002_activity_operations` 只追加履约与取消收敛所需列：

### `member_events`

| 列 | 含义 |
| --- | --- |
| `venue_name` | 结构化场地名；`location` 保留为兼容展示字段 |
| `address` | 详细地址（001 已有，002 不重复创建） |
| `cancellation_policy` | 取消规则文案 |
| `cancelled_at` / `cancelled_by` / `cancellation_reason` | 主办方取消元数据 |
| `version` | 运营编辑乐观锁，从 1 递增 |
| `registration_deadline` / `cover_asset_id` | 001 已有，合同正式启用 |

活动状态机：`DRAFT → PUBLISHED → COMPLETED`；未开始的 `DRAFT/PUBLISHED → CANCELLED`；`CANCELLED` 与 `COMPLETED` 均为终态，不可重开。

活动类型由 domain 集中映射，页面不得自行拼布尔值：

| 类型 | 存储语义 |
| --- | --- |
| `PUBLIC_FREE` | `price_cents=0` 且 `member_free=0` |
| `MEMBER_INCLUDED` | `price_cents=0` 且 `member_free=1`（仅会员可报名，费用已包含） |
| `PAID` | `price_cents>0` 且 `member_free=0` |

`price_cents>0 && member_free=1` 不受支持，服务端在写库前拒绝。

### `member_registrations`

| 列 | 含义 |
| --- | --- |
| `ticket_code` | 票码；`app_id + ticket_code` 唯一；对外只展示掩码，不可当身份凭证，日志必须掩码 |
| `attended_at` / `attended_by` | 签到时间与操作者 |
| `cancelled_at` / `cancelled_by_type` / `cancellation_reason` | 取消元数据；`cancelled_by_type ∈ MEMBER\|EVENT\|SYSTEM` |
| `version` | 签到/撤销等 mutation 的乐观锁 |

报名状态机：`REGISTERED → ATTENDED`、`REGISTERED → CANCELLED`、`ATTENDED → REGISTERED`（仅撤销误签到）。付费取消先进入 `CANCELLATION_PENDING`，只有退款终态才进入 `CANCELLED`；退款提交失败时，活动仍有效则恢复 `REGISTERED`，活动已经取消则保留待退款状态供运营重试。`CANCELLED → REGISTERED` 的重新报名由报名事务控制，不作为自由状态迁移。主办方取消活动只收敛仍为 `REGISTERED` 的报名，**不得抹除历史 `ATTENDED` 事实**。

## 完整活动平台（005）

- `member_profiles` 增加组织、职务、行业、兴趣、技能和资料版本，组成可复用成员名片；敏感手机号仍只在私密表。
- `member_events` 增加活动须知、版本化自定义报名表、相册策略和海报素材引用。
- `member_registrations` 固化报名时的表单版本与答案快照，后续编辑活动不会改写历史报名事实。
- 独立付费活动先锁定短期 `member_event_reservations`，支付回调在可信 ledger 中转换为正式报名，避免“已付费但名额被抢”。
- `008_event_role_simplification.sql` 将活动级角色收敛为活动负责人、活动管理员、现场工作人员三类；全局运营角色仍由 `member_admin_roles` 管理。
- 相册原图先由客户端按用途自适应压缩，服务端再次完整解码、统一重编码并校验格式、体积、内容安全和归属；CloudBase 基础图片处理只用于头像/封面/相册展示衍生图，是否直接发布仍由活动审核策略决定。
- 签到二维码不包含 OpenID、手机号或可预测票码，只携带服务端短期凭证；扫码后仍执行活动权限、状态和版本检查。

## 历史票码收敛（006）

- 对 002 迁移前已经存在、仍为 `REGISTERED` / `ATTENDED` 且没有 `ticket_code` 的报名记录执行一次性确定性回填。
- 回填只补充便于人工核对和名单搜索的稳定票码；现场签到仍使用五分钟有效、可消费的动态二维码凭证。
- 读取报名历史保持零写入，页面刷新不会偷偷修改票码或审计时间。

## 活动增长能力（007）

- `member_events.registration_mode` 为 `AUTO | APPROVAL`；`waitlist_enabled` 控制满员后是否允许候补。
- `member_events.event_mode` 为 `OFFLINE | ONLINE | HYBRID`；坐标成对保存，线上链接只在服务端授权后返回。
- `member_registrations.status` 扩展为 `PENDING_REVIEW | WAITLISTED | REGISTERED | CANCELLATION_PENDING | CANCELLED | REJECTED | ATTENDED`。其中只有 `REGISTERED`、`CANCELLATION_PENDING`、`ATTENDED` 占用名额。
- 审核记录保存审核时间、审核人和拒绝原因；候补记录保存进入队列的时间。补位使用 `waitlisted_at, id` 的稳定顺序并在释放名额的事务内完成。
- `member_event_changes` 只追加时间、地点、报名规则、内容和状态摘要，为用户详情页提供可追溯变更历史。
- 付费活动在本阶段固定 `AUTO + waitlist_enabled=0`，避免未付款审核、候补预约和退款之间形成不完整状态机。

## 活动角色收敛（008）

- `EVENT_OWNER`：活动编辑/发布、团队管理、含联系电话的名单与导出、报名审核、签到、相册审核。
- `EVENT_MANAGER`：活动编辑/发布、含联系电话的名单与导出、报名审核、签到和相册审核；不能授予管理员。
- `EVENT_STAFF`：含联系电话的在线名单、签到和相册现场协作；不开放活动编辑、名单导出和团队管理。
- 平台 `owner/manager/reviewer/support` 不与活动角色合并。财务退款、全局审计和跨活动配置继续由平台角色控制。

## 消息与异常运营（009）

- 站内消息是权威用户回查入口；微信订阅消息只是可选送达通道。
- 默认部署不安装通知定时器；未另行提供受控调用时，通知 worker 不会生成站内消息、发送订阅消息或处理活动提醒。
- `member_notifications` 以 `app_id + user_id + kind + source + source_version` 幂等，覆盖报名结果、活动变更、活动提醒、活动取消和退款结果。
- `member_notification_subscriptions` 保存用户针对当前小程序的真实订阅结果。普通活动模板按一次性授权处理，只有微信发送成功后才写 `consumed_at`。
- `member_notification_outbox` 使用租约、有限重试和过期时间；没有模板、没有授权或已经过期时收敛为 `IN_APP_ONLY`，不阻断站内消息。
- 手机运营台的统一异常中心聚合退款未收敛、图片处理卡住、孤立文件清理失败和通知发送失败。

## 图片失败追踪（010）

- `member_operational_failures` 只保存租户、当前用户、图片用途、业务资源 ID、有限错误码和处理状态；不保存图片字节、手机号、OpenID 响应或内容安全 provider 原始结果。
- 头像、活动照片和活动封面在解码、内容安全、上传或回读校验失败时留下可运营记录；图片仍由用户重新选择，后台不提供危险的“自动重试审核”。
- 云对象已经上传但即时删除未返回逐项成功状态时，使用候选素材 UUID 写入既有 `member_media_cleanup_outbox`，由耐久清理队列收敛，不静默遗留孤立文件。

## 索引

- 成员发现：`app_id + status + updated_at desc`
- 活动流：`app_id + status + starts_at`
- 用户订单：`app_id + user_id + created_at desc`
- 订单运营：`app_id + status + created_at desc`
- 用户报名：`app_id + user_id + registered_at desc`
- 活动报名（既有）：`app_id + event_id + status`
- 活动名单分页（002）：`app_id + event_id + status + registered_at + id`
- 票码检索（002）：`app_id + ticket_code` 唯一
- 退款运营：`app_id + status + updated_at desc`
- 候补补位：`app_id + event_id + status + waitlisted_at + id`
- 活动变更：`app_id + event_id + created_at desc`
- 消息收件箱：`app_id + user_id + status + created_at desc + id`
- 通知授权：`app_id + user_id + event_id + template_key + status + consumed_at`
- 消息 outbox：`app_id + status + send_at + lease_expires_at + expires_at + id`
- 图片失败：`app_id + status + category + updated_at + id`
- 审计流：`app_id + created_at desc`

客户端没有数据库直读写权限。`mip-api`、`mip-admin-api` 和原生 CloudPay 适配器从 `cloud.getWXContext()` 获取身份；支付函数不连接私网数据库，而是用 HMAC 调用 `mip-payment-ledger` 完成事务。
