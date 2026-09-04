# MIP 数据合同

本文描述当前 MIP 运行时的数据语义和写入边界，不复制完整表目录。字段、索引和迁移顺序以 `database/mysql/mip/` 下的 append-only 迁移及 `migrations.lock.json` 为准；新业务只读写 `mip_*` 表。真实 AppID、EnvID、OpenID、连接串、商户凭证和内部 HMAC 不进入仓库文档或公开日志。

## 身份、租户和角色

- 每张业务表都带可信 `app_id`。它来自 CloudBase 请求上下文或受信内部调用，客户端提交的 AppID 永远不能作为 ownership 依据。
- 微信身份在服务端解析为 `mip_user_identities.identity_key`，再映射到 `mip_users.id`；OpenID 不渲染、不写普通业务日志、不返回客户端。注销后原摘要移入 `closed_identity_key`，既不再向其他领域解析为可用身份，也阻止同一当前 OpenID 自动创建新账号。
- `mip_users` 是唯一用户身份。拥有当前有效 `mip_membership_entitlements` 的用户是玩家；没有有效付费权益的用户是嘉宾。这个状态由服务端查询和权益窗口决定。
- `mip_city_branches` 和 `mip_branch_memberships` 表示城市分会及归属；当前导航城市不等于授权范围。平台、分会和活动权限统一由 `mip_admin_role_bindings`、`mip_user_access_controls` 及服务端 capability 决定。
- 手机号存于 `mip_private_profiles` 的 hash/ciphertext；仅在已授权的必要名单合同中解密，普通用户 DTO 不返回他人手机号。

## 表级合同

