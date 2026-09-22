# 前置契约与迁移实施计划

> 生成时间: 2026-09-19
> 依据: admin-web-refactor-specs/00-overview.md + 8 个模块 spec
> 目标: 一次性定义所有新增 action 和数据库迁移，解除前端模块并行阻塞

## 一、契约扩展总览

### 契约体系架构（现有）

```
cloudfunctions/mip-admin-api/domain/operations/<owner>.js   ← action 声明（SOURCE）
    ↓
cloudfunctions/mip-admin-api/domain/operation-registry.js    ← 校验 + EXPECTED_OPERATION_COUNT
    ↓
cloudfunctions/mip-admin-api/domain/public-operation-contract.js  ← web mutation policy / query actions
    ↓
scripts/generate-admin-operation-contract.mjs --write        ← 生成 TS artifact
    ↓
packages/admin-contracts/src/generated/admin-operation-contract.ts
```

当前状态: 187 个 action, 14 个 owner, 60 个迁移文件 (001-060)

### 新增 action 按 owner 分配

| Owner | 现有 action 数 | 新增 action 数 | 新增 action 列表 |
|--------|-------------|-------------|----------------|
| TASKS | ~13 | 4 | submissions.approve, submissions.reject, submissions.retryReward, assign |
| EVENTS | ~18 | 7 | feedbacks.list, feedbacks.export, checkinQrcode.get, participants.import, participants.cancel, participants.markAbnormal, hearts.list |
| USERS | ~7 | 3 | invitedGuests.list, likeRelations.list, operationLogs.list |
| OPPORTUNITIES | ~8 | 3 | operationLogs, delete, referrals |
| GROWTH | ~10 | 6 | levels.changeStatus, benefits.changeStatus, levelTransitions.list, rules.changeStatus, exp.transactions.reverse, contribution.transactions.reverse |
| MEMBERSHIPS | ~3 | 2 | entitlements.transactions.list, entitlements.grant |
| ORDERS | ~4 | 1 | refunds.list |
| BANNERS | ~7 | 0 | (无新增，复用现有) |
| 新增 OWNER: ADMIN_ACCOUNTS | 0 | 5 | list, create, update, changeStatus, resetCredential |
| 新增 OWNER: COOPERATION_CARDS | 0 | 2 | get, save |
| 新增 OWNER: CONTRIBUTION | 0 | 4 | rules.list, rules.save, transactions.list, transactions.reverse |
| 新增 OWNER: VIDEOS | 0 | 3 | list, save, changeStatus |
| 新增 OWNER: CARDS | 0 | 5 | list, save, changeStatus, takedown, history |
| 新增 OWNER: EVENT_DRAFTS | 0 | 2 | save, get |
| **合计** | **187** | **47** | (P0: 21, P1: 19, P2: 7) |

> 注意: 新增 6 个 owner (ADMIN_ACCOUNTS, COOPERATION_CARDS, CONTRIBUTION, VIDEOS, CARDS, EVENT_DRAFTS) 需要同步更新 `OPERATION_OWNERS` 数组和 `operations/index.js` 聚合。

### 契约已存在、仅需 UI 接入（不新增 action）

| Action | 模块 | 说明 |
|--------|------|------|
| `mip.admin.users.influence.list` | M04/FR-010 | 契约已有，web 接入 |
| `mip.admin.audit.list` | M05/FR-005 | 契约已有，独立页化 |
| `mip.admin.growth.saveLevel` | M06/FR-022 | 契约已有，web 接入 |
| `mip.admin.growth.saveBenefit` | M06/FR-022 | 契约已有，web 接入 |
| `mip.admin.growth.saveRule` | M06/FR-019 | 契约已有，web 接入（Wave 2） |
| `mip.admin.dashboard.overview.get` | M08/FR-034 | 契约已有，web 接入（P2） |

---

## 二、P0 Action 详细定义（21 个）

### TASKS owner 新增（4 个）

