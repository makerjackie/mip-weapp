# 数据合同

会员案例使用现有 CloudBase MySQL 8 环境，并以可信云函数边界隔离客户端。真实 EnvID、连接串、AppID、OpenID 和支付凭证不进入仓库文档或公开日志。

## 租户与身份

- 每张业务表都包含服务端可信来源 `app_id`；客户端传入的 AppID 永不作为 ownership 依据。
- 微信用户键来自 `FROM_OPENID || OPENID`，只进入 server-only `user_id`，不渲染、不写业务日志、不返回客户端。
- 同一环境服务多个小程序时，所有查询、唯一约束、幂等键、订单、管理员、对象 key 和审计都包含 `app_id`。
- MySQL 连接串只存在于本机 `.env.local` 与绑定 VPC 的 Event Function 环境变量。

## 数据分类

| 表 | 用途 | 访问边界 |
| --- | --- | --- |
| `member_profiles` | 公开资料与审核状态 | 云函数按 app、状态和当前用户裁剪字段 |
| `member_private_profiles` | 手机号等私密资料 | 仅可信服务访问；只向平台活动运营及当前活动负责人、管理员、现场工作人员的名单返回手机号原文 |
| `member_plans` | 服务端方案与价格 | 只返回当前 app、当前支付模式的启用方案 |
| `member_entitlements` | 会员权益 | 只返回当前用户权益；ledger 事务写 |
| `member_events` | 活动内容、库存、取消元数据与乐观版本 | 公共 feed 只返回已发布；持有报名时可读最小历史 |
| `member_registrations` | 报名、签到、取消原因、票码与本场公开资料选择 | 当前用户读取；运营名单受 RBAC；公开参与者查询另走最小字段合同；InnoDB 事务写 |
| `member_orders` | 支付订单事实 | 当前用户读取；下单/ledger 事务写 |
| `member_refunds` | 退款事实 | 可信运营和支付 ledger 访问 |
| `member_media_cleanup_outbox` | 媒体对象清理 outbox | 账号注销事务写入 PENDING；deleteFile 逐项 status 成功后 DONE；owner/admin 或签名运维可重试 |
| `member_admin_roles` | 手机运营台角色 | 服务端 RBAC；客户端只得到 capability |
| `member_audit_logs` | 管理审计 | 运营函数只读；服务端只追加 |
| `member_media_assets` | COS 文件 ID、尺寸和用途 | 只返回已绑定业务素材的 file ID |
| `member_notifications` | 报名、活动和退款的站内消息 | 当前用户只读自己的消息；按来源版本幂等 |
| `member_notification_subscriptions` | 用户真实订阅结果和一次性消耗状态 | 当前用户手势后写；不向其他用户或普通运营角色公开 |
| `member_notification_outbox` | 微信消息发送租约、次数和结果 | 通知 worker 被受控调用时写；仅 owner/manager 的异常中心读取最小状态 |
| `member_operational_failures` | 图片安全审核/上传失败的有限运营事实 | 只存安全错误码和业务资源；不存图片字节、provider 原文或用户身份响应 |

默认部署不安装通知定时器；未另行提供受控调用时，不会生成站内消息、发送订阅消息或处理活动提醒。

## 活动与报名合同

- 时间一律存 UTC `DATETIME(3)`。客户端提交 ISO 字符串，服务端 `normalizeEvent` 解析为 `Date` 后再写入；显示层负责时区本地化。
- 时间边界：`endsAt > startsAt`；`registrationDeadline <= startsAt`（允许为空）；发布时 `startsAt` 仍须在未来。
- 活动类型由 domain 输出 `PUBLIC_FREE | MEMBER_INCLUDED | PAID`。页面和组件不得自行组合 `memberFree` / `priceCents` 猜测资格。`priceCents > 0 && memberFree === true` 必须在写库前拒绝。
- `location` 是兼容展示字段；结构化场地使用 `venueName` + `address`。`coverAssetId` 复用 `member_media_assets`，不得写入临时签名 URL。
- 活动/报名 `version` 用于乐观锁。运营编辑、签到、撤销签到在更新时携带 expected version；版本冲突返回可恢复错误，要求刷新后重试。
- 主办方取消活动时：事务内收敛仍为 `PENDING_REVIEW | WAITLISTED | REGISTERED` 的报名，写 `cancelled_by_type='EVENT'` 与原因；**保留 `ATTENDED` 历史，不得抹除出席事实**。
- 票码 `ticket_code` 仅作现场核验辅助：
  - 唯一范围是 `app_id + ticket_code`；
  - API/UI 默认返回掩码；
  - 完整票码不得进入普通日志、导出文件名、截图或审计 metadata；
  - 票码不能替代登录身份或跨租户鉴权。
