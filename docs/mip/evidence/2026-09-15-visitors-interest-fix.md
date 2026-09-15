# 访客已读与感兴趣交互修复

## 问题与修复

- `markProfileVisitorRead` 曾将公开 `profileRef` 写入审计 `resource_id`；目标环境只读查询确认该列为 `CHAR(36)`。现改为服务端解析的访客 UUID，公开标识保留在 metadata，已读更新与审计继续同一事务。
- 访客重试保留非空列表并展示刷新进度，重复点击不会发起并行刷新。
- 档案、机会和合作卡的兴趣按钮显示乐观选择，支持请求期间再次切换，复用持久化幂等队列。明确失败回滚；未知结果保留意图并提示恢复。

## 验证

- `pnpm verify:all` 通过（包含小程序与 Web 门禁）。
- 服务端访客测试验证审计 UUID 与字段容量；非空访客页面测试覆盖已读失败、重试进度、去重与成功清除提示。
- 兴趣队列测试覆盖快速切换顺序、明确拒绝回滚、未知结果与幂等恢复。
- `pnpm runtime:preflight` 通过；不代表微信真机交互验收。

## 云端

- 构建产物的 CloudBase 环境与本机配置匹配；配置阶段为 staging，使用远端 CloudBase/MySQL。
- 本次仅更新 `mip-opportunities-api`。更新后回读状态 `Active`，`ModTime=2026-09-15 11:56:39`；云端 health 返回 `ok=true`、`persistence=cloudbase-mysql`。
- 首次部署后管理调用返回 `Cam authentication failed`；恢复本地授权通道和 MCP 连接后，独立健康调用通过。
- 完整 `cloud:verify` 通过：schema、最小权限、核心函数健康与受保护调用规则均已回读。
- 手机实际访客已读、红点更新及兴趣选择持久化仍待用户复测；不代表其他历史审计函数已在本次部署。