| Action | Kind | Method | sessionFirst | Input (required/optional) | webMutation policy |
|--------|------|--------|-------------|---------------------------|-------------------|
| `mip.admin.tasks.submissions.approve` | MUTATION | approveSubmission | true | req: `submissionId` | domainIdempotent: `['submissionId']` |
| `mip.admin.tasks.submissions.reject` | MUTATION | rejectSubmission | true | req: `submissionId` opt: `remark` | domainIdempotent: `['submissionId']` |
| `mip.admin.tasks.submissions.retryReward` | MUTATION | retrySubmissionReward | true | req: `submissionId` | domainIdempotent: `['submissionId']` |
| `mip.admin.tasks.assign` | MUTATION | assignTask | true | req: `taskId, recipients, assignMode` opt: `expectedVersion, weeklyDeliverAt, weeklyStartAt, weeklyEndAt` | domainIdempotent: `['taskId','recipients','assignMode']` |

### EVENTS owner 新增 P0（2 个）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.events.feedbacks.list` | QUERY | listEventFeedbacks | true | req: `eventId` opt: `cursor, limit` | adminWebQueryActions |
| `mip.admin.events.feedbacks.export` | MUTATION | exportEventFeedbacks | true | req: `eventId` | webMutation: `['eventId']` (复用导出四步工作流) |

### USERS owner 新增（3 个）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.users.invitedGuests.list` | QUERY | listInvitedGuests | true | req: `userId` opt: `cursor, limit` | adminWebQueryActions |
| `mip.admin.users.likeRelations.list` | QUERY | listLikeRelations | true | req: `userId` opt: `cursor, limit, direction, eventId, status, sinceTime` | adminWebQueryActions |
| `mip.admin.users.operationLogs.list` | QUERY | listUserOperationLogs | true | req: `userId` opt: `cursor, limit` | adminWebQueryActions |

### ADMIN_ACCOUNTS owner 新增（5 个，新 owner）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.adminAccounts.list` | QUERY | listAdminAccounts | true | opt: `cursor, limit, roleKey, branchId, status, keyword` | adminWebQueryActions |
| `mip.admin.adminAccounts.create` | MUTATION | createAdminAccount | true | req: `name, loginAccount, phone, roleKey` opt: `branchId` | domainIdempotent: `['name','loginAccount','phone']` |
| `mip.admin.adminAccounts.update` | MUTATION | updateAdminAccount | true | req: `accountId, expectedVersion` opt: `name, phone, roleKey, branchId` | webMutation: `['accountId','expectedVersion']` |
| `mip.admin.adminAccounts.changeStatus` | MUTATION | changeAdminAccountStatus | true | req: `accountId, expectedVersion, status` opt: `reason` | webMutation: `['accountId','expectedVersion','status']` |
| `mip.admin.adminAccounts.resetCredential` | MUTATION | resetAdminCredential | true | req: `accountId` opt: `reason` | domainIdempotent: `['accountId']` |

### COOPERATION_CARDS owner 新增（2 个，新 owner）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.cooperationCards.get` | QUERY | getCooperationCard | true | req: `userId` | adminWebQueryActions |
| `mip.admin.cooperationCards.save` | MUTATION | saveCooperationCard | true | req: `userId, cardType, expectedVersion` opt: `realName, gameName, cardSummary, targetSummary, referralNeeded, quirks, rootCause, prevention, cooperationValue, abilityScores, menuFields, status` | domainIdempotent: `['userId','cardType']` |

### MEMBERSHIPS owner 新增（2 个）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.entitlements.transactions.list` | QUERY | listEntitlementTransactions | true | opt: `cursor, limit, keyword, entitlementType, sinceTime` | adminWebQueryActions |
| `mip.admin.entitlements.grant` | MUTATION | grantEntitlement | true | req: `userId, entitlementType` opt: `amount, months` | domainIdempotent: `['userId','entitlementType']` |

