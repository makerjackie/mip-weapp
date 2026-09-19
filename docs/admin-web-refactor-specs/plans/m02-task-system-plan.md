# M02 任务体系实现计划（P0 / Wave 1）

> 内部链路：FR-002（任务配置增强）→ FR-001（任务审批流程）→ FR-003（每周任务指派）
> FR-002 先做，FR-001 依赖 FR-002 扩展后的字段，FR-003 依赖 FR-002 的周期字段与指派能力。
> 本文件只覆盖 admin-web / 小程序 modules 层与云函数契约的代码级改动，不含数据库迁移脚本正文（见第 5 节列名清单，由迁移计划单独落实）。

---

## 1. 目标和范围

| FR | 目标 | 依赖 |
| --- | --- | --- |
| FR-002 | 任务卡可配置星级、用途、完成标准、周期、周送达时间、指派负责人、奖励配置；表单字段进入 `createTaskMutationDefinition` 的 save 字段集 | 无 |
| FR-001 | 任务完成记录（submission）可走审批：approve / reject / retryReward；详情页展示审批状态与审批记录 | FR-002（reward_config_json、completion_criteria 作为审批判断依据） |
| FR-003 | 任务可按周指派：assign 动作、指派模式（手动/周期）、收件人列表、周送达时间；行级“提派任务”入口 | FR-002（period_start_at / weekly_deliver_at / assigned_owner_id） |

不在本计划范围：
- 数据库迁移脚本正文（仅列列名，由 `database/mysql` 迁移计划落地）
- 奖励实际发放链路（ledger 侧，由支付/权益模块另行实现）
- 小程序端用户任务卡片 UI（由 weapp 页面计划落地）

---

## 2. 实现步骤（按 FR 顺序）

### 步骤 A — FR-002 任务配置增强

A1. 在 `admin-task-management.ts` 的 `createTaskMutationDefinition`（L303-369）save 字段集中追加 8 个字段：
- `starLevel`（integer，1-5）
- `purpose`（textarea）
- `completionCriteria`（textarea）
- `periodStartAt` / `periodEndAt`（datetime）
- `weeklyDeliverAt`（datetime，仅当任务为周期型时必填）
- `assignedOwner`（select，候选来自 `loadTaskDetail` 中已有的 assignable members 逻辑，复用 `eligibleLevels` 拉取后的成员集合）
- `rewardConfig`（group，内嵌 `rewardExperience` + 未来扩展字段；保留 `rewardExperience` 顶层字段以兼容旧契约）

A2. 在 `buildTaskMutationInput`（L371-416）中为上述字段补充校验与序列化：
- `starLevel`：1-5 整数，否则抛 `ValidationError`
- `periodStartAt <= periodEndAt`
- `weeklyDeliverAt` 当 `assignmentMode` 为周期型时必填
- `rewardConfig` 序列化为 `reward_config_json` 字符串

A3. 在 `ADMIN_TASK_MUTATION_ACTIONS`（L23-30）中追加 `assign` 动作：
- key: `assign`，label: `提派任务`，mutation: `mip.admin.tasks.assign`
- 该动作进入 `taskActions` 集合（operation-model.ts L143-151 已自动注册），capability 仍为 `tasks.manage`

A4. 在 `loadTaskDetail`（L143-272）返回的 detail sections 中：
- “任务信息” section 追加展示：星级 / 用途 / 完成标准 / 周期 / 周送达时间 / 指派负责人 / 奖励配置
- 不新增 section，仅扩展现有 “任务信息” 的字段列表

A5. 云函数契约侧（`packages/admin-contracts`）：
- `AdminRequest` v1 的 task save payload 类型追加上述 8 字段
- 新增 `mip.admin.tasks.assign` 的 request/response 类型

### 步骤 B — FR-001 任务审批流程

B1. 在 `admin-task-management.ts` 顶部 `ADMIN_TASK_MUTATION_ACTIONS`（L23-30）追加 3 个 submission 动作：
- `approveSubmission` → `mip.admin.tasks.submissions.approve`
- `rejectSubmission` → `mip.admin.tasks.submissions.reject`
- `retrySubmissionReward` → `mip.admin.tasks.submissions.retryReward`