- 名单分页索引按 `app_id + event_id + status + registered_at + id`；搜索不得建立 nickname 跨表冗余列。
- 报名状态机：`PENDING_REVIEW → REGISTERED|WAITLISTED|REJECTED|CANCELLED`；`WAITLISTED → REGISTERED|REJECTED|CANCELLED`；`REGISTERED → ATTENDED|CANCELLED`；`ATTENDED → REGISTERED` 仅撤销误签到；`CANCELLED|REJECTED` 重新提交由报名事务控制。
- 容量只统计 `REGISTERED | CANCELLATION_PENDING | ATTENDED`。候补按 `waitlisted_at, id` 排队；释放免费活动名额与补位必须在同一事务。
- 付费活动只允许 `AUTO` 且关闭候补；活动审核/候补不能绕过支付预约 ledger。
- `event_mode=ONLINE|HYBRID` 时必须保存 HTTPS 线上链接；公开 DTO 不返回链接，只有有效报名者和活动管理员可读。
- 已发布活动的时间、地点、报名规则、内容与状态变化追加到 `member_event_changes`，禁止用覆盖式更新冒充可追溯历史。
- 公开参与者 `listEventParticipants`：
  - 报名总数统计全部有效报名；公开列表只读取当前可信 `app_id + event_id` 下 `share_profile=1`、有效报名状态且 `member_profiles.status='APPROVED'` 的成员；头像素材只有 `READY` 时才返回，否则客户端使用统一占位头像；
  - `share_profile` 是每条报名独立、默认关闭的明确选择，创建或修改报名可更新；活动方不能替用户批量开启；
  - 稳定 cursor 按 `registered_at DESC, registration_id DESC`，limit 上限 30，禁止 OFFSET 深分页；
  - DTO 只允许头像临时 URL、公开昵称、城市、职业、组织、行业、标题、个人简介、兴趣/技能与活动公开角色；不得返回 `user_id`、OpenID、手机号、报名答案、完整票码或私密资料；
  - 参与者详情复用现有成员公开资料与会员可见性合同，不复制第二份成员数据。
- 运营名单 `listEventRegistrations`：
  - 仅可信 `app_id + eventId` + `events` capability；
  - 稳定 cursor（有效状态优先级 + `registered_at DESC, id DESC`），limit 上限 50，禁止 OFFSET 深分页；
  - 搜索语义（`classifyRosterQuery`）：
    - 11 位手机号 → 精确匹配 `phone_number`（≥2 字符总门槛）；
    - `T`+十六进制票码 → 票码精确或前缀；
    - 其他 → 昵称/城市 `LIKE %query%`（转义特殊字符）；
  - DTO 最小必要：昵称、城市、状态、时间、票码掩码、`phoneBound`、version；服务端确认平台活动运营、`EVENT_OWNER`、`EVENT_MANAGER` 或 `EVENT_STAFF` 后才附带 `phoneNumber`，并向这些角色显示报名表中的手机号答案。普通用户永不获得其他报名者手机号；任何角色都不返回 openid / user_id / 完整票码。
- 签到 `checkInRegistration` / 撤销 `undoCheckIn`：
  - 事务锁定活动与报名；`REGISTERED → ATTENDED`；重复 `ATTENDED` 幂等且不重复审计；
  - 撤销仅 owner/manager，原因 1–120 字，`ATTENDED → REGISTERED` 并清理出席字段；
  - 默认窗口为开始前 6 小时至结束后 24 小时；窗口外仅 owner 可覆盖并写 `ATTENDANCE_OVERRIDE`；
  - 版本冲突返回可恢复错误；审计失败整事务回滚。