### CONTRIBUTION owner 新增 P0（4 个，新 owner）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.contribution.rules.list` | QUERY | listContributionRules | true | opt: `cursor, limit, behavior, status` | adminWebQueryActions |
| `mip.admin.contribution.rules.save` | MUTATION | saveContributionRule | true | req: `behavior, rewardExp, rewardLimit, scopeServers, effectiveFrom, status` opt: `ruleId, expectedVersion, effectiveTo` | domainIdempotent: `['behavior','rewardExp','scopeServers']` |
| `mip.admin.contribution.transactions.list` | QUERY | listContributionTransactions | true | opt: `cursor, limit, userId, behavior, serverId, sinceTime` | adminWebQueryActions |
| `mip.admin.contribution.transactions.reverse` | MUTATION | reverseContribution | true | req: `originalTransactionNo, reversalValue, reason` | domainIdempotent: `['originalTransactionNo','reversalValue']` |

### GROWTH owner 新增 P0（3 个）

| Action | Kind | Method | sessionFirst | Input | webMutation policy |
|--------|------|--------|-------------|-------|-------------------|
| `mip.admin.growth.levels.changeStatus` | MUTATION | changeLevelStatus | true | req: `levelId, expectedVersion, status` | webMutation: `['levelId','expectedVersion','status']` |
| `mip.admin.growth.benefits.changeStatus` | MUTATION | changeBenefitStatus | true | req: `benefitId, expectedVersion, status` | webMutation: `['benefitId','expectedVersion','status']` |
| `mip.admin.growth.levelTransitions.list` | QUERY | listLevelTransitions | true | opt: `cursor, limit, serverId, sinceTime` | adminWebQueryActions |

---

## 三、P1 Action 详细定义（19 个）

### EVENTS owner 新增 P1（5 个）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.events.checkinQrcode.get` | QUERY | getCheckinQrcode | req: `eventId` | adminWebQueryActions |
| `mip.admin.events.participants.import` | MUTATION | importParticipant | req: `eventId, userId` opt: `roleMark, reason` | domainIdempotent: `['eventId','userId']` |
| `mip.admin.events.participants.cancel` | MUTATION | cancelParticipant | req: `eventId, registrationId, expectedVersion, reason` | webMutation: `['eventId','registrationId','expectedVersion']` |
| `mip.admin.events.participants.markAbnormal` | MUTATION | markAbnormalParticipant | req: `eventId, registrationId, expectedVersion, reason` | webMutation: `['eventId','registrationId','expectedVersion']` |
| `mip.admin.events.hearts.list` | QUERY | listEventHearts | req: `eventId` opt: `cursor, limit` | adminWebQueryActions |

### OPPORTUNITIES owner 新增（3 个）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.opportunities.operationLogs` | QUERY | listOpportunityOperationLogs | req: `opportunityId` opt: `cursor, limit` | adminWebQueryActions |
| `mip.admin.opportunities.delete` | MUTATION | deleteOpportunity | req: `opportunityId, expectedVersion, reason` | webMutation: `['opportunityId','expectedVersion']` |
| `mip.admin.opportunities.referrals` | QUERY | listOpportunityReferrals | req: `opportunityId` opt: `cursor, limit` | adminWebQueryActions |

### VIDEOS owner 新增（3 个，新 owner）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.videos.list` | QUERY | listVideos | opt: `cursor, limit, status` | adminWebQueryActions |
| `mip.admin.videos.save` | MUTATION | saveVideo | req: `coverAssetId, jumpUrl, title` opt: `videoId, expectedVersion, status` | domainIdempotent: `['coverAssetId','jumpUrl','title']` |
| `mip.admin.videos.changeStatus` | MUTATION | changeVideoStatus | req: `videoId, expectedVersion, status` | webMutation: `['videoId','expectedVersion','status']` |

> 注意: `mip_event_video_recaps` 表已存在（迁移 045），但它绑定 event_id 且字段结构不同（destination_provider/finder_user_name/feed_id）。PRD 的视频回顾模块是独立管理（不绑活动），需新建表。

### CARDS owner 新增（5 个，新 owner）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.cards.list` | QUERY | listCards | opt: `cursor, limit, userId, status` | adminWebQueryActions |
| `mip.admin.cards.save` | MUTATION | saveCard | req: `cardType, fields` opt: `cardId, expectedVersion` | domainIdempotent: `['cardType']` |
| `mip.admin.cards.changeStatus` | MUTATION | changeCardStatus | req: `cardId, expectedVersion, status` | webMutation: `['cardId','expectedVersion','status']` |
| `mip.admin.cards.takedown` | MUTATION | takedownCard | req: `cardId, reason` | domainIdempotent: `['cardId','reason']` |
| `mip.admin.cards.history` | QUERY | listCardHistory | req: `cardId` opt: `cursor, limit` | adminWebQueryActions |

