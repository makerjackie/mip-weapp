# M05 后台账号与审计 实现计划

- 优先级：P0
- 波次：Wave 1（FR-004 账号管理阶段 1 + FR-005 审计日志独立页）；Wave 2（FR-026）后续单独排期
- 模块：M05
- 上游规格：[docs/admin-web-refactor-specs/05-backend-account-audit.md](../05-backend-account-audit.md)

## 1. 目标和范围

把 admin-web 现有的「按用户施加角色 + permissions 页内审计记录快捷预览」补齐为两块独立能力：

1. **FR-004 账号管理阶段 1**：新增独立的「后台账号」管理对象（`mip_admin_accounts` 表），提供列表 / 新增 / 编辑 / 启用停用 / 重置登录凭证，阶段 1 仍走手机验证码登录，不动登录通道。
2. **FR-005 审计日志独立页**：把 `audit.list` 从 permissions 页内 section 提升为独立路由 `/audit-logs`，补齐筛选（操作者 / 模块 / 操作类型 / 开始时间）和分页，permissions 页保留最近 N 条快捷预览并加「查看全部」入口。

非目标（Wave 2，本计划不实现）：

- FR-026 密码登录、登录记录页、角色 CRUD / 复制、角色配置化。
- 不改动 `AdminApiClient.beginLogin` / `pollLogin` 验证码登录流程。
- 不改动 `session-provider.tsx` 的 `hasCapability` / `hasCapabilityAtScope` 结构。

## 2. 实现步骤

### 步骤 2.1 审计日志独立页先行（FR-005）

理由：`audit.list` 契约与 `listAudit` 服务端实现已存在（`cloudfunctions/mip-admin-api/domain/governance.js:259`、`domain/repositories/access.js:472`），前端只需页面化消费，不依赖新表，可先于账号管理落地。

### 步骤 2.2 账号管理阶段 1（FR-004）

依赖迁移 068 `mip_admin_accounts` 新表和 5 个新 action 的服务端实现，随后再接前端。

### 步骤 2.3 permissions 页审计 section 降级为快捷预览

在独立页上线后，把 permissions 页的 audit section 从「全量加载」降级为「最近 N 条 + 跳转入口」。

## 3. 新建文件列表

| 文件路径 | 用途 |
|----------|------|
| `database/mysql/mip/068_admin_accounts.sql` | 新表 `mip_admin_accounts` 迁移 |
| `database/mysql/mip/rollback/068_admin_accounts.sql` | 回滚脚本 |
| `admin-web/src/modules/admin-accounts-mutation-forms.ts` | 账号 mutation 表单字段定义与 input builder（仿 `admin-people-mutation-forms.ts` 结构） |
| `admin-web/src/modules/admin-accounts-mutation-forms.test.ts` | 表单字段与 input builder 单测 |
| `admin-web/src/features/account-pages/account-pages.tsx` | 账号管理页 React 组件（列表 + 行操作触发 mutation） |
| `admin-web/src/features/account-pages/account-pages.react.test.tsx` | 账号页组件测试 |
| `admin-web/src/features/audit-pages/audit-pages.tsx` | 审计日志独立页 React 组件（只读列表 + 筛选 + 分页） |
| `admin-web/src/features/audit-pages/audit-pages.react.test.tsx` | 审计页组件测试 |

> 目录命名遵循 `admin-web/AGENTS.md` 的 `features/<domain>-pages/` 约定，与 `governance-pages/`、`core-pages/`、`operations-pages/` 平级。

## 4. 修改文件列表（每文件具体改动点 + 行号）

### 4.1 `admin-web/src/modules/admin-read-contracts.ts`（45 行）

- **第 5 行 `AdminListRoute`**：联合类型追加 `'adminAccounts'` 和 `'auditLogs'` 两个字面量。
  - 现状：`'users' | 'events' | 'orders' | 'tasks' | 'banners' | 'game' | 'permissions' | 'messages' | 'knowledge' | 'opportunities' | 'growth' | 'operations'`
  - 改后：末尾追加 `| 'adminAccounts' | 'auditLogs'`。
- 该文件其余接口（`AdminTableSection`、`AdminReadPage`、`AdminListQuery`、`AdminReadRouteDefinition`、`AdminRequest`）无需改动，新路由复用既有契约。

