# M02 任务体系

> 来源: [admin-web-prd-refactor-spec.md](../admin-web-prd-refactor-spec.md)
> 模块: M02 任务体系
> Wave: 1（内部链 FR-002 → FR-001 → FR-003）
> FR 覆盖: FR-002 任务配置增强 / FR-001 任务审批流程 / FR-003 每周任务指派
> 现状基线: `admin-web/src/modules/admin-task-management.ts` + `admin-web/src/features/operations-pages/task-management-page.tsx`

## 1. 模块目标

把现状"任务 + 完成记录"的简单模型，升级为 PRD v0.4 要求的完整任务运营闭环：任务配置增强 → 提交审批 → 奖励发放 → 周期指派。8 种任务状态、笨笨老大审批、一次性发放奖励（经验值/贡献值/奖金分别启用）、奖励失败可重试、按用户/角色/服务器/标签派发。

## 2. 现状分析

当前 `admin-task-management.ts` 仅支持：

- `tasks.save` 字段：任务名称 / 任务内容 / 经验奖励 / 分配范围（全部成员或指定成员）/ 截止时间 / 任务模板图片 / 可参与等级 / 是否必须附件
- 完成记录：成员 / 任务内容快照 / 经验奖励 / 结果说明 / 完成时间 / 附件
- 状态：ACTIVE / DRAFT / PUBLISHED / UNPUBLISHED / DELETED
- 完成结果：SUCCESS / FAILED

缺口（对照 PRD）：

- 缺任务星级、任务目的、完成标准、任务周期（开始/结束/每周固定交付时间）、关联笨笨老大、适用服务器
- 缺奖励配置（经验值/贡献值/奖金分别启用）
- 缺附件模板（文件名/格式/大小/上传时间/在线查看/下载）
- 缺 8 种任务审批状态机
- 缺笨笨老大审批权限校验
- 缺审批通过/退回/奖励失败重试
- 缺任务完成流水
- 缺按用户/角色/服务器/标签派发

## 3. 内部依赖链

```
FR-002 任务配置增强（无依赖，最先做）
   ↓ 提供奖励配置（经验值/贡献值/奖金分别启用）和笨笨老大关联
FR-001 任务审批流程（依赖 FR-002 的奖励配置和笨笨老大关联）
   ↓ 审批通过后发放奖励，形成完成流水
FR-003 每周任务指派（依赖 FR-002 的笨笨老大关联）
```

FR-002 必须先完成；FR-001 和 FR-003 在 FR-002 完成后可并行开发，但 FR-003 的派发记录会引用任务版本，建议在 FR-001 状态机落地后再做，避免版本字段二次返工。

## 4. 跨模块依赖

| 方向 | 模块 | FR | 说明 |
|------|------|-----|------|
| 输出 → | M06 成长与权益 | FR-019 经验值规则 | 经验值规则的"完成任务"行为类型依赖本模块 FR-002 的任务奖励类型定义（经验值/贡献值/奖金分别启用），Wave 2 启动前 FR-002 必须完成 |
| 消费 ← | M01 列表筛选增强 | FR-008 | 任务列表和完成流水列表接入方案 B 时间筛选和统一分页 |

## 5. FR-002 任务配置增强

### 5.1 扩展 `tasks.save` 表单字段

在 `createTaskMutationDefinition` 的 `mip.admin.tasks.save` 分支新增字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `starLevel` | select | 是 | 任务星级，枚举 1–5 星 |
| `purpose` | textarea | 是 | 任务目的，≤500 字 |
| `completionCriteria` | textarea | 是 | 完成标准，≤1000 字 |
| `periodStartAt` | datetime | 否 | 任务周期开始时间 |
| `periodEndAt` | datetime | 否 | 任务周期结束时间 |
| `weeklyDeliverAt` | time | 否 | 每周固定交付时间（HH:mm），仅周期任务填 |
| `assignedOwnerId` | select | 是 | 关联笨笨老大（从 `roles.candidates` 或专用笨笨老大列表加载） |
| `applicableServers` | multi-select | 否 | 适用服务器，空表示全部服务器 |