B2. 在 `operation-model.ts`：
- `operationCapability`（L96 附近）为这 3 个动作返回新 capability `tasks.review`（而非 `tasks.manage`），使审批权限与配置权限分离
- `BASIC_OPERATION_ACTIONS`（L46-53）无需改动（task 动作走 `ADMIN_TASK_MUTATION_ACTIONS` 通道，L143-151 自动注册）

B3. 在 `admin-details.ts`（928 行）：
- `AdminDetailRoute` union 追加 `'taskApprovals'`
- `loadAdminDetail` dispatch 追加 `route === 'taskApprovals' → loadTaskApprovalDetail`（新函数，见第 3 节新建文件）
- 已有 `route === 'taskCompletions' → loadTaskCompletionDetail` 保持不变，但 `loadTaskCompletionDetail` 返回值追加审批状态字段展示

B4. 在 `admin-row-operations.ts`（315 行）：
- 新增 `taskCompletionRowActions()` 函数，参照 `eventRegistrationRowActions` 模式
- 为 `taskCompletions` 行返回 3 个 action：`approve` / `reject` / `retryReward`
- 加入 `AdminRowOperationAction` union（L1-36）

B5. 在 `admin-detail-actions.tsx`（225 行）：
- Task 分支（L77-106）保持现有 7 个按钮
- 新增 `taskCompletions` / `taskApprovals` 分支：审批 / 退回 / 重试奖励 按钮
- 新增 `提派任务` 按钮（对应 A3 的 `assign` 动作，挂在 task 行而非 completion 行）

B6. 云函数侧（`mip-admin-api`）：
- 新增 submission 状态机：`pending → approved | rejected`，`approved → retrying → approved`
- 写入 `mip_task_submission_reviews` 表（reviewer、remark、result、created_at）

### 步骤 C — FR-003 每周任务指派

C1. `assign` 动作的 mutation 定义（A3 已注册 key），在 `createTaskMutationDefinition` 之外新建 `createTaskAssignmentMutationDefinition`（见第 3 节），字段：
- `assignMode`：`manual` | `weekly`
- `recipients`：multi-select（成员候选）
- `weeklyDeliverAt` / `weeklyStartAt` / `weeklyEndAt`（当 `assignMode=weekly` 时必填）
- `taskVersion`（只读，取当前 task 版本快照）

C2. `loadTaskDetail`（L143-272）追加 “指派计划” section，展示当前 assign_mode、收件人、周送达时间。

C3. `loadTaskManagementPage`（L86-126）并行拉取追加 `tasks.assignments.list`，用于管理页展示指派状态列。

C4. 云函数侧 `mip.admin.tasks.assign`：
- 写入 `mip_task_assignments` 表
- `weekly` 模式由通知 worker（无定时器，见 AGENTS.md §8）在自然触发时派发

---

## 3. 新建文件列表

| 文件 | 用途 |
| --- | --- |
| `admin-web/src/.../admin-task-approval-detail.ts` | `loadTaskApprovalDetail`：拉取单条 submission + 关联 task + review 记录，组装 detail sections（提交内容 / 任务要求 / 审批记录 / 奖励结果） |
| `admin-web/src/.../admin-task-assignment-mutation.ts` | `createTaskAssignmentMutationDefinition` + `buildTaskAssignmentInput`：assign 动作的字段定义与序列化 |
| `cloudfunctions/mip-admin-api/src/tasks/submissions.ts` | approve / reject / retryReward 的服务端处理，写 `mip_task_submission_reviews` |
| `cloudfunctions/mip-admin-api/src/tasks/assignments.ts` | assign 的服务端处理，写 `mip_task_assignments` |
| `packages/admin-contracts/src/requests/task-submissions.ts` | 3 个 submission 动作的 request/response 类型 |
| `packages/admin-contracts/src/requests/task-assignments.ts` | assign 动作的 request/response 类型 |

> 具体目录路径以 `admin-web/src/operations/adapters/` 与 `cloudfunctions/mip-admin-api/src/tasks/` 现有结构为准，实现时对齐 `admin-task-management.ts` 所在目录。

---

## 4. 修改文件列表

### 4.1 `admin-task-management.ts`（604 行）