### 4.2 `admin-web/src/modules/admin-read-pages.ts`（427 行）

- **第 60-121 行 `routeDefinitions`**：追加两条路由定义。
  - `adminAccounts`：`searchPlaceholder: '搜索姓名、登录账号或手机号'`，`statusOptions: [...commonStatus, ...options(['ACTIVE', 'INACTIVE'])]`，`paginated: true`。
  - `auditLogs`：`searchPlaceholder: '搜索操作者或业务对象'`，`statusOptions: [...commonStatus]`（审计无状态维度，但保持结构一致），`paginated: true`。
- **第 127-147 行 `loadAdminReadPage` switch**：追加两个 case。
  - `case 'adminAccounts': return loadAdminAccounts(query, request, access)`
  - `case 'auditLogs': return loadAuditLogs(query, request, access)`
- **第 279-333 行 `loadPermissions`**：
  - 第 284 行 `audit.list` 调用从 `{ limit: query.limit }` 改为 `{ limit: 5 }`（快捷预览只取最近 5 条），或拆出独立 `loadPermissionsAuditPreview` 内联函数。
  - 第 316-323 行 `audits` 映射逻辑保留，但 section title 改为「最近审计记录」并在行尾追加「查看全部」链接（通过 `rowActions` 或 section 级 action 暴露，跳转 `/audit-logs`）。
- **新增 `loadAdminAccounts` 函数**（文件末尾）：调用 `request('mip.admin.adminAccounts.list', listInput(query))`，映射 `page.items` 到行（`detailId` / `name` / `loginAccount` / `role` / `branch` / `state`），列定义 `[['name','姓名'],['loginAccount','登录账号'],['role','角色'],['branch','服务器'],['state','状态']]`，透传 `nextCursor`。
- **新增 `loadAuditLogs` 函数**：调用 `request('mip.admin.audit.list', auditListInput(query))`，其中 `auditListInput` 把 `query.query` 映射为 `filters.actor`、`query.status` 映射为 `filters.action`（或留空），并透传 `cursor` / `limit`。行映射复用第 316-323 行的 `actor` / `action` / `resource` / `role` / `scope` / `createdAt` 字段，额外补充 `resourceId` / `metadata`（变更前/后内容）列。列定义扩展为 `[['actor','操作者'],['role','角色'],['scope','服务器'],['action','操作'],['resource','模块'],['resourceId','业务对象'],['createdAt','时间']]`。

### 4.3 `admin-web/src/modules/admin-people-mutation-forms.ts`（508 行）

- **第 4-13 行 `ADMIN_PEOPLE_MUTATION_ACTIONS`**：追加 5 个账号 action。
  - `'mip.admin.adminAccounts.create'`
  - `'mip.admin.adminAccounts.update'`
  - `'mip.admin.adminAccounts.changeStatus'`
  - `'mip.admin.adminAccounts.resetCredential'`
  - （`list` 为 QUERY，不进 mutation 数组）
- **第 75-83 行 `ROLE_OPTIONS`**：已含 7 个角色枚举，账号表单直接复用，无需改动。
- **第 127-229 行 `ADMIN_PEOPLE_MUTATION_CONFIG`**：追加 4 条 config（create / update / changeStatus / resetCredential），每条包含 `action` / `capability` / `title` / `description` / `fields` / `values`。
  - `create`：fields = `loginAccount`(text, required, maxLength 64) / `name`(text, required, maxLength 64) / `phone`(text, required, maxLength 20) / `roleKey`(select, required, options=ROLE_OPTIONS) / `scopeId`(text) / `branchId`(text) / `reason`(textarea, maxLength 300)。capability = `'roles.change'`。
  - `update`：fields = `name` / `phone` / `roleKey` / `scopeId` / `branchId`。`versionKind` 追加 `'adminAccount'` 到 `VERSION_FIELDS`（第 100-125 行）和 `VERSION_MINIMUMS`（第 235-240 行，minimum=1）。capability = `'roles.change'`。
  - `changeStatus`：fields = `status`(select, options ACTIVE/INACTIVE) / `reason`(textarea, required)。`versionKind: 'adminAccount'`。capability = `'roles.change'`。
  - `resetCredential`：fields = `reason`(textarea, required)。capability = `'roles.change'`。