### EVENT_DRAFTS owner 新增（2 个，新 owner）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.events.drafts.save` | MUTATION | saveEventDraft | req: `draftData` opt: `eventId, draftId` | domainIdempotent: `['draftData']` |
| `mip.admin.events.drafts.get` | QUERY | getEventDraft | opt: `eventId, draftId` | adminWebQueryActions |

### ORDERS owner 新增（1 个）

| Action | Kind | Method | Input | webMutation policy |
|--------|------|--------|-------|-------------------|
| `mip.admin.refunds.list` | QUERY | listRefunds | opt: `cursor, limit, orderNo, status, sinceTime` | adminWebQueryActions |

> 注意: `mip_refunds` 表已存在（迁移 004），字段: status(PENDING/PROCESSING/SUCCEEDED/FAILED/CANCELLED), amount_cents, reason, refunded_at, last_error_code。无需新建表，仅需查询 action + 可能追加 `applied_at` 列。

---

## 四、P2 Action 详细定义（7 个，Wave 2）

### ADMIN_ACCOUNTS owner 新增 P2（3 个）

| Action | Kind | Method | Input |
|--------|------|--------|-------|
| `mip.admin.adminAccounts.loginRecords` | QUERY | listLoginRecords | opt: `cursor, limit, loginAccount, result, sinceTime` |
| `mip.admin.adminAccounts.passwordLogin` | MUTATION | passwordLogin | req: `phone, password` |
| `mip.admin.roles.list` | QUERY | listRoles | opt: `cursor, limit, status` |

> Wave 2 还需 roles.create/update/copy/changeStatus/get（6 个），总计 P2 为 9 个。但这些依赖阶段 1 完成后再定义，本计划仅声明 P0+P1。

### GROWTH owner 新增 P2（2 个）

| Action | Kind | Method | Input |
|--------|------|--------|-------|
| `mip.admin.growth.rules.changeStatus` | MUTATION | changeRuleStatus | req: `ruleId, expectedVersion, status` |
| `mip.admin.exp.transactions.reverse` | MUTATION | reverseExpTransaction | req: `originalTransactionNo, reversalValue, reason` |

---

## 五、数据库迁移计划

### 现有表结构核对结果