| 表 | 事实 | 主要写入边界 |
| --- | --- | --- |
| `mip_users` / `mip_user_identities` | 用户、微信身份、状态和主分会 | `mip-identity-api` |
| `mip_media_assets` | `mip/` 对象 key、完整 `cloud://` 文件 ID、摘要、尺寸、状态 | 受控上传与对应领域函数 |
| `mip_city_branches` / `mip_branch_memberships` | 城市分会、成员归属和有效期 | `mip-admin-api`、身份领域 |
| `mip_profiles` / `mip_private_profiles` | 公开资料与加密私密资料 | `mip-identity-api`、受控管理动作 |
| `mip_agreement_acceptances` | 协议版本、来源和接受时间 | `mip-identity-api` |
| `mip_tags` / `mip_profile_tags` | 标签目录和用户标签关系 | 身份/机会领域 |
| `mip_admin_role_bindings` / `mip_user_access_controls` | 角色绑定、allow/block 控制 | `mip-admin-api` |
| `mip_app_settings` | App-scoped 运行设置 | `mip-admin-api` |
| `mip_idempotency_keys` | 业务 mutation 的请求 hash、状态和响应 | 各领域事务 |
| `mip_outbox_events` | 业务事实产生的内部事件 | 产生事实的同一事务；`mip-outbox-worker` 受控领取 |
| `mip_audit_logs` | 管理、支付和覆盖操作的追加审计 | 只允许 `SELECT`、`INSERT` |
| `mip_membership_plans` | TEST/LIVE 方案目录、价格、时长和权益快照 | `mip-commerce-api` / 管理动作 |
| `mip_orders` | 统一会员/付费活动/单内容订单、金额、商品快照、商户单号和状态 | commerce 创建；ledger 更新 |
| `mip_payment_attempts` | CloudPay 参数生成和支付尝试 | payment adapter / ledger |
| `mip_refunds` | 退款请求、退款单号、金额和状态 | commerce/admin/ledger 创建；ledger 更新；refund worker 只经 ledger 提交 provider |
| `mip_membership_entitlements` | 支付确认后的会员有效期和状态 | 仅 ledger 事务 |
| `mip_knowledge_sources` / `mip_knowledge_categories` / `mip_knowledge_contents` | 信息源、行业分类、内容交付和发布审核事实 | community 读取；admin 受 capability 管理 |
| `mip_knowledge_products` / `mip_knowledge_entitlements` | 单内容 TEST/LIVE 商品和支付确认后的阅读权益 | admin 管商品；ledger 发放或撤销权益 |
| `mip_content_comment_settings` / `mip_content_comments` / `mip_content_comment_reports` | 跨内容目标的评论开关、评论、举报与审核事实 | community 与 admin 受身份、屏蔽、内容安全和 capability 约束 |
| `mip_knowledge_ingestion_runs` / `mip_knowledge_ingestion_items` | 采集运行、去重和来源审计 | admin 手动触发，或由无数据库连接的 scheduler 按已审核计划唤醒 |
| `mip_membership_attributions` | 会员期内固定的邀请归属 | ledger/会员事务 |
| `mip_payment_callbacks` | 已验签回调的幂等记录和处理状态 | callback/ledger |
| `mip_events` / `mip_event_changes` | 平台或分会活动及追加变更历史 | events/admin 事务 |
| `mip_event_seat_holds` | 付费活动的短期名额保留 | events 创建；ledger 消耗/过期 |
| `mip_event_registrations` | 报名、报名表快照、公开选择和签到前状态 | events 事务 |
| `mip_event_invitation_attributions` | 嘉宾在活动中的邀请来源 | 报名事务 |
| `mip_event_checkin_credentials` / `mip_event_checkins` | 短期签到凭证和当前到场状态 | events/admin 事务 |
| `mip_event_checkin_transitions` | 每轮签到和撤销的不可变关系事实 | events/admin 与 outbox 同一事务只追加 |
| `mip_event_hearts` / `mip_event_feedback` | 已签到用户的心动选择和活动反馈 | events 事务 |
| `mip_event_album_photos` | 活动照片的提交者、素材引用、审核/撤回状态和版本 | events 提交/撤回；受 capability 约束的 admin 审核 |
| `mip_opportunities` / `mip_opportunity_roles` / `mip_opportunity_tags` | 机会、角色和标签关系；草稿只能由平台级 capability 软归档 | `mip-opportunities-api` / `mip-admin-api` |
| `mip_referral_intents` / `mip_profile_interests` | 发起人、被引荐人、机会之间的引荐关系和用户感兴趣关系 | `mip-opportunities-api` |
| `mip_opportunity_comment_settings` / `mip_opportunity_comments` | 机会评论开关、审核方式、评论和项目评价事实 | 用户写入由 `mip-opportunities-api`；配置与审核由 `mip-admin-api` |
| `mip_opportunity_comment_calls` / `mip_opportunity_comment_reports` | 用户对评论的幂等打 call 关系和独立举报审核事实 | 用户写入由 `mip-opportunities-api`；举报处理由 `mip-admin-api` |
| `mip_user_notification_preferences` / `mip_user_opportunity_preferences` | 评论、撮合、热点通知和撮合/推荐/被发现/范围偏好 | 用户本人通过 `mip-opportunities-api` 按版本和幂等键更新 |
| `mip_matching_settings` | 平台或城市分会的两类最低分、最大候选数和外部 provider 开关 | `mip-admin-api` 受机会审核 capability、范围授权和版本约束更新 |
| `mip_matching_requests` / `mip_matching_results` / `mip_matching_feedback` | 来源/设置/结果版本、候选分数与解释、用户反馈 | `mip-opportunities-api` 只追加；后台重算使用内部 HMAC |
| `mip_user_blocks` / `mip_reports` | 主动屏蔽关系、幂等举报和审核状态 | `mip-community-api`；审核由受 capability 约束的管理事务处理 |
| `mip_announcements` | 平台/分会公告、展示窗口、内容安全和关联内容 | `mip-admin-api` 写入；`mip-community-api` 只读公开内容 |
| `mip_cooperation_cards` | 六种合作角色的结构化合作卡 | `mip-opportunities-api` |
| `mip_super_cases` / `mip_super_case_media` | 已确认可公开的案例及素材关系 | `mip-opportunities-api` |
| `mip_growth_levels` / `mip_growth_rules` | 成长等级和事件规则 | `mip-growth-api` / 管理动作 |
| `mip_growth_accounts` / `mip_growth_entries` | 经验、贡献和游戏币余额快照及不可变成长流水 | `mip-growth-api`；流水只追加，游戏币消费后余额不得为负 |
| `mip_blind_box_catalogs` / `mip_blind_box_cards` | 可发布盲盒目录、规则、概率权重和可核销库存 | `mip-game-api` 受 `game.manage` capability 约束配置，用户端只读已发布事实 |
| `mip_blind_box_user_states` / `mip_blind_box_draws` / `mip_blind_box_inventory` | 用户抽取计数/保底、不可变抽取记录和卡牌背包 | `mip-game-api` 在锁定账户与库存的同一事务中扣减游戏币、追加流水、核销库存并授予卡牌 |
| `mip_badges` / `mip_user_badges` | 勋章目录与用户获授/撤销事实 | `mip-admin-api` 受 `badges.manage` capability 约束写入并追加审计 |
| `mip_user_badge_profiles` / `mip_user_badge_equipment` | 本人勋章收藏版本与最多 3 个佩戴槽位 | `mip-growth-api` 事务校验有效获授事实后写入 |
| `mip_task_cards` / `mip_task_assignments` / `mip_task_completions` | 任务配置、全员或指定成员派发、模板、截止窗口、每用户单次完成事实、附件引用和奖励快照 | `mip-tasks-api`；派发撤销保留状态和审计，完成事实与经验奖励在同一事务写入 |
| `mip_task_level_rules` | 任务与成长等级的精确允许集合；没有关联记录表示全部等级 | `mip-tasks-api` 管理事务精确替换；用户列表与完成动作按服务端当前经验对应的启用等级重新校验 |
| `mip_operations_messages` | 按收件人展开的不可变运营通知、范围和模板快照 | 受 capability 约束的管理事务只追加 |
| `mip_inbox_messages` | 用户可回查的站内消息 | `mip-notification-worker` 写入；`mip-notifications-api` 读取和标记已读 |
| `mip_notification_grants` / `mip_delivery_tasks` | 订阅授权消耗和外部投递任务 | `mip-notifications-api` 记录授权；`mip-notification-worker` 消耗授权并投递 |
| `mip_message_delivery_reviews` | 消息活动派发和投递任务的证据版本、认领租约及复核结论 | `mip-admin-api` 以平台复核权限和幂等合同维护；不复制或改写业务事实 |
| `mip_ai_drafts` | 音频、转写、结构化草稿及确认关系 | `mip-ai-api` |
| `mip_admin_export_tickets` | 脱敏/含手机号导出的短期票据、文件摘要和消费状态 | `mip-admin-api` |