`buildTaskMutationInput` 同步增加对应校验：`starLevel` 必须为 1–5；`assignedOwnerId` 必须为有效账号 ID；`weeklyDeliverAt` 为空或合法 `HH:mm`。

### 5.2 奖励配置（经验值/贡献值/奖金分别启用）

替换现有单一 `rewardExperience` 字段为结构化奖励配置：

```
rewardConfig: {
  experience: { enabled: boolean, amount: number }   // 经验值
  contribution: { enabled: boolean, amount: number } // 贡献值
  bonus: { enabled: boolean, amount: number }         // 奖金（元）
}
```

验收规则：

- 三种类型分别启用或关闭，至少启用一种，否则表单不可提交
- 未启用的类型在审批通过时不产生对应流水
- 经验值和贡献值必须为正整数
- 奖金为非负数字，精度两位小数

### 5.3 附件模板上传

- `tasks.save` 支持上传附件模板（复用素材上传通道 `TASK_TEMPLATE`）
- 任务详情"模板文件"字段扩展展示：文件名 / 格式（contentType）/ 大小（字节，友好展示）/ 上传时间
- 支持在线查看（`validWebMediaUrl` 校验通过后新窗口打开）和下载
- `attachmentRequired` 控制回传附件是否必须上传（现状已有，保留）

### 5.4 验收标准

- [ ] FR-002-A1 `tasks.save` 表单新增任务星级、任务目的、完成标准、任务周期（开始/结束/每周固定交付时间）、关联笨笨老大、适用服务器字段，校验通过后可保存
- [ ] FR-002-A2 奖励配置支持经验值/贡献值/奖金三种类型分别启用或关闭，至少启用一种才可保存
- [ ] FR-002-A3 未启用的奖励类型在审批通过时不产生对应流水
- [ ] FR-002-A4 奖励用任务提交记录做幂等校验，不重复发放
- [ ] FR-002-A5 `attachmentRequired` 控制回传附件是否必须上传，回传时校验
- [ ] FR-002-A6 附件模板支持上传，详情展示文件名/格式/大小/上传时间，支持在线查看和下载
- [ ] FR-002-A7 任务详情"任务信息"区展示全部新增字段，空值显示"—"
- [ ] FR-002-A8 任务列表新增列：任务星级、任务周期、关联笨笨老大、奖励内容（经验值/贡献值/奖金分别展示）
- [ ] FR-002-A9 数据库迁移脚本追加，不修改现有表结构
- [ ] FR-002-A10 `packages/admin-contracts` 的 `tasks.save` input 类型同步更新

## 6. FR-001 任务审批流程

### 6.1 任务审批状态机

8 种任务状态及流转：

```
pending → in_progress → pending_submit → pending_review → approved（发放奖励）
                                              ↘ rejected（退回补充）→ pending_submit
                                              ↘ reward_failed → retry → approved
                       → expired
```

| 状态码 | 中文 | 说明 |
|--------|------|------|
| `pending` | 待开始 | 已派发但成员未开始 |
| `in_progress` | 进行中 | 成员已开始执行 |
| `pending_submit` | 待提交 | 成员可提交（被退回后回到此状态） |
| `pending_review` | 待审批 | 成员提交后进入，等待笨笨老大审批 |
| `approved` | 已通过 | 审批通过并发放奖励 |
| `rejected` | 已退回 | 审批退回，填写备注，保留原提交内容，回到 `pending_submit` |
| `expired` | 已过期 | 超过任务周期结束时间 |
| `reward_failed` | 奖励失败 | 奖励发放失败，记录失败类型和原因，可重试 |