- 安全导出（XLSX，一次性票据）：
  - 服务端生成 Office Open XML `.xlsx`（非 CSV）；列固定为昵称、联系电话、城市、状态、报名时间、签到时间、票码掩码；
  - 只有平台活动运营、`EVENT_OWNER` 和 `EVENT_MANAGER` 可导出；`EVENT_STAFF` 可在线查看联系电话但不能批量导出；
  - 导出前提示仅限当前活动联系与现场服务；导出/下载审计只记录行数、筛选条件和“包含手机号”事实，不记录手机号值；
  - 公式注入转义（`= + - @` 前缀加 `'`）；剥离 XML 1.0 禁止控制字符；shared strings 的 `count` 为总引用数、`uniqueCount` 为唯一串数；
  - 上传后 DB 持久化 SDK 返回的完整 `cloud://` `file_id`，并单独保留 app-scoped `object_key` 与 `content_sha256`/`content_bytes`；下载/删除只用完整 fileID，拒绝 bare cloudPath；
  - 兑换语义：`ACTIVE → RESERVED`（短租约）→ 校验对象存在/size/hash → 同一事务写下载审计 + `CONSUMED`；读失败释放租约不烧票；并发输家不写下载审计；
  - 合同为 **at-most-one successful consume + lease recovery**（返回文件后进程崩溃无法 exactly-once）；客户端不得传存储路径；
  - 生产 `MEMBERSHIP_EXPORT_STORAGE=cloudbase`；测试可注入 memory；`memory` 生产 env  fail-closed。
- Migration `003_export_integrity`：
  - 复合 FK `(app_id, avatar_asset_id)` / `(app_id, cover_asset_id)` 使用 `ON DELETE RESTRICT`（`app_id` 为 NOT NULL，不能 `SET NULL`）；应用在删除媒体前须先解绑；
  - 新增 `member_export_tickets` / `member_mutation_idempotency`；runtime 账号必须具备两表最小 SELECT/INSERT/UPDATE/DELETE。

## 数据来源与权限

- 页面禁止导入活动、成员、订单等业务常量数组。
- development/test 可运行幂等合成种子，记录标记 `is_demo=1`；生产不得运行。
- 图片先压缩、上传对象存储，再写永久 `cloud_file_id`、摘要和业务外键；数据库不保存临时签名 URL。
- 图片失败只记录受控错误码。上传后即时删除没有得到逐项成功状态时必须进入 `member_media_cleanup_outbox`；失败图片不能写成 READY，也不能由运营后台自动绕过安全审核。
- CloudBase adapter 在数据返回页面前统一通过 `getTempFileURL` 把 `cloud://` 文件 ID 解析为有时效的 HTTPS URL；页面、组件和业务模块不直接持有或解析 Cloud 文件 ID。临时 URL 只做进程内缓存，不写回 MySQL。
- 头像上传经 pngjs/jpeg-js 完整解码并 re-encode 后才可写 READY；拒绝无 IDAT PNG、无 SOS/EOI/截断 JPEG、坏 CRC 与尺寸炸弹。默认接线 `cloud.openapi.security.imgSecCheck`，`contentType` 与真实缓冲 MIME 一致（`image/png` / `image/jpeg`）。部署强制 `MEMBERSHIP_DEPLOYMENT_STAGE=production`；任意部署阶段与任意支付模式（含 `disabled`）在 OpenAPI 缺失时 fail closed，不以支付开关 fail-open。仅纯单测路径（`NODE_ENV=test` 且无 stage/payment mode）可 skip。对象 key 包含可信 app/user 哈希且不暴露 OpenID。
- 账号注销在同一事务内写 `member_media_cleanup_outbox` PENDING 行；当前请求可立即尝试 deleteFile，但必须检查每项 status 才收敛 DONE。owner/admin 或签名运维可 `retryMediaCleanup`。
- 会员退款门控与 `listOrders.canRefund` / `refundBlockReason` 一致：仅当退款会使剩余权益失效，且 ATTENDED 的会员包含活动落在**该订单权益覆盖期**内时阻断；历史任意 ATTENDED 不得永久阻断所有订单。覆盖期优先 `entitlement_start/end`，否则 `paid_at + duration_days`；字段不足时对“唯一剩余会员订单”保守阻断。
- 所有时间存 UTC，客户端只负责本地化显示。
- 页面不直连 MySQL；所有普通读写经过 `mip-api`，运营写经过 `mip-admin-api`。
- 下单、报名、取消、注销、支付和退款使用参数化 SQL 与 InnoDB 事务。
- 支付函数不持有数据库连接串；它通过 HMAC 认证的内部调用访问 `mip-payment-ledger`。
- 普通用户端永不获得数据库连接串、HMAC secret、商户密钥、其他报名者手机号原文、完整票码或他人 OpenID/UID；授权运营端只按当前活动名单合同获得联系电话。
- Runtime MySQL 授权为精确 table→privilege 映射：无 schema ALL、无全局 DELETE；`member_audit_logs` 仅 SELECT+INSERT。
- 公开 `health` 只读（SELECT 探活 + 空结果集读权限）；深度写探针仅 owner 或签名运维路径。
- 订阅消息模板 ID 与关键词映射来自服务端部署配置。客户端只上传逻辑模板键及微信返回的接受/拒绝结果；服务端按可信 AppID/OpenID 保存，发送成功后原子消耗授权。
- 通知正文、普通用户页面和异常中心均不得返回他人 OpenID、手机号、证件号、完整票码或 provider 内部错误详情；只有当前活动的授权运营名单可按上述合同返回联系电话。