| 位置 | 改动 |
| --- | --- |
| L23-30 `ADMIN_TASK_MUTATION_ACTIONS` | 追加 `assign` / `approveSubmission` / `rejectSubmission` / `retrySubmissionReward` 共 4 个 action |
| L67-73 `taskStatusLabels` | 若 submission 引入新状态，补充 `submissionStatusLabels` 映射（pending/approved/rejected/retrying） |
| L86-126 `loadTaskManagementPage` | 并行拉取追加 `tasks.assignments.list`；列表列追加指派状态 |
| L143-272 `loadTaskDetail` | “任务信息” section 追加 8 个字段展示；新增 “指派计划” section |
| L303-369 `createTaskMutationDefinition` | save 字段集追加 `starLevel` / `purpose` / `completionCriteria` / `periodStartAt` / `periodEndAt` / `weeklyDeliverAt` / `assignedOwner` / `rewardConfig` |
| L371-416 `buildTaskMutationInput` | 追加校验与序列化（见步骤 A2） |

### 4.2 `operation-model.ts`（588 行）

| 位置 | 改动 |
| --- | --- |
| L46-53 `BASIC_OPERATION_ACTIONS` | 无需改动（task 动作走 `ADMIN_TASK_MUTATION_ACTIONS`） |
| L96 `operationCapability` | 3 个 submission 动作返回 `tasks.review`；`assign` 返回 `tasks.manage` |
| L143-151 task 处理 | 新动作自动注册，无需改逻辑；确认 `taskActions` set 包含新 key |

### 4.3 `admin-details.ts`（928 行）

| 位置 | 改动 |
| --- | --- |
| `AdminDetailRoute` union | 追加 `'taskApprovals'` |
| `loadAdminDetail` dispatch | 追加 `route === 'taskApprovals' → loadTaskApprovalDetail` |
| `loadTaskCompletionDetail` | 返回值追加 `submissionStatus` / `reviewRemark` / `rewardResult` 展示字段 |

### 4.4 `admin-row-operations.ts`（315 行）

| 位置 | 改动 |
| --- | --- |
| L1-36 `AdminRowOperationAction` union | 追加 `taskCompletion.approve` / `taskCompletion.reject` / `taskCompletion.retryReward` |
| 新函数 `taskCompletionRowActions()` | 参照 `eventRegistrationRowActions` 模式，按 completion 状态返回可用 action（pending 才能 approve/reject；approved 才能 retryReward） |

### 4.5 `admin-detail-actions.tsx`（225 行）

| 位置 | 改动 |
| --- | --- |
| L77-106 Task 分支 | 追加 “提派任务” 按钮（assign 动作） |
| 新增 `taskCompletions` / `taskApprovals` 分支 | 审批 / 退回 / 重试奖励 按钮，按行状态启用/禁用 |

### 4.6 `admin-operation-ui.ts`（117 行）

无需改动。`OperationField` 已支持 group / select / multi-select / datetime / integer，M02 新字段复用现有 kind。`mutation-dialog.tsx`（116 行）同样无需改动。

### 4.7 `task-management-page.tsx`（26 行）/ `task-edit-form-page.tsx`（51 行）

无需改动。`task-edit-form-page` 通过 `createTaskMutationDefinition` 自动渲染新字段；新字段进入 save 定义后表单自动生效。

### 4.8 `packages/admin-contracts`

| 文件 | 改动 |
| --- | --- |
| 现有 task save request 类型 | 追加 8 字段 |
| 新增 `task-submissions.ts` / `task-assignments.ts` | 见第 3 节 |

---

## 5. 数据模型变更（列名清单，迁移脚本由迁移计划落地）

### 5.1 `mip_task_cards`（ALTER ADD）
- `star_level` TINYINT
- `purpose` VARCHAR(255)
- `completion_criteria` TEXT
- `period_start_at` DATETIME
- `period_end_at` DATETIME
- `weekly_deliver_at` DATETIME
- `assigned_owner_id` VARCHAR(64)
- `reward_config_json` JSON

### 5.2 `mip_task_completions`（ALTER ADD）
- `submission_status` VARCHAR(16) — pending/approved/rejected/retrying
- `review_remark` TEXT
- `reviewed_by_user_id` VARCHAR(64)
- `reward_result_json` JSON
- `retry_log_json` JSON

### 5.3 `mip_task_assignments`（ALTER ADD）
- `assign_mode` VARCHAR(16) — manual/weekly
- `recipients_json` JSON
- `weekly_deliver_at` DATETIME
- `weekly_start_at` DATETIME
- `weekly_end_at` DATETIME
- `task_version` INT