`taskStatusLabels` 和 `resultStatusLabels` 映射需同步扩展，现有 ACTIVE/DRAFT/PUBLISHED 等发布状态保留为任务发布状态，审批状态作为成员任务实例的独立状态字段（建议 `submissionStatus`）。

### 6.2 笨笨老大审批权限校验

- 仅任务 `assignedOwnerId` 关联的笨笨老大可执行审批
- 审批操作前服务端校验当前账号 ID 与 `assignedOwnerId` 一致，或当前账号拥有 `tasks.review.any` 超权 capability
- 权限不足时返回明确错误，前端按钮对无权限账号置灰或不展示

### 6.3 审批通过

- 调用 `mip.admin.tasks.submissions.approve`
- 一次性发放奖励：按 `rewardConfig` 中启用的类型分别发放经验值/贡献值/奖金
- 幂等：用任务提交记录（submissionId）做幂等键，重复调用不重复发放
- 发放成功后状态转为 `approved`
- 发放失败（如经验值服务异常）转为 `reward_failed`，记录失败类型和原因

### 6.4 审批退回

- 调用 `mip.admin.tasks.submissions.reject`
- 必填备注（退回原因），≤500 字
- 不发放任何奖励
- 保留原提交内容（附件、提交说明快照）
- 状态转为 `rejected`，随后回到 `pending_submit` 供成员重新提交

### 6.5 奖励失败重试

- 调用 `mip.admin.tasks.submissions.retryReward`
- 仅笨笨老大或拥有 `tasks.review.any` 的账号可重试
- 重试沿用原 `rewardConfig`，不重新审批
- 重试成功转为 `approved`；重试失败保留 `reward_failed` 并更新失败原因
- 记录每次重试的执行人/时间/结果

### 6.6 任务完成流水展示

完成记录列表（`tasks.completions.list`）字段扩展：

| 字段 | 说明 |
|------|------|
| 玩家 | 昵称 + 用户 ID |
| 任务名 + 星级 | 任务名称 + 星级图标 |
| 笨笨老大 | 关联笨笨老大昵称 |
| 提交时间 | 成员提交时间 |
| 附件 | 附件名/格式/大小/查看链接 |
| 审批结果 | 通过/退回/奖励失败 |
| 实际奖励分项 | 经验值/贡献值/奖金分别展示，未启用的显示"—" |
| 处理结果 | 发放成功/失败原因/重试记录 |

`loadTaskCompletionDetail` 同步扩展，新增审批记录区（审批人/审批时间/备注/重试记录）。

### 6.7 验收标准

- [ ] FR-001-A1 任务提交后自动进入 `pending_review`（待审批）状态
- [ ] FR-001-A2 仅关联的笨笨老大可审批（权限校验），无权限账号审批按钮置灰或不展示
- [ ] FR-001-A3 审批通过：按 `rewardConfig` 启用类型分别发放经验值/贡献值/奖金，幂等不重复发放
- [ ] FR-001-A4 审批退回：必填备注，不发放奖励，保留原提交内容，状态回到 `pending_submit`
- [ ] FR-001-A5 奖励失败：记录失败类型和原因，状态转为 `reward_failed`
- [ ] FR-001-A6 奖励失败支持有权限的重试，重试成功转为 `approved`，重试失败保留 `reward_failed` 并更新原因
- [ ] FR-001-A7 任务完成流水展示全部字段（玩家/任务名+星级/笨笨老大/提交时间/附件/审批结果/实际奖励分项/处理结果）
- [ ] FR-001-A8 任务列表新增字段：任务星级、任务周期、关联笨笨老大、奖励内容分项展示
- [ ] FR-001-A9 审批状态机非法流转被服务端拒绝（如 `approved` 不可再 `reject`）
- [ ] FR-001-A10 新增 action 纳入契约测试，覆盖通过/退回/失败/重试四条路径

## 7. FR-003 每周任务指派

### 7.1 派发权限