| 表 | 已存在? | 现状关键差距 | 操作 |
|----|---------|------------|------|
| `mip_cooperation_cards` | ✅ 003+018 | 有 `role_key`(connector等6值) + `ability_scores_json` + `role_fields_json`；缺 `card_type` / `menu_fields_json` / `quirks` / `root_cause` / `prevention` / `cooperation_value` | ALTER 追加列 + 数据迁移 role_key→card_type |
| `mip_super_cases` | ✅ 003+018 | 缺 `one_line_summary` / `region_tag_id` / `content_version` / `modified_by_user_id`；status 无 `TAKEN_DOWN` | ALTER 追加列 + status CHECK 扩展 |
| `mip_event_feedback` | ✅ 002+060 | 有 `rating` + `body` + `answers_json`；PRD 结构化问卷字段未持久化 | 无需 ALTER，用 `answers_json` 承载 |
| `mip_event_hearts` | ✅ 002+044 | 有 `voter_user_id` / `target_user_id` / `status`(ACTIVE/CANCELLED) / `event_id`；无 `direction` 列（方向由 voter→target 隐含） | 无需 ALTER，查询层推导方向 |
| `mip_audit_logs` | ✅ 001 | 有 `action` / `resource_type` / `metadata_json`；缺 `module` / `operation_type` / `before_json` / `after_json` / `reason` 独立列 | 无需 ALTER，用 `metadata_json` 承载 before/after/reason；`resource_type` 作 module，`action` 作 operation_type |
| `mip_refunds` | ✅ 004 | 有 `status` / `amount_cents` / `reason` / `refunded_at` / `last_error_code`；无 `applied_at` | 无需 ALTER，`created_at` 作 applied_at，`refunded_at` 作 complete_time |
| `mip_task_cards` | ✅ 024+027 | 缺 `star_level` / `purpose` / `completion_criteria` / `period_start_at` / `weekly_deliver_at` / `assigned_owner_id` / `reward_config_json` | ALTER 追加列 |
| `mip_task_completions` | ✅ 024 | 缺 `submission_status` / `review_remark` / `reviewed_by_user_id` / `reward_result_json` / `retry_log_json` | ALTER 追加列 |
| `mip_task_assignments` | ✅ 027 | 有 `task_id` / `user_id` / `assigned_by_user_id`；缺 `assign_mode` / `recipients_json` / `weekly_deliver_at` / `weekly_start_at` / `weekly_end_at` / `task_version` | ALTER 追加列 |
| `mip_growth_entries` | ✅ 005+015+032 | 有 `metric`(EXP/CONTRIBUTION/COIN) / `delta_value` / `balance_after` / `adjustment_reason`；缺 `reversal_of_entry_id` | ALTER 追加列 |
| `mip_growth_rules` | ✅ 005+051 | 有 `metric` / `delta_value` / `daily_limit_value` / `source_event_type` / `scope_type` / `effective_from/to`；缺 `audit_mode` / `rule_version` | ALTER 追加列 |
| `mip_profiles` | ✅ 001+053+055 | 缺 `city_name` / `industry` / `career_role` / `company` / `position` / `one_line_introduction` | ALTER 追加列 |
| `mip_event_tags` | ✅ 045 | 完整 CRUD 表已有，有 `tag_key` / `name` / `status` / `created_by_user_id` | 无需 ALTER |
| `mip_event_video_recaps` | ✅ 045 | 绑定 event_id，字段不匹配 PRD 独立视频模块 | 新建独立表 |
| `mip_role_capability_policies` | ✅ 033 | 角色是枚举 CHECK，非独立表；无 `mip_admin_accounts` 表 | 新建表 |
| `mip_admin_role_bindings` | ✅ 001 | 有 `user_id` / `role_key` / `scope_type` / `scope_id` | 无需 ALTER |

### 迁移文件编号分配

下一个迁移编号: **061**。按模块和优先级分配:

