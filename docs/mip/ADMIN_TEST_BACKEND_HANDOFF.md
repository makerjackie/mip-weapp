# 测试管理后台资源边界（MIW-111）

正式与测试管理后台统一使用 CloudBase，同一 EnvID 内通过函数名、静态前缀、MySQL 认证 schema、账号与密钥隔离。域名、证书续期、运行证据及后续待验收项见 [当前交接](ADMIN_TEST_DOMAIN_HANDOFF.md)；实际部署按 [mip-admin-release](../../.agents/skills/mip-admin-release/SKILL.md)。首次部署前计划已被当前流程取代，历史方案从 Git 追溯。

## 配置与隔离

- 显式选择本机 `MIP_ENV_DIR`（通常 `envs/prod` 或 `envs/test`），核对 origin、BFF、上游函数、认证 schema 与静态前缀；资源名称见 [目标表](../../.agents/skills/mip-admin-release/references/custom-domain.md#dns-归属与目标选择)。不能仅凭 EnvID 识别目标。
- 测试 BFF 只调用 `mip-t-admin-api`；测试业务库为 `mip_test`，认证库为 `mip_test_admin_auth`，各自使用最小权限 runtime 账号。生产与测试不常态复制身份、密码、会话或 pepper。
- 部署脚本已支持 `MIP_ADMIN_WEB_FUNCTION_NAME`、`MIP_ADMIN_UPSTREAM_FUNCTION_NAME`、`MIP_ADMIN_AUTH_SCHEMA`、`MIP_ADMIN_CONSOLE_PREFIX` 与精确 origin。必须保留路由所有权、schema 所有权、静态前缀与逐字节回读守卫。
- 测试登录主回调和兼容 migration 回调均指向测试 BFF；实际小程序确认、扫码、浏览器会话与非空数据需要独立验收。
- 仅变更目标后台资源，不覆盖另一套后台、共享托管根或其他站点。小程序发布另按 `mip-release`，不由 Web 更新自动触发。

环境方向以 [ENVIRONMENTS.md](ENVIRONMENTS.md) 为准，动态状态与验收以 [PROJECT_STATUS.md](PROJECT_STATUS.md) 和对应 evidence 为准。