表名、字段和索引的完整定义不在本合同中复制，以迁移文件为准。不存在 `member_*`、`dating_*` 或 `sewing_*` 的 MIP 运行时读写合同。

## 统一订单与支付

`mip_orders` 只允许三种 `order_type`：

- `MEMBERSHIP`：必须有 `membership_plan_id`，不能有 `resource_id`；支付完成后重建会员权益。
- `EVENT`：必须有活动 `resource_id`，不能有 `membership_plan_id`；付费报名先占用 `mip_event_seat_holds`，支付回调在同一事务中确认报名。
- `CONTENT`：必须有知识内容 `resource_id`，不能有 `membership_plan_id`；支付回调按订单内不可变商品快照发放单内容权益。

金额为 CNY 整数分，价格、货币、目录阶段、方案阶段、名额、商户单号和权益天数全部由服务端重建。订单状态、支付尝试、回调、退款和权益更新使用参数化 SQL、InnoDB 行锁、条件更新和幂等键。`wx.requestPayment` 成功不是 `PAID`，只有 ledger 确认的 `mip_orders.status=PAID` 才能发放会员/单内容权益或完成付费活动报名。单内容退款资格必须读取订单商品快照，并在首次访问受保护正文后拒绝 `BEFORE_ACCESS` 退款。

