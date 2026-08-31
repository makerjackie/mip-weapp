# Database

MIP 权威结构在 `database/mysql/mip/` 和该目录的 `migrations.lock.json`。新表前缀固定为 `mip_*`，完整迁移记录写入 `mip_schema_migrations`，每条语句的执行状态写入 `mip_schema_migration_steps`，引擎使用 InnoDB。`mip_orders` 统一承载会员、付费活动和付费内容订单。lock 只证明仓库期望结构；目标环境是否已应用、表级权限是否收敛，必须以环境回读为准，并记录在 [MIP 项目状态](mip/PROJECT_STATUS.md) 或对应证据中。

活动相册由 `012_event_album.sql` 追加 `mip_event_album_photos` 与活动相册配置；照片只做状态迁移和版本更新，不执行物理业务删除。`015_checkin_growth_compensation.sql` 追加签到 transition，并将经验余额改为可表达精确冲销的有符号值。`016_notification_delivery_reservations.sql` 为订阅授权追加任务级 reservation，使微信调用可以移出数据库事务且不被其他任务并发复用。`021_referral_targets.sql` 将历史引荐安全回填给对应机会发布人，再把被引荐人收敛为非空外键；发起人和机会的原唯一约束保持不变。后续迁移继续按 lock 中的版本和 checksum 顺序应用。

`024_task_cards.sql` 追加任务卡与完成流水。每个 AppID 内同一用户和任务最多有一条完成事实；奖励经验值、任务内容和附件引用按完成时事实留存，任务删除只做软删除。

`025_banners.sql` 追加 AppID 范围内的 Banner 目录、展示窗口、排序、跳转目标和版本。管理操作只做启停和软删除，公开读取只返回当前展示窗口内的有效记录。

`026_admin_prd_extensions.sql` 为机会、成长等级、活动和导出票据补齐后台 PRD 字段，并追加独立成长权益及等级关联表。旧 `benefits_json` 保留兼容读取；新关系以服务端实体和关联事实为准。

`027_task_assignments_templates.sql` 为任务追加全员/指定成员范围、截止时间与单个模板素材，并以 `mip_task_assignments` 保存可恢复的派发或软撤销事实。指定成员任务只向本人有效派发返回，截止后保留独立结束状态但不再接受完成提交。

`028_badge_collection.sql` 追加勋章目录、用户获授事实、勋章收藏版本和最多 3 个佩戴槽位。获授撤销只改状态并追加管理审计；仍在佩戴的获授记录不能撤销，客户端保存佩戴状态必须通过服务端版本和有效获授校验。

`029_gamification_foundation.sql` 追加赛季、团队、团队成员历史、每周赛况、排行榜快照和排行条目。每周结算与团队/个人排行只从当前 AppID 的服务端成长事实生成，客户端不能提交分数；历史赛况与排行以快照保留，不随后续经验变化重算。

`032_game_coin_safety.sql` 为已有游戏币账户追加非负约束和查询索引，并约束游戏币流水的 `balance_after` 不得为负。游戏币继续使用 `mip_growth_accounts.coin_balance` 与 append-only `mip_growth_entries`，不建立客户端钱包事实或第二套余额。

`035_mip_blind_box.sql` 追加盲盒目录、卡牌库存、用户保底状态、不可变抽取记录和卡牌背包。抽取事务复用游戏币账户与 COIN 流水，重新锁定有效会员权益、账户和库存，防止负余额，并以 `(app_id, user_id, request_id)` 保证同目录重试不重复扣币或授予卡牌。抽取记录固化目录版本、保底阈值、最低稀有度、随机落点、卡牌展示字段、余额和获得后数量；目录、规则、概率、保底和库存由 `game.manage` 管理动作配置并追加审计。已发布目录的规则和卡牌变更必须继续保有满足保底最低稀有度的已发布库存；rollback 检测到抽取记录时会在删除任何表前失败，避免拆断游戏币流水审计。

`037_mip_ai_matching_preferences.sql` 追加用户通知/机会权限、范围化撮合设置、撮合请求、版本化结果和不可变反馈。撮合记录只追加，阈值和用户偏好使用版本更新。

`041_message_delivery_reviews.sql` 追加消息活动派发和外部投递任务的独立复核工作流。表只保存 AppID 范围内的来源引用、证据哈希、认领租约、处理结论、操作者和版本，不复制消息正文、收件人或 provider 响应，也不通过复核行改变业务来源事实。runtime 权限固定为 `SELECT`、`INSERT`、`UPDATE`；rollback 在表非空时拒绝删除，必须先导出当前复核状态。迁移是否已应用必须以目标环境的 schema migration 记录、表结构和权限读回为准，仓库 lock 本身不是部署证明。

`042_profile_identity_status_unicode.sql` 将会员资料的身份状态列改为 `utf8mb4`，允许页面保存中文身份描述。rollback 检测到非 ASCII 值时拒绝有损回退。