- **第 100-125 行 `VERSION_FIELDS`**：新增 `adminAccount: [['基本信息','版本'],['账号信息','版本']]`。
- **第 235-240 行 `VERSION_MINIMUMS`**：新增 `adminAccount: 1`。
- **第 247-271 行 `createAdminPeopleMutationDefinition`**：函数本身无需改动（已通过 `versionKind` 泛化），新增 config 自动生效。
- **第 287-302 行 `buildAdminPeopleMutationInput` switch**：追加 4 个 case，调用新增的 `buildAdminAccountCreate` / `buildAdminAccountUpdate` / `buildAdminAccountChangeStatus` / `buildAdminAccountResetCredential` 私有函数。
- **新增私有 builder 函数**（文件末尾，仿第 384-407 行 `buildBranchCreate` / `buildBranchUpdate` 风格）：
  - `buildAdminAccountCreate(values)`：校验 `loginAccount`（`boundedText` maxLength 64，正则 `^[A-Za-z0-9_.-]{3,64}$`）/ `name` / `phone`（正则或 `boundedText` maxLength 20）/ `roleKey`（`oneOf` ROLE_OPTIONS 值）/ `scopeId`（`boundedId`）/ `branchId`（`boundedId`）/ `reason`。返回 `{ loginAccount, name, phone, roleKey, scopeId?, branchId?, reason }`。
  - `buildAdminAccountUpdate(definition, values)`：`versionValue(definition, 1)` + 同字段校验，返回 `{ accountId: definition.targetId, expectedVersion, name, phone, roleKey, scopeId?, branchId? }`。
  - `buildAdminAccountChangeStatus(definition, values)`：`versionValue` + `oneOf(['ACTIVE','INACTIVE'])` + `reason`，返回 `{ accountId, expectedVersion, status, reason }`。
  - `buildAdminAccountResetCredential(definition, values)`：`reason` 校验，返回 `{ accountId: definition.targetId, reason }`。

> 复用本文件已有的 `boundedText` / `boundedId` / `oneOf` / `versionValue` / `normalizeId` 工具函数，不引入新工具。

### 4.4 `admin-web/src/features/governance-pages/governance-pages.tsx`（362 行）

- **第 34 行 `GovernanceRoute`**：保持不变（审计独立页不进 GovernanceRoute，走独立 wrapper）。
- **第 97-135 行 `pageSpecs.permissions.sections`**：
  - 第 105 行 `{ key: 'audit', label: '审计记录' }` 保留，label 改为 `'最近审计记录'`。
  - 不从 sections 移除（保留快捷预览）。
- **第 200-208 行 `createTabItems`**：无需结构改动；audit section 的行操作区可选追加一个「查看全部」按钮，`onClick` 调 `useNavigate` 跳转 `/audit-logs`（`useNavigate` 已在第 170 行引入）。

### 4.5 `admin-web/src/app/navigation.tsx`（62 行）

- **第 17-32 行 `AdminRoutePath`**：追加 `| '/admin-accounts'` 和 `| '/audit-logs'`。
- **第 43-59 行 `adminNavigation`**：在「平台设置」组（第 55-58 行区间）插入两条：
  - `{ path: '/admin-accounts', label: '后台账号', description: '管理后台运营账号、角色和状态', group: '平台设置', icon: <UserOutlined />, capabilities: ['roles.change'] }`
  - `{ path: '/audit-logs', label: '审计日志', description: '查询完整操作审计记录', group: '平台设置', icon: <FileSearchOutlined />, capabilities: ['audit.read'] }`
  - 顺序建议放在 `/permissions` 之后、`/messages` 之前。
- 图标 `UserOutlined`（第 13 行已引入）和 `FileSearchOutlined`（第 6 行已引入）复用现有 import，无需新增。

### 4.6 `admin-web/src/app/route-pages.tsx`（375 行）

- **第 354-374 行 `routeComponents`**：追加两条映射。
  - `'/admin-accounts': AdminAccountsRoutePage`
  - `'/audit-logs': AuditLogsRoutePage`
- **新增两个 RoutePage 包装函数**（仿第 234-237 行 `PermissionsRoutePage` → `GovernanceRoutePage` 模式）：
  - `AdminAccountsRoutePage`：调用 `useAdminReadPage('adminAccounts', listQuery(search))`，把结果传入 `<AccountPage>`，行操作通过 `useAdminOperations().launch` 触发 mutation。
  - `AuditLogsRoutePage`：调用 `useAdminReadPage('auditLogs', listQuery(search))`，把结果传入 `<AuditLogsPage>`，无行操作（只读）。
