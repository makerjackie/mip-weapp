# Database

权威结构在 `database/mysql/` 迁移 `001`–`014` 与 `migrations.lock.json`。表前缀 `member_*`。引擎 InnoDB。

详细字段与合同继续以 [data-model.md](data-model.md) 和 [data-contract.md](data-contract.md) 为准，它们被源码契约引用，不要删。

```bash
pnpm database:setup -- --confirm-env=<EnvID>
```

生产禁止 seed。演示数据 `is_demo=1`。