### 5.4 新表 `mip_task_submission_reviews`
- `id` VARCHAR(64) PK
- `submission_id` VARCHAR(64) FK → mip_task_completions.id
- `reviewer_user_id` VARCHAR(64)
- `action` VARCHAR(16) — approve/reject/retry
- `remark` TEXT
- `reward_result_json` JSON
- `created_at` DATETIME

> 所有表变更必须以追加迁移形式提交（AGENTS.md §领域额外规则）。

---

## 6. 测试要点

### 6.1 合同测试（AGENTS.md §11 排查规则）
- `createTaskMutationDefinition` save 后，必须验证服务端返回的真实字段结构映射到 detail sections，不能只验类型声明
- submission approve 后，`loadTaskApprovalDetail` 返回的 `submission_status` 必须从 pending → approved，并写入 `mip_task_submission_reviews` 一条记录
- assign weekly 模式必须验证 `mip_task_assignments` 写入 `weekly_deliver_at` 且 `task_version` 与当前 task 快照一致

### 6.2 行级动作状态机
- `taskCompletionRowActions`：pending 行返回 approve/reject，不返回 retryReward；approved 行返回 retryReward，不返回 approve/reject
- rejected 行无任何审批动作

### 6.3 权限分离
- `tasks.review` 与 `tasks.manage` 分离后，只有审批权限的账号看不到 “编辑/发布/提派任务” 按钮，但能看到 “审批/退回”
- `operationCapability` 单测覆盖 4 个新动作的 capability 返回值

### 6.4 表单校验
- `starLevel` 越界（0 / 6）抛 `ValidationError`
- `periodStartAt > periodEndAt` 抛错
- `weeklyDeliverAt` 在 `assignMode=weekly` 时缺失抛错

### 6.5 列表加载
- `loadTaskManagementPage` 并行拉取 `tasks.assignments.list` 失败时，不得让已成功的 tasks 列表变成整页错误（AGENTS.md §11 受保护页面规则）

---

## 7. 验收检查清单

- [ ] `createTaskMutationDefinition` save 字段集包含 8 个新字段，表单可填写并提交
- [ ] `buildTaskMutationInput` 对 starLevel / period / weeklyDeliverAt 校验生效
- [ ] `ADMIN_TASK_MUTATION_ACTIONS` 包含 assign / approveSubmission / rejectSubmission / retrySubmissionReward
- [ ] `operationCapability` 对 3 个 submission 动作返回 `tasks.review`
- [ ] `AdminDetailRoute` 包含 `'taskApprovals'`，`loadAdminDetail` 正确 dispatch
- [ ] `taskCompletionRowActions` 按 submission 状态返回正确动作集
- [ ] `admin-detail-actions.tsx` 对 task 行显示 “提派任务”，对 completion 行显示审批三按钮
- [ ] `loadTaskDetail` “任务信息” section 展示全部新字段，“指派计划” section 展示 assign 信息
- [ ] `pnpm admin:web:verify` 通过（类型 + 构建 + 单测）
- [ ] `pnpm verify:all` 通过
- [ ] 数据库追加迁移脚本已提交
- [ ] `packages/admin-contracts` 类型更新已提交，两端共用

---

## 8. 实现顺序

1. **FR-002（步骤 A）**：先改 `createTaskMutationDefinition` + `buildTaskMutationInput` + `ADMIN_TASK_MUTATION_ACTIONS.assign` + `loadTaskDetail` 展示 + 契约类型 + DB ALTER `mip_task_cards` / `mip_task_assignments` 基础列。
2. **FR-001（步骤 B）**：依赖 FR-002 的 `reward_config_json` / `completion_criteria`。改 `operationCapability` 分离 `tasks.review` + 新建 `loadTaskApprovalDetail` + `taskCompletionRowActions` + 详情按钮 + DB ALTER `mip_task_completions` + 新表 `mip_task_submission_reviews` + 云函数 submissions。
3. **FR-003（步骤 C）**：依赖 FR-002 的周期字段。新建 `createTaskAssignmentMutationDefinition` + `loadTaskDetail` 指派 section + `loadTaskManagementPage` 拉取 assignments + 云函数 assignments + DB ALTER `mip_task_assignments` 周期列。

每个 FR 完成后独立运行 `pnpm admin:web:verify`；三个 FR 全部完成后运行 `pnpm verify:all`。submission 状态机与 assign 周期派发需真机/生产环境验证（AGENTS.md §领域额外规则）。
