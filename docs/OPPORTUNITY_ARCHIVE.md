# 机会草稿归档

平台运营可以把没有外部业务事实的机会草稿归档。归档是版本化状态变更，不物理删除机会、角色、标签、素材引用或既有审计。

## 状态与权限

- 只有 `DRAFT` 可以进入 `ARCHIVED`；已经发布、结束或下架的机会不能走归档。
- 归档记录保存服务端时间、运营用户、原因和新版本。
- `ARCHIVED` 不属于公开状态，也不能通过原草稿保存接口恢复为 `DRAFT`。
- 接线时使用独立的 `opportunities.archive` capability，只授予平台范围的 `PLATFORM_OWNER` 和 `PLATFORM_OPERATIONS`。分会管理员、活动角色和财务角色不能归档机会。

## 业务事实阻塞

归档事务先锁定 AppID 范围内的机会记录，再检查以下事实；任一存在即返回 `OPPORTUNITY_ARCHIVE_BLOCKED`，不更新机会，也不写归档审计：

- 任意状态的 `mip_referral_intents`；
- 以该机会为来源的 `mip_profile_interests`；
- `resource_id` 指向该机会的 `mip_orders`；
- 指向该机会的 `mip_announcements`；
- 以该机会为聚合根的 `mip_outbox_events`；
- 非零的机会引荐计数，即使明细出现异常缺失也按阻塞处理。

机会自身的角色、标签、封面和创建/编辑审计属于草稿组成或治理记录，不算外部业务事实，归档后继续保留。以后新增任何会引用机会的耐久业务表时，必须同步扩展归档阻塞检查；创建该事实的事务必须先锁定同一机会行，避免与归档并发穿透。

## 一致性与回滚

`mip_opportunities_archive_ck` 保证只有 `ARCHIVED` 记录能携带归档字段，也保证归档记录的时间、操作者和原因完整。现有草稿保存 SQL 不会清空这些字段，因此不能意外恢复已归档记录。

014 rollback 只做结构回滚。只要存在 `ARCHIVED` 记录，旧状态约束就会使整条 `ALTER TABLE` 原子失败；rollback 不删除、改写或自动恢复归档事实。如需恢复能力，应通过后续迁移和独立审计操作实现。

## 运营接口

`mip.admin.opportunities.archive` 使用独立 `opportunities.archive` capability。管理端只对 `DRAFT` 且拥有该 capability 的用户显示归档入口，提交 `expectedVersion` 和归档原因。`OPPORTUNITY_ARCHIVE_BLOCKED` 只返回允许的阻塞类别，不返回关联记录标识。

运营端可按 `ARCHIVED` 筛选历史草稿；用户端列表、详情和编辑接口都不返回已归档记录。
