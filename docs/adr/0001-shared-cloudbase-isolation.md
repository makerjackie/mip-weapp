# 在共享 CloudBase 中隔离 MIP

MIP 短期复用 OIMVP 的 AppID、CloudBase 和 MySQL，但其他小程序仍依赖该环境。MIP 因此只新增 `mip_*` 表、部署 `mip-*` 函数并写入 `mip/` 存储前缀；历史表和资源保持只读，迁移使用独立 `mip_schema_migrations`，每次共享环境改表前先做仓库外备份。正式切换到新 AppID 时只迁移这些 MIP 资源，避免用 AppID 作为当前共享环境中的唯一隔离边界。
