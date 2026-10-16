# 管理后台发布流程清理（2026-10-16）

范围：更新仓库的发布方法、目标配置与误导性旧入口。交付位于 `codex/test-admin-renewal-20261016`；合入并行的 `5ec31031`，保留活动实现、两套部署参数化与既有证书续期交付。主 checkout 的并行合并现场未被本任务修改。

## 当前入口

- 管理后台更新、部署、线上版本验证：[mip-admin-release](../../../../.agents/skills/mip-admin-release/SKILL.md)。域名、登录和续期流程按其 reference 使用。
- 当前发布平台为 CloudBase；正式 `admin.mip.cool`，测试 `test.admin.mip.cool`。域名和权威 DNS 归阿里云，SSL 证书与 HTTP 网关归腾讯云。
- 小程序发布由 `mip-release` 负责；业务初始化、schema、owner 与 seed 由 `mip-operations` 负责。Web 更新不自动触发微信上传。

## 清理内容

1. 删除 Wrangler 依赖、Pages 部署命令、三份 Wrangler 配置、Pages HTTP 入口、旧 `_headers` 与一次性账号迁移脚本。锁文件按合并后的依赖重新生成，保留 Playwright 与活动富文本依赖。
2. 统一 skill、README、运行手册、环境文档与执行计划，显式选择正式/测试配置；发布顺序统一为兼容 BFF 在前、新静态入口在后，回滚使用同一目标的匹配产物。
3. 部署登录回调默认跟随目标 admin-api 或配置 origin，两条命名空间回调均落所选目标。显式历史覆盖继续保留，环境文件压缩不再删除这些覆盖。密码冒烟必须显式配置目标 origin，拒绝路径、凭证、查询和片段，防止测试凭证发往隐含旧地址。
4. SQLite 认证 SQL 保留作本地测试方言，类型和查询名移除 D1 平台命名；线上初始化只使用 MySQL 迁移。
5. 旧测试部署计划改为当前资源边界说明。含过时 Pages 部署待办的两份历史验收报告增加退役提示，原检查结果不改写；旧工具遗留私有缓存和本机配置继续被 Git 忽略。

## 验证

- Node `22.23.1` / pnpm `11.14.0`；合并后锁文件生成与 frozen install 通过，Wrangler 依赖已清除，Playwright 与 TipTap 依赖保留。
- 完整 `pnpm verify:all`：PASS。根测试 275 文件 / 1788 项通过；服务端合同门禁通过（712 owned sources / 300 test files）；Web Node 合同 294 项、React 28 文件 / 182 项通过；两端构建与 Web 响应式源码/产物合同通过。
- 服务端的两项真实 MySQL 专项未启用（SKIP：参与人数实库一致性、SQL 实库执行）；本轮没有连接云端数据库补跑。
- CloudBase BFF 本地打包：PASS。三个相关 skill 的格式校验、文档链接与 `git diff --check` 通过。当前发布 skill、运行手册和可执行部署入口不再引用旧平台部署方式。
- 原始日志仅留本机忽略目录；完整门禁日志 SHA-256：`1f86160a6eda4d9fb4599ebb6a447c986f2f6f68c1e9c64de993772a4a5d10d4`。

## 运行边界

本次清理没有部署线上代码，也没有删除或下线云端旧平台资源。Git 中删除旧部署文件不证明云端资源已删除。测试域名证书与自动续期运行结果仍以[续期报告](../admin-test-renewal-20261016/README.md)为准；账号级登录、测试小程序真机确认与活动功能验收仍按[当前交接](../../ADMIN_TEST_DOMAIN_HANDOFF.md)继续，不以本轮本地检查宣布通过。