`038_task_level_rules.sql` 以 `mip_task_level_rules` 保存任务与启用成长等级的精确允许集合；任务没有关联记录时表示全部等级可完成。关系替换由任务管理事务和任务版本保护，运行账号仅获得 `SELECT/INSERT/DELETE`；rollback 会先检测业务行，非空时在删除表前失败。

仓库只保留 `database/mysql/mip/` 的当前迁移。共享数据库中既有的 `member_*`、`dating_*`、`sewing_*` 表不属于本仓库，不应用、不修复、不回滚，也不在迁移脚本中保留其结构副本。数据语义见 [data-contract.md](data-contract.md)，领域边界见 [mip/ARCHITECTURE.md](mip/ARCHITECTURE.md)。

只预览迁移范围，不连接数据库：

```bash
pnpm database:setup -- --confirm-env=<EnvID> --confirm-prefix=mip_ --dry-run
```

共享环境改表前先做仓库外的只读逻辑备份：

```bash
pnpm database:backup -- --confirm-env=<EnvID>
```

默认输出到本机 `~/Backups/mip-weapp/`，包含结构元数据、逐表 JSONL、行数清单和 SHA-256。备份含用户与订单数据，不得提交或共享。该命令使用分页只读查询并复核前后行数，不是事务快照；生产变更仍应同时保留 CloudBase 控制台的自动或手动备份。

存在待应用迁移时，执行器只接受 24 小时内、环境指纹一致且前后行数稳定的备份：

```bash
pnpm database:setup -- \
  --confirm-env=<EnvID> \
  --confirm-prefix=mip_ \
  --backup-manifest=/absolute/path/to/manifest.json
```

迁移执行器会在写入前拒绝任何非 `mip_*` 表引用以及前向删除语句。MySQL DDL 可能隐式提交，因此执行器按 SQL 语句记录 `RUNNING → APPLIED`；发现 `RUNNING`、校验和不一致，或“表已存在但没有迁移记录”的半截迁移时立即停止。此时先保留现场并使用变更前备份恢复，或由数据库负责人核对实际结构后通过新的追加迁移修复，不得盲目重跑、改 journal 或覆盖原 migration。

迁移完成并运行 `pnpm project:init` 生成环境专属 runtime 用户后，收敛精确表级权限：

```bash
pnpm database:grants -- \
  --confirm-env=<EnvID> \
  --confirm-runtime-user=<exact-runtime-user>
```

该命令只接受 `.env.local` 中与当前 EnvID 派生结果一致的 runtime 用户，拒绝 schema/global 权限，并按当前 MIP 表清单回读验证授权。共享数据库的其他 schema、旧项目表和其他账号不在其授权范围内。

生产禁止 seed。演示实体使用仓库固定 ID，并统一登记在 `mip_app_settings.demo_seed_manifest` 及版本化清单；清单必须包含 `is_demo=1`、seed 版本、SHA-256、`PENDING | READY` 状态和各表完整主键，正式上线前按清单替换或清理。MIP 函数部署前必须由 `pnpm database:grants` 验证环境专属 runtime 账号的精确表级权限，不允许 schema-level ALL 或全局权限。
### 053：个人资料与名片联系方式

`053_profile_identity_card_contacts.sql` 为 `mip_profiles` 增加可选的姓名、性别和职业身份字段，为 `mip_private_profiles` 增加微信号、邮箱和地址的密文列。联系方式不进入公开资料查询，名片公开范围只记录在 `visibility_json.cardContacts`；身份云函数从现有 `MIP_PHONE_ENCRYPTION_KEY` 按不同用途派生名片联系方式加密子密钥，不引入客户端或独立的可漂移密钥。

### 054：徽章分类

`054_badge_categories.sql` 为徽章目录增加 `IDENTITY | HONOR` 分类及查询索引。获授和佩戴仍由 `mip_user_badges`、`mip_user_badge_profiles` 与 `mip_user_badge_equipment` 决定；分类只控制目录呈现，不授予徽章。

### 055–056：职业身份与 Web 防重放

`055_profile_career_identity_keys.sql` 把个人资料职业身份收敛到当前八项稳定 key；客户端展示中文标签，数据库只保存稳定值。`056_web_bff_replay_guard.sql` 增加 `mip_web_bff_requests`，由可信 Web BFF adapter 一次性消费签名 nonce；它只防 transport envelope 重放，不代替具体业务 mutation 的版本校验与持久幂等。

### 057–058：AI 请求幂等与会员邀请码分配

`057_ai_draft_requests.sql` 保存 AI 创建请求的稳定 request ID、请求摘要、处理租约、响应和到期状态。Provider 或上传结果未知时请求保持 `PROCESSING`，重试复用同一逻辑请求；只有当前租约可以提交终态。到期维护保留审计行并清空响应内容，不能把超时推断为 Provider 失败。

`058_membership_invitation_codes.sql` 保存会员邀请小程序码的稳定分配、对象键、素材引用和生成租约。一次认领只允许一个 allocation；上传重试复用同一 object key，旧租约不能覆盖当前结果。账号注销或权益失效后邀请码进入 `EXPIRED`，对象删除仍由受控媒体清理完成。
