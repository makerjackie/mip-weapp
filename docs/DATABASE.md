# Database

MIP 权威结构在 `database/mysql/mip/` 和该目录的 `migrations.lock.json`。新表前缀固定为 `mip_*`，完整迁移记录写入 `mip_schema_migrations`，每条语句的执行状态写入 `mip_schema_migration_steps`，引擎使用 InnoDB。`mip_orders` 统一承载会员和付费活动订单。

活动相册由 `012_event_album.sql` 追加 `mip_event_album_photos` 与活动相册配置；照片只做状态迁移和版本更新，不执行物理业务删除。`015_checkin_growth_compensation.sql` 追加签到 transition，并将经验余额改为可表达精确冲销的有符号值。`016_notification_delivery_reservations.sql` 为订阅授权追加任务级 reservation，使微信调用可以移出数据库事务且不被其他任务并发复用。后续迁移继续按 lock 中的版本和 checksum 顺序应用。

根目录下 `database/mysql/001_member_schema.sql` 至 `014_event_owner_backfill_v2.sql` 是历史会员模板迁移，仅供迁移参考。默认命令不会应用、修复或回滚这些 `member_*` 对象；MIP 文档不把它们当作运行时表。活跃 MIP 合同见 [data-model.md](data-model.md)、[data-contract.md](data-contract.md)、[mip/ARCHITECTURE.md](mip/ARCHITECTURE.md) 和 `database/mysql/mip/`。

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

生产禁止 seed。演示数据 `is_demo=1`。MIP 函数部署前还必须验证专用 `mip_*` runtime 账号的精确表级权限，不允许 schema-level ALL 或全局权限。
