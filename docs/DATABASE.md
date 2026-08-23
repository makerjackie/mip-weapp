# Database

权威结构在 `database/mysql/` 迁移 `001`–`014` 与 `migrations.lock.json`。表前缀 `member_*`。引擎 InnoDB。

详细字段与合同继续以 [data-model.md](data-model.md) 和 [data-contract.md](data-contract.md) 为准，它们被源码契约引用，不要删。

```bash
pnpm database:setup -- --confirm-env=<EnvID>
```

共享环境改表前先做仓库外的只读逻辑备份：

```bash
pnpm database:backup -- --confirm-env=<EnvID>
```

默认输出到本机 `~/Backups/mip-weapp/`，包含结构元数据、逐表 JSONL、行数清单和 SHA-256。备份含用户与订单数据，不得提交或共享。该命令使用分页只读查询并复核前后行数，不是事务快照；生产变更仍应同时保留 CloudBase 控制台的自动或手动备份。

生产禁止 seed。演示数据 `is_demo=1`。