订单 DTO 额外返回服务端权威 `serviceStatus`，与支付 `status` 分离：

- `REFUNDED`：订单已部分退款或全部退款，或关联会员/内容权益已标记退款。`REFUND_PENDING` 仍是处理中，只出现在“全部”，不进入“已退款”。
- `PENDING_USE`：已支付活动存在同 AppID、同订单的 `REGISTERED` 报名，且活动处于已发布、未结束状态；或续费会员权益已发放但生效时间尚未到达；或已发放、在有效期内且未首次访问的单内容权益。
- `COMPLETED`：已支付活动的有效报名已核销，或同 AppID、同订单的 `REGISTERED` 报名对应活动已结束；会员权益已生效完成交付、到期或撤销；单内容权益已访问、到期或撤销。
- `UNAVAILABLE`：待支付、支付失败、关闭、退款处理中，或已支付但缺少应有服务事实的订单。已支付活动如果报名缺失、待审、待取消、已取消或已拒绝，也必须 fail-closed 为该状态。这些订单保留在“全部”，不进入其他三类。

列表和详情在同一条 SQL 中以 `app_id + order_id` 联接报名及权益，并使用数据库当前时间投影，避免跨 AppID 读取和多次查询的竞态窗口。

## 活动与公开数据

- 活动时间存 UTC `DATETIME(3)`；客户端只负责本地化显示。`ends_at > starts_at`，线上/混合活动只向有效报名者或授权运营返回 HTTPS 链接。
- `mip_events.access_type` 为 `FREE`、`MEMBER_INCLUDED` 或 `PAID`。付费活动必须 `registration_policy=AUTO` 且关闭候补；页面不能自行组合价格和会员标记判断资格。
- 报名状态由服务端维护：`PENDING_REVIEW`、`WAITLISTED`、`PAYMENT_PENDING`、`REGISTERED`、`CANCELLATION_PENDING`、`CANCELLED`、`REJECTED`、`ATTENDED`。容量、补位、取消、签到和撤销签到都在事务中完成。
- `answers_json` 是报名时或本人最后一次有效修改时的表单版本快照；`share_profile` 默认关闭。本人修改先锁定活动与报名记录，校验当前 `form_version` 和报名记录 `version`，再按当前 `registration_schema_json` 重验答案。该修改追加审计但不产生通知 outbox，因为报名状态和资格没有变化。公开参与者 DTO 只能返回已审核公开资料、头像临时 URL，以及仅描述当前调用者与该参与者关系的可选心动状态；不得返回 `user_id`、OpenID、手机号、报名答案、完整票据或其他用户之间的心动关系。
- 签到凭证只保存 hash，票据或短期 token 不能替代登录身份和跨 AppID 鉴权。每次签到与撤销都追加 transition 和同 id outbox；撤销 transition 精确指向本轮签到，不删除到场事实。
- 活动反馈只允许当前活动已签到用户提交，并使用 `expectedVersion` 防止覆盖。新反馈必须包含 1–5 分评分，以及推荐选择、1–6 个不重复合作角色、参与意向、0–2 个不重复探索方式和名单使用范围；可选正文 trim 后最多 300 字。`mip_event_feedback.answers_json` 仅为兼容旧记录允许 `NULL`，所有新写入必须保存完整结构；本人和授权运营读取时解析为结构化 `answers`，旧记录明确返回 `null`。
- 活动相册公开 DTO 只返回 `PUBLISHED` 且仍为 `READY` / `EVENT_ALBUM` 的素材和遵守公开可见性的展示摘要，不返回上传者内部用户 ID。本人列表可回查待审和拒绝状态；提交资格、`AUTO` / `REVIEW` 发布结论、素材 owner 和内容安全完成状态均由服务端回查。本人撤回和运营审核使用 `expectedVersion`，只更新状态并追加审计。
- 公告公共 DTO 只返回处于展示窗口内的 `PUBLISHED` 内容；城市筛选同时返回平台和对应分会公告。管理端使用独立 `announcements.manage` capability、内容安全、`expectedVersion` 和追加审计，关联目标只允许同 AppID 的活动或机会，不接受任意 URL。

