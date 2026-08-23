# Database

MIP 权威结构在 `database/mysql/mip/` 和该目录的 `migrations.lock.json`。新表前缀固定为 `mip_*`，迁移记录写入 `mip_schema_migrations`，引擎使用 InnoDB。

根目录下 `database/mysql/001_member_schema.sql` 至 `014_event_owner_backfill_v2.sql` 是历史会员模板迁移，仅供迁移参考。默认命令不会应用、修复或回滚这些 `member_*` 对象。历史字段合同仍保留在 [data-model.md](data-model.md) 和 [data-contract.md](data-contract.md)，活跃 MIP 合同见 [mip/ARCHITECTURE.md](mip/ARCHITECTURE.md) 和 `database/mysql/mip/`。

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

迁移执行器会在写入前拒绝任何非 `mip_*` 表引用，并在发现“表已存在但没有迁移记录”的半截迁移时停止，要求人工核对，不猜测或覆盖结构。

生产禁止 seed。演示数据 `is_demo=1`。