- 两个新页面不进 `GovernanceRoutePage`（第 239 行），因为它们不是 governance tab 页，而是独立列表页，更接近 `OperationsRoutePage`（第 125 行）的 paginated 列表模式。
- **第 347-352 行 `governanceRouteCapabilities`**：无需改动（审计独立页有自己的 `PermissionGuard`）。
- 新增 capability 常量：
  - `const adminAccountRouteCapabilities = ['roles.change']`
  - `const auditLogRouteCapabilities = ['audit.read']`

### 4.7 `admin-web/src/app/router.tsx`（90 行）

- **第 33-38 行 `pageRoutes`**：无需手动改动。`pageRoutes` 由 `adminNavigation.map(...)` 生成，新增导航项后自动生成对应路由。
- 确认 `validateSearch`（第 14-24 行）对新路由生效：新路由共用同一 `validateSearch`，`q` / `status` / `cursor` / `page` / `tab` 均可用。

### 4.8 `admin-web/src/modules/admin-details.ts`（928 行）

- **第 20 行 `AdminDetailRoute`**：追加 `| 'adminAccounts'`（可选，供账号详情抽屉使用）。
- 若阶段 1 不做账号详情抽屉，可跳过此改动，仅列表页 + 行内 mutation 即可满足 FR-004。

### 4.9 `cloudfunctions/mip-admin-api/domain/operations/access.js`（13 行）

- **第 7 行后**：追加 6 条 `serviceOperation` 声明（1 QUERY + 5 MUTATION，对应规格 §7.1）。
  - `serviceOperation('mip.admin.adminAccounts.list', 'QUERY', 'listAdminAccounts')`
  - `serviceOperation('mip.admin.adminAccounts.create', 'MUTATION', 'createAdminAccount')`
  - `serviceOperation('mip.admin.adminAccounts.update', 'MUTATION', 'updateAdminAccount')`
  - `serviceOperation('mip.admin.adminAccounts.changeStatus', 'MUTATION', 'changeAdminAccountStatus')`
  - `serviceOperation('mip.admin.adminAccounts.resetCredential', 'MUTATION', 'resetAdminAccountCredential')`
- `audit.list`（第 12 行）已存在，不动。

### 4.10 `cloudfunctions/mip-admin-api/domain/public-operation-contract.js`

- **`adminWebQueryActions` 数组**（第 20-35 行区间）：追加 `'mip.admin.adminAccounts.list'`。
- **`webMutation` 区块**（第 118-127 行 access mutation 区间，紧接 `branches.changeStatus` 之后）：追加 4 条 mutation 声明。
  - `webMutation('mip.admin.adminAccounts.create', ['loginAccount', 'name', 'phone', 'roleKey'], ['scopeId', 'branchId', 'reason'])`
  - `webMutation('mip.admin.adminAccounts.update', ['accountId', 'expectedVersion', 'name', 'phone', 'roleKey'], ['scopeId', 'branchId'])`
  - `webMutation('mip.admin.adminAccounts.changeStatus', ['accountId', 'expectedVersion', 'status', 'reason'])`
  - `webMutation('mip.admin.adminAccounts.resetCredential', ['accountId', 'reason'])`
- **`operation-registry.js` 第 5 行 `EXPECTED_OPERATION_COUNT`**：从 `187` 改为 `192`（+5 个新 operation）。

### 4.11 `cloudfunctions/mip-admin-api/domain/governance.js`（311 行+）

- **第 307-315 行 return 对象**：追加 `listAdminAccounts` / `createAdminAccount` / `updateAdminAccount` / `changeAdminAccountStatus` / `resetAdminAccountCredential` 5 个方法导出。
- **新增 5 个方法实现**（仿第 259-278 行 `listAudit` 模式）：
  - `listAdminAccounts(caller, input)`：`access.session(caller)` → `firstGrant(context.bindings, CAPABILITIES.ROLES_CHANGE)` → `repository.listAdminAccounts(appId, visibility, filters, limit, cursor)` → `recordAudit`。
  - `createAdminAccount(caller, input)`：校验唯一性（loginAccount / phone），插入 `mip_admin_accounts`，`recordAudit(action: 'admin.account.create')`。
  - `updateAdminAccount(caller, input)`：乐观锁 `expectedVersion`，更新 name/phone/roleKey/scopeId/branchId，校验 phone 唯一性，`recordAudit`。
  - `changeAdminAccountStatus(caller, input)`：乐观锁，拒绝停用自身、拒绝停用最后一个 PLATFORM_OWNER，`recordAudit`。
  - `resetAdminAccountCredential(caller, input)`：重置凭证令牌，`recordAudit`。