## 成长、消息和 AI

- 成长规则、余额和流水由 `mip-growth-api` 计算；`mip_growth_entries` 只追加，客户端不能直接加分。撤销签到时按原 transition 已实际入账的 delta 追加反向流水，不按当前规则重算；精确校正允许经验余额为负数。
- 游戏币发放与消费只接受服务端固定事件或具有 `growth.adjust` capability 且覆盖用户范围的管理动作。内部接口只接收事件引用，发放/消费数值由服务端规则决定；事务锁定账户并拒绝负余额，重试返回同一流水。
- 盲盒抽取只接收目录和请求 ID；目录价格、每日上限、概率权重、保底阈值、稀有度和库存均从同 AppID 的已发布服务端事实读取。客户端按本人和目录持久化未决请求，只在成功或服务端明确未提交时清除。事务重新锁定有效会员权益，并在抽取记录中固化目录版本、保底规则、随机落点、卡牌展示字段、余额和获得后数量；请求 ID 重放必须属于同一目录并从该不可变快照返回，不重复扣币或减库存。游戏币变化写入全部 COIN 流水并产生 `game.coin_changed` outbox。
- 勋章目录与获授状态是服务端事实。本人只能在当前 AppID 内有效获授且启用的勋章中选择最多 3 枚佩戴；保存使用档案版本和事务行锁。公开档案只投影仍有效的已佩戴勋章，不返回用户内部标识或未佩戴收藏。
- `mip-outbox-worker` 只接受内部 HMAC 调用，使用 `FOR UPDATE SKIP LOCKED`、过期租约和指数退避领取事件。接收者和可计成长事实必须回查业务表，不能信任 `payload_json` 中的用户字段；消息 dedupe key 与成长 source event id 均绑定 outbox id。
- 周赛结算在游戏事实事务中追加 `game.match.finalized`；outbox 按结算周期末的队伍成员事实产生固定游戏币事件，再由游戏币流水产生 `GAME` 站内消息。经验值只有跨越当前启用等级门槛时才产生 `GROWTH_LEVEL_UP` 弹窗类型。
- 运营发布先在同一事务按收件人追加 `mip_operations_messages` 与 `operations.notification_published` outbox；投影时重新按 `app_id` 回查有效收件人、正文、活动目标和模板字段。Outbox payload 不承载收件人或文案事实。
- `mip_inbox_messages` 是定向通知的权威回查入口。小程序只通过 `mip-notifications-api` 读取本人消息、标记已读和记录真实订阅授权选择；`mip-notification-worker` 不开放客户端调用，只通过内部 HMAC 写入消息、保留/消费授权和领取投递任务。同一授权由 reservation 独占；实际微信调用和最终状态写入由锁定 `ACTIVE` 用户、任务、授权及 reservation token 的专用投递事务串行化，调用后失败只由原任务重试。没有模板、授权或外部送达时，不阻断站内消息。完整边界见 [NOTIFICATIONS.md](NOTIFICATIONS.md)。
- `mip_message_delivery_reviews` 只表达运营复核流程。列表默认返回未闭环项，以及新证据再次属于处理超时、结果未知或终止失败的 `ACTIVE` 项；显式 `RESOLVED` / `ALL` 由工作流行驱动并实时读取当前来源事实。已闭环记录不会因为活动完成或任务送达而消失，成功或安全自动重试也不会重新打开人工流程。认领、核对和结束均校验证据哈希、版本、15 分钟租约和幂等键。同一来源行只反映最新复核状态，操作过程由审计流水留痕，列表不保留旧说明或证据引用。`UNKNOWN` 绝不自动重放，`resolve` 也不能把来源改成成功。
- 机会撮合默认使用确定性本地 provider，并保存来源机会、阈值和结果版本。客户端和外部 provider 只接收请求范围内的签名候选引用；provider 的其余输入仅含候选类型、本地分数和匿名信号键/权重，不含人才用户 ID、分会/城市/标签内部主键。非法响应、超时或异常降级到本地结果。候选生成和结果读取均按 AppID 回查有效用户、公开字段、分会范围、机会状态、用户可发现偏好和双向屏蔽，最终写入再次锁定偏好与阈值版本。
- `mip_ai_drafts` 在用户明确确认前只能是临时草稿；转写 provider 通过内部鉴权调用，不直接写正式档案、合作卡或超级案例。