## 客户端查询缓存

- 缓存属于模块层，不属于页面或 CloudBase adapter；页面只能使用 `peek`、普通查询、强制查询和业务 mutation。
- 相同 key 的并发查询合并；TTL 到期或下拉刷新才重新请求，mutation 按实体前缀失效。
- 缓存只保存本次小程序进程已经有权读取的响应，不持久化手机号原文、OpenID、完整票码、支付参数或管理员秘密。
- 服务端数据库、订单和权限仍是最终事实；缓存只改善返回/切 Tab 体验，不能授予权益或绕过 RBAC。

## Migration 合同

- `001_member_schema.sql` 与其 rollback/checksum 冻结；修复只追加迁移。
- `002_activity_operations.sql` 追加活动履约列与索引；rollback 仅撤销 002 对象，不删除 001 业务表/列。生产 apply 对 002 做精确结构比对（列 type/length/nullability/default、索引 unique/顺序、CHECK 规范化表达式），禁止 token includes 式通过。
- `003_export_integrity.sql` 追加 app-scoped 复合 FK、导出票据与 mutation 幂等表；rollback 仅撤销 003 对象。inspect 使用 information_schema + SHOW CREATE TABLE 精确校验 PRIMARY KEY、unsigned、engine/charset/collation、timestamp EXTRA、索引顺序/DESC、FK delete rule、CHECK 与旧 FK 缺失；不兼容 fail closed，不得 incomplete 后 noop complete。
- `004_media_cleanup_outbox.sql` 追加可执行媒体清理 outbox；rollback 仅 DROP 该表。
- `005_activity_platform.sql` 追加成员名片、活动报名表、活动管理员、相册、动态签到、关注和付费预约对象。
- `006_registration_ticket_backfill.sql` 只为历史有效报名补票码。
- `007_event_growth_core.sql` 追加报名审核、候补、线上/混合活动、地图坐标和活动变更记录；rollback 只撤销 007 对象。
- `008_event_role_simplification.sql` 把活动级权限收敛为负责人、管理员、现场工作人员三类；兼容读取旧角色，rollback 只能映射到最接近的旧角色，不能恢复历史细分语义。
- `009_notifications_and_operations.sql` 追加站内消息、一次性订阅授权和耐久通知 outbox；统一异常中心直接读取既有退款、媒体和 outbox 事实。
- `010_media_failure_tracking.sql` 追加图片审核/上传失败的最小运营记录；失败对象仍复用 004 的清理 outbox，不复制文件队列。
- `011_event_participant_visibility.sql` 为报名与付费预约追加默认关闭的 `share_profile`，使支付前后的公开选择保持一致；rollback 只移除本迁移新增列和索引。
- `migrations.lock.json` 固定名称、14 位版本号和 SQL/rollback SHA-256；锁漂移必须失败。
- 本地 `verify:mysql` 在 reset 后按迁移锁顺序推进，并在每个恢复点断言“尚未应用的后续对象不存在”；最终验证 rollback、全部 lock 行 checksum、跨 app FK 与 007 状态/索引。
- 本地契约验证仅允许 `127.0.0.1/localhost` 上的 `membership_test` 数据库，并要求显式 `--confirm-test-database`。