- 安全规则在方法内实现（规格 §4.5）：
  - 停用自身：比较 `caller.userId === input.accountId` 时抛 `SELF_DEACTIVATION_FORBIDDEN`。
  - 最后一个超级管理员：`repository.countActivePlatformOwners(appId) <= 1` 时抛 `LAST_PLATFORM_OWNER_FORBIDDEN`。

### 4.12 `cloudfunctions/mip-admin-api/domain/repositories/access.js`（529 行+）

- **第 529 行 return 对象**：追加 `listAdminAccounts` / `createAdminAccount` / `updateAdminAccount` / `changeAdminAccountStatus` / `resetAdminAccountCredential` / `countActivePlatformOwners`。
- **新增 repository 方法**（仿第 472-528 行 `listAudit` SQL 模式）：
  - `listAdminAccounts(appId, visibility, filters, pageLimit, cursor)`：`SELECT` from `mip_admin_accounts`，JOIN `mip_profiles` 取 name，支持 filters（roleKey / branchId / status / query）。
  - `createAdminAccount`：`INSERT`，唯一约束由 DB 层保证（login_account 唯一索引）。
  - `updateAdminAccount`：`UPDATE ... WHERE version = ?`，返回 affected rows 判断乐观锁。
  - `changeAdminAccountStatus`：同上 `UPDATE version + status`。
  - `resetAdminAccountCredential`：`UPDATE credential_token + credential_reset_at`。
  - `countActivePlatformOwners(appId)`：`SELECT COUNT(*) WHERE role_key='PLATFORM_OWNER' AND status='ACTIVE'`。

### 4.13 `cloudfunctions/mip-admin-api/domain/service.js`

- **第 271 行 / 第 437 行 governance 方法导出**：追加 5 个新方法（与 governance.js 导出对齐）。

### 4.14 `cloudfunctions/mip-admin-api/domain/repository.js`

- **第 314 行 / 第 1377 行 access repository 导出**：追加 6 个新方法。

### 4.15 `packages/admin-contracts/src/generated/admin-operation-contract.ts`

- 该文件由 `scripts/generate-admin-operation-contract.mjs --write` 自动生成，不手动编辑。
- 新增 operation 后运行生成脚本刷新此文件，使 `AdminOperationAction` 联合类型自动包含新 action。

## 5. 数据模型（mip_admin_accounts 新表）

迁移文件：`database/mysql/mip/068_admin_accounts.sql`

| 列名 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | `BIGINT UNSIGNED` | `PRIMARY KEY AUTO_INCREMENT` | 账号 ID |
| `app_id` | `VARCHAR(32)` | `NOT NULL`，复合索引 | 应用隔离 |
| `login_account` | `VARCHAR(64)` | `NOT NULL`，`UNIQUE KEY uk_app_login (app_id, login_account)` | 登录账号，系统内唯一 |
| `phone` | `VARCHAR(20)` | `NOT NULL`，`UNIQUE KEY uk_app_phone (app_id, phone)` | 手机号，系统内唯一 |
| `name` | `VARCHAR(64)` | `NOT NULL` | 姓名 |
| `user_id` | `VARCHAR(36)` | `NULL`，`KEY idx_user (app_id, user_id)` | 关联 `mip_users.id`（阶段 1 可空，运营账号不一定有微信用户） |
| `role_key` | `VARCHAR(32)` | `NOT NULL` | 角色（与 `mip_admin_role_bindings.role_key` 取值一致） |
| `scope_type` | `VARCHAR(16)` | `NOT NULL DEFAULT 'PLATFORM'` | 作用范围类型 |
| `scope_id` | `VARCHAR(36)` | `NULL` | 作用范围 ID（BRANCH / EVENT 时必填，服务端校验） |
| `branch_id` | `VARCHAR(36)` | `NULL` | 服务器归属 |
| `status` | `VARCHAR(16)` | `NOT NULL DEFAULT 'ACTIVE'` | `ACTIVE` / `INACTIVE` |
| `credential_token` | `VARCHAR(128)` | `NULL` | 重置凭证令牌（阶段 1 验证码登录态令牌） |
| `credential_reset_at` | `DATETIME` | `NULL` | 凭证重置时间 |
| `created_by` | `VARCHAR(36)` | `NOT NULL` | 创建人 user_id |
| `created_at` | `DATETIME` | `NOT NULL DEFAULT CURRENT_TIMESTAMP` | 创建时间 |
| `updated_by` | `VARCHAR(36)` | `NULL` | 修改人 user_id |
| `updated_at` | `DATETIME` | `NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP` | 修改时间 |
| `version` | `INT UNSIGNED` | `NOT NULL DEFAULT 1` | 乐观锁版本 |