- 笨笨老大可派发关联本人的任务
- 拥有 `tasks.assign.any` 的 NPC 账号可派发任意任务
- 每个任务必须关联一个笨笨老大（FR-002 的 `assignedOwnerId` 已保证）
- 笨笨老大的待分配列表仅展示 `assignedOwnerId === 当前账号` 的任务

### 7.2 接收人选择

支持按四种维度选择接收人，可组合：

| 维度 | 数据源 |
|------|--------|
| 用户 | 按用户 ID/昵称搜索选择（复用现有成员候选加载） |
| 角色 | 按角色多选 |
| 服务器 | 按服务器多选 |
| 标签 | 按用户标签多选 |

### 7.3 派发方式

| 方式 | 说明 |
|------|------|
| 单次 | 选定接收人后立即派发一次 |
| 批量 | 一次选择多个接收人批量派发 |
| 每周周期 | 按 `weeklyDeliverAt` 每周自动派发，可设置起止日期 |

### 7.4 派发记录

每次派发记录：

| 字段 | 说明 |
|------|------|
| 派发人 | 操作账号 ID + 昵称 |
| 接收人 | 用户 ID/角色/服务器/标签的解析结果快照 |
| 派发时间 | ISO 时间 |
| 派发方式 | 单次/批量/每周周期 |
| 任务版本 | 派发时的 `task.version`，用于追溯任务配置快照 |

### 7.5 验收标准

- [ ] FR-003-A1 笨笨老大或拥有 `tasks.assign.any` 的 NPC 账号可派发任务
- [ ] FR-003-A2 每个任务必须关联一个笨笨老大，无关联的任务不可派发
- [ ] FR-003-A3 笨笨老大的待分配列表仅展示关联本人的任务
- [ ] FR-003-A4 支持按用户/角色/服务器/标签选择接收人，可组合
- [ ] FR-003-A5 支持单次/批量/每周周期三种派发方式
- [ ] FR-003-A6 每次派发记录派发人/接收人/派发时间/派发方式/任务版本
- [ ] FR-003-A7 每周周期派发按 `weeklyDeliverAt` 触发，可设置起止日期
- [ ] FR-003-A8 派发记录列表支持按派发人/接收人/派发方式/时间筛选

## 8. 数据模型

### 8.1 任务审批状态机

```
pending → in_progress → pending_submit → pending_review → approved（发奖励）
                                              ↘ rejected（退回补充）→ pending_submit
                                              ↘ reward_failed → retry → approved
                       → expired
```

### 8.2 任务配置扩展字段（追加迁移）

```
tasks {
  starLevel: 1-5
  purpose: text(500)
  completionCriteria: text(1000)
  periodStartAt: datetime?
  periodEndAt: datetime?
  weeklyDeliverAt: string?        // "HH:mm"
  assignedOwnerId: string         // 笨笨老大账号 ID
  applicableServers: string[]?    // 服务器 ID 列表
  rewardConfig: {
    experience: { enabled, amount }
    contribution: { enabled, amount }
    bonus: { enabled, amount }
  }
  attachmentTemplate: {
    assetId, fileName, contentType, bytes, uploadedAt, url
  }?
}
```

### 8.3 任务提交记录

```
task_submissions {
  id
  taskId
  taskVersion                       // 提交时的任务版本快照
  memberId                          // 接收人
  submissionStatus                  // pending/in_progress/pending_submit/pending_review/approved/rejected/expired/reward_failed
  attachment { url, fileName, contentType, bytes }
  submittedAt
  reviewRemark                      // 退回备注
  reviewedBy                        // 审批人
  reviewedAt
  rewardResult {
    experience: { granted, amount, error? }
    contribution: { granted, amount, error? }
    bonus: { granted, amount, error? }
  }
  retryLog: [{ retriedBy, retriedAt, result, error }]?
}
```

### 8.4 派发记录

