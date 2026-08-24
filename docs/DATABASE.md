# Database

MIP 权威结构在 `database/mysql/mip/` 和该目录的 `migrations.lock.json`。当前 lock 固定 38 个追加迁移；新表前缀固定为 `mip_*`，完整迁移记录写入 `mip_schema_migrations`，每条语句的执行状态写入 `mip_schema_migration_steps`，引擎使用 InnoDB。`mip_orders` 统一承载会员、付费活动和付费内容订单。当前 38 个迁移已全部应用；105 张 runtime 表权限已收敛并通过幂等回读。变更前稳定备份已完成并保存在 `~/Backups/mip-weapp/2026-08-24T112700-446Z/`，本轮不再重复创建备份。

活动相册由 `012_event_album.sql` 追加 `mip_event_album_photos` 与活动相册配置；照片只做状态迁移和版本更新，不执行物理业务删除。`015_checkin_growth_compensation.sql` 追加签到 transition，并将经验余额改为可表达精确冲销的有符号值。`016_notification_delivery_reservations.sql` 为订阅授权追加任务级 reservation，使微信调用可以移出数据库事务且不被其他任务并发复用。`021_referral_targets.sql` 将历史引荐安全回填给对应机会发布人，再把被引荐人收敛为非空外键；发起人和机会的原唯一约束保持不变。后续迁移继续按 lock 中的版本和 checksum 顺序应用。

`024_task_cards.sql` 追加任务卡与完成流水。每个 AppID 内同一用户和任务最多有一条完成事实；奖励经验值、任务内容和附件引用按完成时事实留存，任务删除只做软删除。

`025_banners.sql` 追加 AppID 范围内的 Banner 目录、展示窗口、排序、跳转目标和版本。管理操作只做启停和软删除，公开读取只返回当前展示窗口内的有效记录。

`026_admin_prd_extensions.sql` 为机会、成长等级、活动和导出票据补齐后台 PRD 字段，并追加独立成长权益及等级关联表。旧 `benefits_json` 保留兼容读取；新关系以服务端实体和关联事实为准。

`027_task_assignments_templates.sql` 为任务追加全员/指定成员范围、截止时间与单个模板素材，并以 `mip_task_assignments` 保存可恢复的派发或软撤销事实。指定成员任务只向本人有效派发返回，截止后保留独立结束状态但不再接受完成提交。

`028_badge_collection.sql` 追加勋章目录、用户获授事实、勋章收藏版本和最多 3 个佩戴槽位。获授撤销只改状态并追加管理审计；仍在佩戴的获授记录不能撤销，客户端保存佩戴状态必须通过服务端版本和有效获授校验。

`029_gamification_foundation.sql` 追加赛季、团队、团队成员历史、每周赛况、排行榜快照和排行条目。每周结算与团队/个人排行只从当前 AppID 的服务端成长事实生成，客户端不能提交分数；历史赛况与排行以快照保留，不随后续经验变化重算。

`032_game_coin_safety.sql` 为已有游戏币账户追加非负约束和查询索引，并约束游戏币流水的 `balance_after` 不得为负。游戏币继续使用 `mip_growth_accounts.coin_balance` 与 append-only `mip_growth_entries`，不建立客户端钱包事实或第二套余额。

`035_mip_blind_box.sql` 追加盲盒目录、卡牌库存、用户保底状态、不可变抽取记录和卡牌背包。抽取事务复用游戏币账户与 COIN 流水，重新锁定有效会员权益、账户和库存，防止负余额，并以 `(app_id, user_id, request_id)` 保证同目录重试不重复扣币或授予卡牌。抽取记录固化目录版本、保底阈值、最低稀有度、随机落点、卡牌展示字段、余额和获得后数量；目录、规则、概率、保底和库存由 `game.manage` 管理动作配置并追加审计。已发布目录的规则和卡牌变更必须继续保有满足保底最低稀有度的已发布库存；rollback 检测到抽取记录时会在删除任何表前失败，避免拆断游戏币流水审计。

`037_mip_ai_matching_preferences.sql` 追加用户通知/机会权限、范围化撮合设置、撮合请求、版本化结果和不可变反馈。撮合记录只追加，阈值和用户偏好使用版本更新；该迁移已应用并纳入当前 38 个迁移与 105 张表权限基线。

`038_task_level_rules.sql` 以 `mip_task_level_rules` 保存任务与启用成长等级的精确允许集合；任务没有关联记录时表示全部等级可完成。关系替换由任务管理事务和任务版本保护，运行账号仅获得 `SELECT/INSERT/DELETE`；rollback 会先检测业务行，非空时在删除表前失败。

根目录下 `database/mysql/001_member_schema.sql` 至 `014_event_owner_backfill_v2.sql` 是历史会员模板迁移，仅供迁移参考。默认命令不会应用、修复或回滚这些 `member_*` 对象；历史 `scripts/apply-mysql-schema.mjs` 默认禁用，只能在同时确认 legacy member schema 与隔离测试数据库的非 MIP 流程中运行，不属于任何 MIP 操作命令。活跃 MIP 合同见 [data-model.md](data-model.md)、[data-contract.md](data-contract.md)、[mip/ARCHITECTURE.md](mip/ARCHITECTURE.md) 和 `database/mysql/mip/`。

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

生产禁止 seed。演示数据 `is_demo=1`。MIP 函数部署前必须由 `pnpm database:grants` 验证环境专属 runtime 账号的精确表级权限，不允许 schema-level ALL 或全局权限。
