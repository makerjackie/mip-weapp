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

## 测试管理员（2026-10-16 更新）

用户已完成测试小程序真实注册、手机号授权和主分会选择。测试 `PLATFORM_OWNER` 已通过受控初始化开通；本机开发者工具的真实微信身份与目标注册用户一致，已自动通过现有工作台确认，按用户授权首次绑定指定密码。`test.admin.mip.cool` 的浏览器密码登录、刷新、非空用户列表和退出通过；接口认证/读取 14 项通过。密码不写入仓库，后续正常登录无需重复首次微信确认。详见[账号开通验收](evidence/admin-test-account-20261016/README.md)。

测试预览包仍有一处域名提示待修正：现场工作台显示核对 `admin.mip.cool`，实际测试登录码和会话走测试 BFF；下次测试小程序构建时同步目标域名显示配置，本轮未重新发布小程序。

## 继续开发与测试前的边界

- 首次域名绑定时静态产物对应 `bad246c3` 加测试 checkout 的部署参数化改动，入口记录在首次绑定报告中；本轮账号验收没有重新发布活动界面或重验全量静态字节，不以历史清单断言当前网站版本。合并 Git 的活动代码不会自动更新网站；后续活动代码通过完整 `pnpm verify:all` 后，按测试目标同步部署 BFF 与静态入口，再逐文件核对线上清单。
- 本交付分支已合入 `feature/test-admin-cloudbase` 的 `5ec31031`（测试部署参数化与旧部署入口清理），并保留截至 `ff1a3d8e` 的已提交主线。账号验收时主 checkout 已为 `93c1db10`，先前合并冲突已不在；本次未改动它的 index 或工作文件。接手时重新审计两边状态，再 fetch 并集成 `origin/codex/test-admin-renewal-20261016`，不要覆盖后续并行改动。随后核对目标配置，不能按生产默认命令更新测试后台。
- 测试 `mip-t-admin-api` 的 `MIP_ADMIN_WEB_LOGIN_CONFIRM_URL` **和** `MIP_ADMIN_WEB_LOGIN_MIGRATION_URL` 都应为 `https://test.admin.mip.cool/api/internal/auth/challenge/confirm`。`9xxxxx` / `z_` 测试命名空间会走 migration 回调；不能只检查主回调。
- 账号认证已按上方新增记录完成；[账号与隔离记录](evidence/admin-test-isolation-20261016/README.md)保留更早的空库快照及权限核查，不代表最新账号状态。开发者工具真实确认、非空用户读取与浏览器密码登录已通过；手机扫码、活动非空数据及完整功能仍需另行验收。
- 活动验收须对照 PRD/原型实际操作创建、编辑、富文本与媒体、地点选择、报名与订单等范围；自动化脚本、静态检查和证书验收不能代替功能/真机验收。按用户要求保留 UI 对照和每项 PASS/FAIL/BLOCKED 报告。