| 迁移文件 | 优先级 | 模块 | 操作 | 说明 |
|---------|--------|------|------|------|
| `061_task_system_extensions.sql` | P0 | M02 | ALTER | mip_task_cards 追加 star_level/purpose/completion_criteria/period_start_at/weekly_deliver_at/assigned_owner_id/reward_config_json/attachment_template_asset_id |
| `061_rollback.sql` | | | | DROP COLUMN (rollback 允许) |
| `062_task_submission_workflow.sql` | P0 | M02 | ALTER+CREATE | mip_task_completions 追加 submission_status/review_remark/reviewed_by_user_id/reward_result_json/retry_log_json；CREATE mip_task_submission_reviews (审批记录表) |
| `063_task_assignment_enhancements.sql` | P0 | M02 | ALTER | mip_task_assignments 追加 assign_mode/recipients_json/weekly_deliver_at/weekly_start_at/weekly_end_at/task_version |
| `064_cooperation_card_restructure.sql` | P0 | M04 | ALTER | mip_cooperation_cards 追加 card_type/menu_fields_json/quirks/root_cause/prevention/cooperation_value + 数据迁移 role_key→card_type 映射 |
| `065_super_case_extensions.sql` | P0 | M04 | ALTER | mip_super_cases 追加 one_line_summary/region_tag_id/content_version/modified_by_user_id + status CHECK 扩展 TAKEN_DOWN |
| `066_profile_career_fields.sql` | P0 | M04 | ALTER | mip_profiles 追加 city_name/industry/career_role/company/position/one_line_introduction |
| `067_user_operation_logs.sql` | P0 | M04 | CREATE | CREATE mip_user_operation_logs (user_id/operator_id/action_type/summary/created_at) |
| `068_admin_accounts.sql` | P0 | M05 | CREATE | CREATE mip_admin_accounts (account_id/name/login_account/phone/role_key/branch_id/status/created_by/.../version) |
| `069_entitlement_transactions.sql` | P0 | M06 | CREATE | CREATE mip_entitlement_transactions (entitlement_no/user_id/entitlement_type/entitlement_content/related_order_no/grantor/granted_at/source) |
| `070_contribution_management.sql` | P0 | M06 | CREATE | CREATE mip_contribution_rules + mip_contribution_transactions + mip_contribution_reversals |
| `071_growth_reversal_support.sql` | P0 | M06 | ALTER | mip_growth_entries 追加 reversal_of_entry_id；mip_growth_rules 追加 audit_mode/rule_version |
| `072_event_feedback_export.sql` | P0 | M03 | 无DDL | 反馈数据已在 mip_event_feedback.answers_json，仅需 action 层查询，无新表 |
| `073_videos.sql` | P1 | M08 | CREATE | CREATE mip_videos (video_id/cover_asset_id/jump_url/title/status/sort_order/...) |
| `074_cards_management.sql` | P1 | M08 | CREATE | CREATE mip_business_cards + mip_card_templates + mip_card_history |
| `075_event_drafts.sql` | P1 | M08 | CREATE | CREATE mip_event_drafts (draft_id/event_id/operator_id/draft_data_json/updated_at) |
| `076_opportunity_operation_logs.sql` | P1 | M07 | CREATE | CREATE mip_opportunity_operation_logs + mip_opportunity_delete_snapshots |
| `077_opportunity_referrals.sql` | P1 | M07 | CREATE | CREATE mip_opportunity_referral_records (如 mip_referral_intents 不满足则新建) |
| `078_exp_reversal.sql` | P2 | M06 | CREATE | CREATE mip_exp_reversals (Wave 2) |
| `079_admin_login_records.sql` | P2 | M05 | CREATE | CREATE mip_admin_login_records + mip_admin_account_credentials (Wave 2) |
| `080_admin_roles.sql` | P2 | M05 | CREATE | CREATE mip_admin_roles (Wave 2) |

### 迁移约束

- 前向迁移禁止: DROP TABLE / DROP COLUMN / DELETE / TRUNCATE / RENAME
- 合作卡 `role_key→card_type` 数据迁移: 在 ALTER 追加 `card_type` 列后，用 UPDATE 语句映射现有数据（UPDATE 在前向迁移中允许，但需声明 `altersTables`）
- 每个迁移文件需在 `migrations.lock.json` 追加条目: `{ version, name, sql, rollback, sqlSha256, rollbackSha256, createsTables, altersTables }`
- version 格式: 14 位时间戳，按顺序递增

---

## 六、实施步骤

### Step 1: 新增 owner 注册（cloudfunctions 层）

1. 在 `operation-registry.js` 的 `OPERATION_OWNERS` 数组追加 6 个新 owner
2. 在 `operations/index.js` 聚合数组追加 6 个新 manifest require
3. 创建 6 个新 manifest 文件: `operations/admin-accounts.js`, `operations/cooperation-cards.js`, `operations/contribution.js`, `operations/videos.js`, `operations/cards.js`, `operations/event-drafts.js`

### Step 2: 声明 action（owner manifest 层）

1. 在现有 owner manifest（tasks.js, events.js, users.js, opportunities.js, growth.js, memberships.js, orders.js）追加新 action
2. 在 6 个新 manifest 文件中声明各自 action
3. 更新 `EXPECTED_OPERATION_COUNT` 从 187 → 234 (187+47)

### Step 3: 实现 handler stub（service 层）

1. 在 `domain/service.js` 的 `ownerModules` 追加 6 个新 owner 模块
2. 创建 6 个新 domain 文件: `domain/admin-accounts.js`, `domain/cooperation-cards.js`, `domain/contribution.js`, `domain/videos.js`, `domain/cards.js`, `domain/event-drafts.js`
3. 在现有 domain 文件（tasks.js, events.js 等）追加 handler 方法
4. **本期 handler 先返回 stub**（空数据 / NotImplementedError），让契约和前端可以并行开发；服务端真实实现按模块逐步替换

