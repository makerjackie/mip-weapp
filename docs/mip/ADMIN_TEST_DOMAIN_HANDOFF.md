# 测试管理后台域名与续期交接

交付分支：`codex/test-admin-renewal-20261016`；本地完整交付位于受管 `test-admin-renewal` worktree。本次负责 `test.admin.mip.cool` 的 HTTPS 绑定、登录回调配置与自动续期。运行结果以[续期验收报告](evidence/admin-test-renewal-20261016/README.md)及[首次域名绑定证据](evidence/admin-test-domain-20261016/README.md)为准。活动管理/创建的产品实现和后续完整功能测试属于另一项工作。

## 接手从这里开始

1. 读根 `AGENTS.md`、`admin-web/AGENTS.md`、[Web 验收标准](../../admin-web/ACCEPTANCE.md)和仓库 [mip-admin-release skill](../../.agents/skills/mip-admin-release/SKILL.md)。先审计工作区，再 fetch/同步；不要覆盖并行 AI 的未提交改动。
2. 正式入口 <https://admin.mip.cool/>；测试入口 <https://test.admin.mip.cool/>。两者在同一个 CloudBase EnvID 内，靠函数名、静态前缀、认证库与密钥隔离，不能只凭 EnvID 判断目标。
3. 域名和权威 DNS 在**阿里云**。用户已添加 `test.admin` CNAME → `test.admin.mip.cool.tcbaccess.tencentcloudbase.com`。证书与网关在腾讯云。续期走 FILE 验证，不需要复制阿里云密钥，不要修改该 CNAME 或关闭 HTTPS。

| 测试资源 | 名称 |
| --- | --- |
| 前端静态前缀 | `mip-admin-console-test/` |
| `/api`、`/assets` BFF | `mip-t-admin-web-api` |
| 业务上游 | `mip-t-admin-api` |
| 认证 schema | `mip_test_admin_auth` |
| 续期函数 / timer | `mip-t-admin-cert-renewer` / `mip-t-admin-cert-daily` |
| 续期专用角色 / 策略 | `MIPTestAdminCertRenewerRole` / `MIPTestAdminCertRenewerPolicy` |

## 续期维护

正式和测试任务共用 `cloudfunctions/mip-admin-cert-renewer/`，各自部署，状态、HMAC、日志与申请记录独立。普通 Web 发布不覆盖续期任务。更新续期实现时，按 [certificate-renewal.md](../../.agents/skills/mip-admin-release/references/certificate-renewal.md)执行 pause → 备份 → 完整门禁 → deploy → 实际 timer canary → activate → status；不得跳过实际 timer 或重复 force 申请免费订单。

使用已核实的本机测试配置目录 `MIP_ENV_DIR`；本轮配置位于 `.worktrees/test-admin/envs/test`，不是把生产配置复制到测试。状态读取命令为：

```bash
MIP_ENV_DIR=<实际测试配置目录> CLOUDBASE_AUTH_MODE=local \
node scripts/admin-cert-renewal.mjs status \
  --domain=test.admin.mip.cool \
  --confirm-env=<已核实的EnvID> \
  --confirm-function=mip-t-admin-cert-renewer
```

本机 Device Flow 已授权，正常复用，不自动发起新授权。凭证、私有配置、签名参数及原始云端回读仅留本机 `.tmp/`，不入 Git。CLS 日志应使用账号自有资源（`AssumerName` 为空），服务归属 TCB 主题可能导致 SCF 创建失败；操作步骤已写入 skill。

## 继续开发与测试前的边界

- 本轮未重新发布活动界面。测试站现有静态产物对应 `bad246c3` 加测试 checkout 的部署参数化改动，入口记录在首次绑定报告中；合并 Git 的活动代码不会自动更新网站。后续活动代码通过完整 `pnpm verify:all` 后，按测试目标同步部署 BFF 与静态入口，再逐文件核对线上清单。
- 并行任务已将测试部署参数化与 Cloudflare 退役提交为 `feature/test-admin-cloudbase` 的 `5ec31031`。本轮收尾观察到主 checkout 正合入该提交，`pnpm-lock.yaml` 尚有冲突；本次没有改动它的 index、合并状态或工作文件。本交付保留截至 `ff1a3d8e` 的已提交主线，未混入这份尚在处理的功能合并。接手时先完成并行合并，再 `git fetch origin`、`git merge origin/codex/test-admin-renewal-20261016`，保留两边意图。部署前核对参数化已合入且目标为测试，不直接照生产默认命令运行。
- 测试 `mip-t-admin-api` 的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` **和** `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 都应为 `https://test.admin.mip.cool/api/internal/auth/challenge/confirm`。`9xxxxx` / `z_` 测试命名空间会走 migration 回调；不能只检查主回调。
- 尚缺本机 `MIP_ADMIN_TEST_PHONE` / `MIP_ADMIN_TEST_PASSWORD`，完整账号级 `verify-admin-cloudbase` 为 BLOCKED；先由测试管理员通过测试小程序确认登录并本人设置密码，不复制生产密码或哈希。测试小程序确认、二维码扫码、登录后非空业务数据和活动完整功能均需另行验收。
- 活动验收须对照 PRD/原型实际操作创建、编辑、富文本与媒体、地点选择、报名与订单等范围；自动化脚本、静态检查和证书验收不能代替功能/真机验收。按用户要求保留 UI 对照和每项 PASS/FAIL/BLOCKED 报告。