回滚脚本：`database/mysql/mip/rollback/068_admin_accounts.sql` → `DROP TABLE IF EXISTS mip_admin_accounts;`

> `mip_audit_logs` 表已存在（`repositories/access.js:472` 引用），本计划不新增审计表，仅扩展前端消费方式。

## 6. 测试要点

### 6.1 合同测试（AGENTS.md §11 排查规则）

- 审计日志独立页必须包含非空服务端响应到页面展示的合同测试：`loadAuditLogs` 接收含 `items` / `nextCursor` 的 payload，断言行字段 `actor` / `action` / `resource` / `createdAt` 正确映射，不能仅靠空列表或类型声明通过。
- 账号列表同理：`loadAdminAccounts` 接收含 `loginAccount` / `roleKey` / `status` 的 payload，断言行字段正确。
- 受保护页面的身份检查锁只覆盖身份决策：审计页 `audit.read` 失败后的重试必须重新确认身份，不能让装饰性请求失败导致整页错误。

### 6.2 表单校验

- `admin-accounts-mutation-forms.test.ts`：
  - `buildAdminAccountCreate`：loginAccount 不符合正则返回 `null`；phone 为空返回 `null`；roleKey 不在枚举返回 `null`；合法输入返回正确 payload。
  - `buildAdminAccountUpdate`：缺 `expectedVersion` 返回 `null`；`expectedVersion < 1` 返回 `null`。
  - `buildAdminAccountChangeStatus`：status 不在 `['ACTIVE','INACTIVE']` 返回 `null`；缺 reason 返回 `null`。
  - `buildAdminAccountResetCredential`：缺 reason 返回 `null`。

### 6.3 权限分离

- 审计日志独立页 `PermissionGuard` capabilities = `['audit.read']`，无该能力的账号看不到导航项和页面。
- 账号管理页 `PermissionGuard` capabilities = `['roles.change']`。
- 审计页为只读：不渲染行操作列，不注册任何 mutation action。

### 6.4 安全保护规则（服务端）

- `governance-module.test.js` 追加用例：
  - 停用自身：`changeAdminAccountStatus(caller, { accountId: caller.userId, status: 'INACTIVE' })` 抛 `SELF_DEACTIVATION_FORBIDDEN`。
  - 最后一个超级管理员停用：mock `countActivePlatformOwners` 返回 1，`changeAdminAccountStatus` 抛 `LAST_PLATFORM_OWNER_FORBIDDEN`。
  - loginAccount 重复：`createAdminAccount` 抛 `LOGIN_ACCOUNT_DUPLICATE`。
  - phone 重复：`createAdminAccount` / `updateAdminAccount` 抛 `PHONE_DUPLICATE`。

### 6.5 列表加载

- `admin-read-pages.test.ts` 追加：
  - `loadAdminAccounts` 分页：`nextCursor` 透传。
  - `loadAuditLogs` 筛选：`filters.actor` / `filters.action` 正确传入 `audit.list` input。
  - `loadPermissions` 快捷预览：`audit.list` 调用 `limit: 5`（降级后）。

### 6.6 组件测试

- `audit-pages.react.test.tsx`：渲染含数据的列表；筛选变更触发 `onFilterChange`；分页下一页触发 `onNextPage`；无行操作按钮。
- `account-pages.react.test.tsx`：渲染含数据的列表；行操作按钮点击触发 `onMutationRequest`；新增按钮触发 create mutation。