### Step 4: 声明 web mutation policy（public-operation-contract 层）

1. 在 `adminWebMutationPolicies` 数组追加所有新 MUTATION action 的 policy
2. 在 `adminWebQueryActions` 数组追加所有新 QUERY action

### Step 5: 生成 TS artifact

```bash
node scripts/generate-admin-operation-contract.mjs --write
```

### Step 6: 更新测试计数

1. `operation-registry.js`: `EXPECTED_OPERATION_COUNT` → 234
2. `tests/mip-admin-contract-matrix.test.ts`: 断言 count → 234
3. `cloudfunctions/mip-admin-api/tests/service.test.js`: 确认新 handler 方法存在

### Step 7: 编写迁移 SQL

1. 按编号 061-080 编写前向迁移 SQL
2. 编写对应 rollback SQL
3. 更新 `migrations.lock.json` 追加所有条目
4. 运行 `node scripts/apply-mip-schema.mjs --dry-run` 验证

### Step 8: 验证

```bash
pnpm verify          # 小程序 + CloudBase 契约测试
pnpm admin:web:verify # Web 类型检查 + 契约测试 + 构建
pnpm verify:all       # 全量
```

---

## 七、关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 活动反馈 | 用 `answers_json` 承载，不新增列 | 迁移 060 已加 `answers_json`，PRD 问卷字段是结构化 JSON，无需独立列 |
| 心动关系方向 | 查询层推导，不加 `direction` 列 | voter→target 隐含方向，加列是冗余 |
| 审计日志 before/after/reason | 用 `metadata_json` 承载，不加列 | 现有 `metadata_json` JSON 足够，加列破坏现有表结构 |
| 退款记录 | 复用 `mip_refunds` 表，不加列 | `created_at` 作 applied_at，`refunded_at` 作 complete_time，`last_error_code` 作 fail_reason |
| 视频回顾 | 新建 `mip_videos` 表，不复用 `mip_event_video_recaps` | 现有表绑定 event_id 且字段不匹配 PRD 独立视频管理 |
| 后台账号 | 新建 `mip_admin_accounts` 表 | 现有 `mip_admin_role_bindings` 是用户→角色绑定，不是独立账号管理 |
| 合作卡迁移 | ALTER 追加 `card_type` + UPDATE 映射 | 保留 `role_key` 兼容，新增 `card_type` 枚举(PIMP/BUSINESS/RICH/PLANNER/DESIGNER/NANNY) |
| handler 策略 | 先 stub 后实现 | 解除前端并行阻塞，服务端按模块逐步替换 stub |
| 新增 owner | 6 个独立 owner | ADMIN_ACCOUNTS/COOPERATION_CARDS/CONTRIBUTION/VIDEOS/CARDS/EVENT_DRAFTS 各自领域独立 |

---

## 八、已确认决策

- [x] `mip_referral_intents` 表可复用为机会想推荐名单 — 表有 opportunity_id + actor_user_id + created_at，字段名映射 actor_user_id→user_id
- [x] 合作卡 `role_key→card_type` 映射确认: connector→PIMP, business_builder→BUSINESS, capital_operator→RICH, strategist→PLANNER, visual_designer→DESIGNER, delivery_lead→NANNY — 数据库存 snake_case 英文 key，应用层做 key↔短码转换
- [x] `mip_event_video_recaps` 保留（活动绑定的视频回顾），新建独立 `mip_videos` 表 — 两者语义不同，不强合并
- [x] P2 Wave 2 的 roles CRUD（6 个 action）等阶段 2 再追加
- [x] 机会可见范围：新增 visibility 字段（PLATFORM_PUBLIC/MIP_INTERNAL），与 scopeType 独立
- [x] 机会删除：用 archive 软删除，扩展支持非 DRAFT 状态，不做物理删除
- [x] 贡献值是经验值的来源分类 — 不新建独立贡献值表，用 growth_entries.metric=CONTRIBUTION 标记来源
- [x] 消息失败重试：新增 mip.admin.messageCampaigns.retry action（单条手动重试）
- [x] roles.candidates 不复用为机会发布人搜索（权限模型不匹配），新增独立搜索 action