```
task_assignments {
  id
  taskId
  taskVersion
  assignedBy                        // 派发人账号 ID
  recipients {                      // 接收人快照
    userIds, roleIds, serverIds, tagIds
  }
  assignMode                        // single / batch / weekly
  weeklyDeliverAt                   // 周期派发时间（仅 weekly）
  weeklyStartAt, weeklyEndAt        // 周期起止
  assignedAt
}
```

## 9. 新增 API action

| action | 说明 | 输入 | 输出 |
|--------|------|------|------|
| `mip.admin.tasks.submissions.approve` | 审批通过 | `{ submissionId }` | `{ submissionStatus, rewardResult }` |
| `mip.admin.tasks.submissions.reject` | 审批退回 | `{ submissionId, remark }` | `{ submissionStatus }` |
| `mip.admin.tasks.submissions.retryReward` | 奖励失败重试 | `{ submissionId }` | `{ submissionStatus, rewardResult }` |
| `mip.admin.tasks.assign` | 按用户/角色/服务器/标签派发 | `{ taskId, expectedVersion, recipients: { userIds?, roleIds?, serverIds?, tagIds? }, assignMode, weeklyDeliverAt?, weeklyStartAt?, weeklyEndAt? }` | `{ assignmentId, assignedCount }` |

现有 action 调整：

- `mip.admin.tasks.save` input 扩展新增字段（FR-002）
- `mip.admin.tasks.list` / `mip.admin.tasks.get` output 扩展新增字段
- `mip.admin.tasks.completions.list` / `get` output 扩展审批和奖励分项字段
- 现有 `mip.admin.tasks.assignMembers` / `revokeMembers` 保留，`mip.admin.tasks.assign` 作为增强派发入口

所有新增 action 同步更新 `packages/admin-contracts` 的 action 清单和 input/output 类型。

## 10. 实现要点

### 10.1 表单扩展

在 `createTaskMutationDefinition` 的 `mip.admin.tasks.save` 分支追加 FR-002 字段定义；奖励配置用嵌套 OperationField 或自定义表单组件实现三类型分别启停。`buildTaskMutationInput` 同步追加校验。

### 10.2 审批操作入口

任务完成详情（`loadTaskCompletionDetail`）新增审批操作区：

- 待审批状态：展示"通过""退回"按钮，退回弹出备注输入
- 奖励失败状态：展示"重试"按钮
- 按钮可见性按当前账号是否为 `assignedOwnerId` 或拥有 `tasks.review.any` 控制

### 10.3 派发入口

任务详情新增"派发"操作，弹出派发表单：

- 接收人选择区（用户/角色/服务器/标签四个 multi-select，可组合）
- 派发方式选择（单次/批量/每周周期）
- 每周周期模式下展示 `weeklyDeliverAt` 和起止日期
- 提交调用 `mip.admin.tasks.assign`

### 10.4 状态机守护

服务端对状态流转做校验，非法流转返回明确错误。前端 `submissionStatus` 映射表扩展为 8 种状态的中文标签和颜色。

### 10.5 数据库迁移

追加迁移脚本到 `database/mysql/migrations/`，新增/扩展 `tasks`、`task_submissions`、`task_assignments` 表字段。不得直接修改现有表结构，不得删除已有字段。

## 11. 验收门禁

```bash
pnpm admin:web:verify   # 类型检查 + 契约测试 + 组件测试 + 构建
pnpm verify             # 涉及服务端契约变更
pnpm verify:all         # 全量验证
git diff --check
```

涉及奖励发放和审批状态机的路径需在契约测试中覆盖通过/退回/失败/重试四条路径。审批权限校验需覆盖无权限账号被拒绝的场景。

## 12. 真机/生产环境验证

- 奖励发放（经验值/贡献值/奖金）需在生产环境验证实际到账
- 审批状态机流转需在真实账号（笨笨老大 + 普通成员）下验证
- 每周周期派发需验证定时触发器实际执行（注意 CloudBase MySQL 定时器频率限制，不得高频唤醒）