## 隐私、缓存和内部权限

- 普通 DTO 永不返回数据库连接串、内部 HMAC、商户密钥、他人 OpenID、完整票据或 provider 原始错误。
- 引荐的 `actor_user_id` 和 `target_user_id` 只用于服务端关系事实。选择目标、引荐列表和详情均使用 AppID 绑定的 opaque `profileRef`，普通 DTO 不返回内部用户 ID。
- 档案影响力只聚合当前可证明的邀请嘉宾、活动心动、档案兴趣和访客事实。本人可读取对应身份列表；他人公开档案只在 `visibility.influence` 允许时返回聚合数，且不返回列表身份。四项精确定义见 [PROFILE_INFLUENCE.md](PROFILE_INFLUENCE.md)。
- 机会评论作者和评论举报人仅以 AppID 绑定的 opaque `profileRef` 返回。参与人标识由机会发布人或团队历史关系生成；打 call 总数由关系事实的状态迁移维护，不接受客户端计数。
- 社区安全客户端只提交 AppID 绑定的 `profileRef`；不接收或返回目标用户 ID、OpenID。任一方向存在 `ACTIVE` 屏蔽时，已识别用户不能读取对方公开档案或在受支持的公共列表中看到对方；举报不通知目标，也不自动处罚。
- 账号注销以确认短语、`mip_users.version` 和幂等请求为边界；未结支付/退款/活动退款会阻塞。成功后关闭账号、撤销活动外公开/互动状态并最小化直接资料，但保留订单、支付、退款、权益、活动、成长流水与审计事实。完整表清单见 [ACCOUNT_CLOSURE.md](ACCOUNT_CLOSURE.md)。
- 页面、组件和业务模块不直连 MySQL/CloudBase 数据库；通过 `src/modules/mip-*` 和 platform adapter 调用函数。
- 临时文件 URL 只存在于进程内缓存，不写回数据库；缓存不能授予资格、权益或 RBAC。
- runtime MySQL 账号按 EnvID 指纹使用环境专属名称，并使用精确 `mip_*` table→privilege 映射：无 schema/global 权限，不接管已有同名账号，不撤销其他 schema 权限；审计和流水等追加事实不提供 UPDATE/DELETE。
- 演示种子只允许 development/test；所有演示实体使用固定 ID，并登记在当前及版本化 `demo_seed_manifest`，清单必须标记 `is_demo=1` 并记录各表完整主键；生产不得运行 seed。

## 迁移和部署

迁移只允许追加 `mip_*` 对象并写 `mip_schema_migrations`。共享环境改动顺序为仓库外逻辑备份、dry-run、迁移、最小权限复核、函数部署和只读健康检查。`mip-notification-worker` 与 `mip-outbox-worker` 不安装高频定时器。未来迁移到独立 AppID/环境时，只复制经过校验的 MIP 表、`mip/` 对象和配置。
### 个人资料与名片联系方式

身份服务的 `getProfile` 只向当前用户返回本人联系方式 DTO；手机号同时提供本人名片预览所需原值、脱敏值和绑定状态。`getPublicProfile` 永远不返回手机号、微信号、邮箱或地址。`updateCard` 在一个事务内保存姓名、公司、组织、联系方式和名片公开范围，服务端负责版本校验与加密保存。