## 7. 验收检查清单

- [ ] `pnpm admin:web:verify` 全绿（类型检查 + 契约测试 + 组件测试 + 构建 + 响应式验证）
- [ ] `pnpm verify` 全绿（服务端契约变更后）
- [ ] `git diff --check` 无空白错误
- [ ] 审计日志独立页 `/audit-logs` 可筛选（操作者 / 模块 / 操作类型 / 开始时间）并分页，桌面端 Chrome / Edge / Firefox 最新版通过
- [ ] permissions 页「最近审计记录」section 保留，展示最近 5 条，提供「查看全部」跳转 `/audit-logs`
- [ ] 账号列表 `/admin-accounts` 展示姓名 / 登录账号 / 角色 / 服务器 / 状态
- [ ] 新增账号表单：loginAccount 重复报错；phone 重复报错；BRANCH_ADMIN / EVENT_* 角色必填服务器归属
- [ ] 编辑账号：登录账号不可修改；手机号修改重新校验唯一性
- [ ] 启用 / 停用 / 重置凭证均记录审计日志
- [ ] 停用自身被服务端拒绝
- [ ] 最后一个超级管理员停用 / 降权被服务端拒绝
- [ ] 停用后下次请求被服务端拒绝（`AUTH_REQUIRED`），前端 `SessionProvider` 接管
- [ ] `EXPECTED_OPERATION_COUNT` 从 187 改为 192，`generate-admin-operation-contract.mjs --check` 通过
- [ ] `packages/admin-contracts/src/generated/admin-operation-contract.ts` 已刷新，`AdminOperationAction` 联合类型包含 5 个新 action
- [ ] 手机号、登录账号相关操作需真机 / 生产环境验证（AGENTS.md §11 领域规则）

## 8. 实现顺序

1. **迁移 068**：创建 `mip_admin_accounts` 表 + 回滚脚本。
2. **服务端 operation 声明**：`access.js` 追加 6 条 `serviceOperation` → `public-operation-contract.js` 追加 query + 4 mutation → `operation-registry.js` 更新 `EXPECTED_OPERATION_COUNT` 为 192。
3. **契约刷新**：运行 `node scripts/generate-admin-operation-contract.mjs --write` 刷新 `packages/admin-contracts/src/generated/admin-operation-contract.ts`。
4. **服务端实现**：`governance.js` 5 个方法 + `repositories/access.js` 6 个 repository 方法 + `service.js` / `repository.js` 导出 + 安全规则。
5. **服务端测试**：`governance-module.test.js` + `access-repository-module.test.js` 追加用例。
6. **FR-005 审计日志独立页（前端）**：
   - `admin-read-contracts.ts` 追加 `'auditLogs'` 路由字面量。
   - `admin-read-pages.ts` 追加 `routeDefinitions.auditLogs` + `loadAuditLogs` + `loadPermissions` 降级为快捷预览。
   - `navigation.tsx` 追加 `/audit-logs` 导航项。
   - `route-pages.tsx` 追加 `AuditLogsRoutePage` + `routeComponents` 映射。
   - 新建 `features/audit-pages/audit-pages.tsx` 组件 + 测试。
7. **FR-004 账号管理（前端）**：
   - `admin-read-contracts.ts` 追加 `'adminAccounts'` 路由字面量。
   - `admin-read-pages.ts` 追加 `routeDefinitions.adminAccounts` + `loadAdminAccounts`。
   - `admin-people-mutation-forms.ts` 追加 4 个 action + config + builder（含 `VERSION_FIELDS` / `VERSION_MINIMUMS` 扩展）。
   - `navigation.tsx` 追加 `/admin-accounts` 导航项。
   - `route-pages.tsx` 追加 `AdminAccountsRoutePage` + `routeComponents` 映射。
   - 新建 `modules/admin-accounts-mutation-forms.ts`（若从 people-mutation-forms 拆出独立文件）或直接在 `admin-people-mutation-forms.ts` 内追加 + 测试。
   - 新建 `features/account-pages/account-pages.tsx` 组件 + 测试。
8. **permissions 页降级**：`governance-pages.tsx` audit section label 改为「最近审计记录」，追加「查看全部」跳转。
9. **全量验证**：`pnpm verify` → `pnpm admin:web:verify` → `pnpm verify:all` → `git diff --check`。
