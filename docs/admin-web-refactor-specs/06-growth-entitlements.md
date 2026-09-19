# M06 成长与权益

> 来源: [admin-web-prd-refactor-spec.md](../admin-web-prd-refactor-spec.md)
> 所属 Wave: Wave 1（FR-007、021、022 可独立并行） + Wave 2（FR-019→020，依赖 M02 FR-002 任务奖励类型）
> 现状基线: `admin-web/src/features/operations-pages/growth-badges-page.tsx` 仅提供"成长与勋章"单页多 section 装载；`loadGrowth` 装载 7 个只读 section（等级/权益/规则/成长流水/等级变更/徽章/徽章记录）；写操作仅 `mip.admin.growth.adjust`（调整成长数据）和 `mip.admin.badges.grant/revoke`
> 契约现状: `growth.saveLevel`、`growth.saveBenefit`、`growth.saveRule` 已在契约包定义，web 未接入；`mip.admin.growth.levels/benefits/rules/entries/levelTransitions` 已用于只读装载

---

## 1. 模块定位

把成长与权益从单页只读聚合拆为独立模块，补齐三件事：

1. **权益流水独立模块**（FR-007）—— 把经验值、贡献值、玩家会籍的发放事实从"成长流水"里独立出来，统一手动发放入口
2. **贡献值管理**（FR-021）—— 贡献规则配置化、贡献值流水独立、冲正处理
3. **等级管理配置化**（FR-022）—— 接入已有 `growth.saveLevel/saveBenefit` 契约，等级与等级权益可写

Wave 2 再补：

4. **经验值规则配置**（FR-019）—— 接入已有 `growth.saveRule` 契约
5. **经验值冲正**（FR-020）—— 冲正流水抵消错误发放，重算累计经验值和等级

---

## 2. 现状差距

| 现状 | 差距 |
|------|------|
| `growth-badges-page.tsx` 单页 7 section | 权益流水需独立模块，不混在成长流水里 |
| `mip.admin.growth.adjust` 单一调整动作，metric 含 EXPERIENCE/CONTRIBUTION/COIN | 需按 PRD 拆为权益手动发放、贡献值冲正、经验值冲正三个独立动作；会籍作为独立权益类型 |
| `loadGrowth` 已装载等级、权益、规则、成长流水、等级变更 section，但全部只读 | 等级/权益/规则需接入写入契约 |
| 贡献值与经验值混在一条成长流水里 | 贡献值流水需独立，字段与经验值流水不同 |
| 无权益流水号、无关联订单号、无发放人字段 | 权益流水字段需按 PRD 补齐 |
| 无贡献规则配置 | 完全缺失，需新建 |
| 无经验值冲正 | 完全缺失，需新建 |

---

## 3. Wave 1 — 可立即并行

### FR-007: 权益流水独立模块

- **描述**: 新建权益管理模块，汇总展示经验值/贡献值/玩家会籍的发放流水，支持筛选和手动发放权益。权益流水从"成长流水"中独立出来，会籍作为独立权益类型纳入。
- **验收标准**:
  - [ ] 权益流水字段：权益流水号 / 用户 ID / 昵称 / 权益类型（经验值/贡献值/玩家会籍）/ 权益内容 / 关联订单号 / 发放人 / 发放时间
  - [ ] 列表不展示发放类型、发放来源、备注三列
  - [ ] 权益内容按类型展示：玩家会籍显示"12 个月"/"3 个月"；经验值显示"500 经验值"；贡献值显示具体数值
  - [ ] 用户 ID、昵称、关联订单号可点击跳转对应档案或订单详情
  - [ ] 筛选：关键词 / 权益类型 / 全局开始时间（方案 B 时间组件，`YYYY-MM-DD HH:mm`，仅开始时间不筛结束时间，清空恢复全部）
  - [ ] 统一分页：10/20/50/100 条每页 + 跳转页码
  - [ ] 手动发放权益：单用户搜索选择（用户 ID 或昵称）；可选权益类型为经验值 / 贡献值 / 玩家会籍
  - [ ] 经验值和贡献值必须正整数，校验失败不可提交
  - [ ] 玩家会籍默认 12 个月，仅允许整月时长 1/3/6/12 个月
  - [ ] 手动会籍不绑定订单，仅追加，不支持撤销/扣回/删除/修改
  - [ ] 系统会籍仅在会费订单支付成功后生成并绑定订单号，手动入口不得生成系统会籍
  - [ ] 权益流水不可编辑或删除
- **数据模型**:

```
EntitlementTransaction {
  entitlementNo: string           // 权益流水号
  userId: string
  nickname: string
  entitlementType: 'EXP' | 'CONTRIBUTION' | 'MEMBERSHIP'
  entitlementContent: string      // "12 个月" / "500 经验值" / "20"
  amount?: number                 // 原始数值，用于排序和导出
  months?: 1 | 3 | 6 | 12         // 仅 MEMBERSHIP
  relatedOrderNo?: string         // 系统会籍绑定会费订单号；手动会籍为空
  grantor: string                 // 发放人（系统或管理员账号）
  grantedAt: datetime
  source: 'SYSTEM' | 'MANUAL'     // 不在列表展示
  // 不在列表展示：发放类型/来源/备注
}
```

- **新增 action**:
  - `mip.admin.entitlements.transactions.list` —— 权益流水列表，支持 filters（query/entitlementType/sinceTime）、limit、cursor
  - `mip.admin.entitlements.grant` —— 手动发放权益，input：userId / entitlementType / amount（EXP、CONTRIBUTION 时必填正整数）/ months（MEMBERSHIP 时必填 1/3/6/12）/ idempotencyKey
- **UI 形态**: 独立页面 `EntitlementsPage`，新增导航入口"权益流水"；手动发放走 `MutationDialog`，复用 OperationField 定义
- **依赖**: 无（消费 M01 列表筛选）

---

### FR-021: 贡献值管理

- **描述**: 新建贡献值管理模块，独立于经验值。贡献规则可配置，贡献值流水独立累计，错误数据通过冲正处理。
- **验收标准**:
  - [ ] 贡献规则列表字段：贡献行为 / 奖励经验值 / 奖励上限（单次或每日）/ 适用服务器 / 生效时间（开始和结束）/ 规则状态
  - [ ] 支持新增 / 查看 / 编辑 / 启用 / 停用
  - [ ] 同一行为在相同时间区间和相同服务器范围内不可存在冲突规则（保存时服务端校验）
  - [ ] 修改规则仅影响修改后产生的行为，不回溯已发生流水
  - [ ] 已产生流水的规则不可物理删除，仅可停用
  - [ ] 贡献值流水独立累计，字段：玩家 ID / 贡献行为 / 贡献值 / 关联业务 / 发生时间 / 处理结果
  - [ ] 支持按用户 / 行为 / 服务器 / 时间筛选
  - [ ] 支持导出当前筛选结果（异步四步工作流）
  - [ ] 错误数据通过冲正流水处理，不直接改原流水
  - [ ] 贡献行为范围固定 6 种：邀请嘉宾参加活动 / 参加活动及签到 / 完成 NPC 任务 / 为团队邀请嘉宾 / 引荐项目机会 / 完成机会合作
- **数据模型**:

```
ContributionRule {
  ruleId: string
  behavior: ContributionBehavior   // 6 种枚举之一
  rewardExp: number                // 奖励经验值（贡献行为奖励的是经验值，按 PRD）
  rewardLimit: { kind: 'PER_EVENT' | 'PER_DAY', value: number }
  scopeServers: string[]           // 适用服务器
  effectiveFrom: datetime
  effectiveTo?: datetime
  status: 'ACTIVE' | 'INACTIVE'
  expectedVersion: number          // 乐观锁
}

ContributionTransaction {
  transactionNo: string
  userId: string
  nickname: string
  behavior: ContributionBehavior
  contributionValue: number
  relatedBusiness: string          // 关联业务（活动/任务/机会 ID 或名称）
  occurredAt: datetime
  result: 'SUCCESS' | 'REVERSED' | 'FAILED'
  serverId?: string
}

ContributionReversal {
  reversalNo: string
  originalTransactionNo: string
  reversalValue: number
  reason: string
  operator: string
  operatedAt: datetime
}
```

- **新增 action**:
  - `mip.admin.contribution.rules.list` —— 贡献规则列表
  - `mip.admin.contribution.rules.save` —— 新增/编辑贡献规则（含 expectedVersion 乐观锁）
  - `mip.admin.contribution.transactions.list` —— 贡献值流水，支持 filters（userId/behavior/serverId/sinceTime）
  - `mip.admin.contribution.transactions.reverse` —— 贡献值冲正，input：originalTransactionNo / reversalValue / reason / idempotencyKey
- **UI 形态**: 独立页面 `ContributionPage`，新增导航入口"贡献值管理"；规则保存走 `MutationDialog`；冲正走独立确认对话框
- **依赖**: 无（消费 M01 列表筛选）

---

### FR-022: 等级管理配置化

- **描述**: 接入已定义但未接入的 `growth.saveLevel`/`saveBenefit` 契约，实现等级和等级权益的配置化写入。
- **验收标准**:
  - [ ] 等级配置：新增 / 编辑 / 排序 / 启用 / 停用；字段：名称 / 序号 / 图标 / 说明
  - [ ] 序号和名称不可重复（保存时服务端校验）
  - [ ] 顺序调整后需保持经验值门槛递增
  - [ ] 已有用户的等级不允许物理删除，仅可停用
  - [ ] 等级权益配置：权益名称 / 说明 / 展示顺序 / 状态；一等级多权益
  - [ ] 停用权益后不再对新触发场景生效，历史已发放权益保留
  - [ ] 等级统计：各等级当前用户数量及占比，支持按服务器筛选
  - [ ] 升级记录字段：玩家 ID / 原等级 / 新等级 / 升级时间 / 触发经验值 / 规则版本
  - [ ] 点击等级用户数进入对应用户明细列表
- **数据模型**: 复用现有 `growth.levels` / `growth.benefits` 契约返回结构，补写入字段

```
LevelConfig {
  levelId?: string                 // 编辑时必填
  name: string
  sortOrder: number                // 序号
  icon?: string
  description?: string
  minimumExperience: number        // 门槛，需递增
  status: 'ACTIVE' | 'INACTIVE'
  expectedVersion?: number
}

LevelBenefit {
  benefitId?: string
  levelId: string
  name: string
  description?: string
  sortOrder: number
  status: 'ACTIVE' | 'INACTIVE'
  expectedVersion?: number
}

LevelTransition {
  userId: string
  nickname: string
  fromLevel: string
  toLevel: string
  transitionedAt: datetime
  triggeredExp: number
  ruleVersion: number
}
```

- **接入 action**: `growth.saveLevel`、`growth.saveBenefit`（契约已有，仅需接入 UI）
- **新增 action**:
  - `mip.admin.growth.levels.changeStatus` —— 启用/停用等级
  - `mip.admin.growth.benefits.changeStatus` —— 启用/停用等级权益
  - `mip.admin.growth.levelTransitions.list` —— 升级记录列表（扩展现有 `growth.levelTransitions` 支持筛选和分页）
- **UI 形态**: 在现有 `growth-badges-page` 的"等级"和"等级权益" section 旁新增写入入口，或拆为独立子页"等级管理"；写入走 `MutationDialog`
- **依赖**: 无

---

## 4. Wave 2 — 依赖 Wave 1 完成

### FR-019: 经验值规则配置

- **描述**: 接入已定义但未接入的 `growth.saveRule` 契约，实现经验值规则配置管理。
- **前置依赖**: M02 FR-002（任务奖励类型）需先定义任务奖励配置结构，经验值规则的行为类型需对齐任务奖励类型。UI 可独立构建，但行为类型枚举需与 M02 协商一致。
- **验收标准**:
  - [ ] 规则字段：行为类型（完成任务 / 参加活动 / 活动签到及其他）/ 奖励值 / 奖励上限（单次/每日/周期）/ 审核方式（自动发放或审核通过后发放）/ 适用范围（服务器/用户角色/有效期）/ 规则版本
  - [ ] 支持新增 / 编辑 / 启用 / 停用
  - [ ] 审核方式为"审核通过后发放"时，经验值在任务审批通过后发放（对齐 FR-001）
  - [ ] 失败任务支持按权限重试（与 FR-001 奖励失败重试联动）
  - [ ] 规则版本号自增，修改规则生成新版本，历史流水保留触发时的规则版本
- **数据模型**:

```
ExpRule {
  ruleId?: string
  behaviorType: string             // 完成任务/参加活动/活动签到/...
  rewardValue: number
  rewardLimit: {
    kind: 'PER_EVENT' | 'PER_DAY' | 'PER_CYCLE'
    value: number
    cycleDays?: number             // PER_CYCLE 时
  }
  auditMode: 'AUTO' | 'ON_APPROVAL'
  scopeServers?: string[]
  scopeRoles?: string[]
  effectiveFrom: datetime
  effectiveTo?: datetime
  status: 'ACTIVE' | 'INACTIVE'
  ruleVersion: number
  expectedVersion?: number
}
```

- **接入 action**: `growth.saveRule`（契约已有，接入 UI）
- **新增 action**: `mip.admin.growth.rules.changeStatus` —— 启用/停用
- **依赖**: FR-002（任务奖励类型）

---

### FR-020: 经验值冲正

- **描述**: 错误发放的经验值不直接改原流水，通过冲正流水抵消，冲正后重算累计经验值和等级。
- **前置依赖**: FR-019（经验值规则配置完成后，冲正需对齐规则版本语义）
- **验收标准**:
  - [ ] 冲正流水记录：原流水号 / 冲正值 / 原因 / 操作者 / 操作时间
  - [ ] 冲正后服务端重算用户累计经验值和等级
  - [ ] 不得造成用户经验值小于 0（冲正值超过当前累计时按当前累计冲销，差额记录但不执行）
  - [ ] 冲正流水不可撤销或修改
  - [ ] 冲正操作记录审计日志（操作者/操作时间/原流水/冲正值/原因）
  - [ ] 经验值流水列表展示冲正流水，处理结果标记为"已冲正"
- **数据模型**:

```
ExpReversal {
  reversalNo: string
  originalTransactionNo: string
  reversalValue: number            // 正数，表示抵消的量
  actualReversedValue: number      // 实际冲销值（不超过累计时等于 reversalValue）
  reason: string
  operator: string
  operatedAt: datetime
}
```

- **新增 action**: `mip.admin.exp.transactions.reverse` —— 经验值冲正，input：originalTransactionNo / reversalValue（正整数）/ reason / idempotencyKey
- **UI 形态**: 在经验值流水行操作菜单中提供"冲正"入口，走独立确认对话框；冲正值不可超过原流水值
- **依赖**: FR-019

---

## 5. 跨模块依赖

| 方向 | 模块 | 说明 |
|------|------|------|
| 消费 | M01 列表筛选增强 | 权益流水、贡献值流水、升级记录列表均消费方案 B 时间组件、多维度筛选、统一分页 |
| 依赖 | M02 任务体系（FR-002） | FR-019 行为类型需对齐任务奖励类型；UI 可独立构建，行为类型枚举需与 M02 协商 |
| 联动 | M02 任务体系（FR-001） | 经验值规则审核方式为"审核通过后发放"时，与任务审批发奖联动 |

---

## 6. 新增 action 清单

| action | 说明 | Wave |
|--------|------|------|
| `mip.admin.entitlements.transactions.list` | 权益流水列表 | 1 |
| `mip.admin.entitlements.grant` | 手动发放权益 | 1 |
| `mip.admin.contribution.rules.list` | 贡献规则列表 | 1 |
| `mip.admin.contribution.rules.save` | 保存贡献规则 | 1 |
| `mip.admin.contribution.transactions.list` | 贡献值流水 | 1 |
| `mip.admin.contribution.transactions.reverse` | 贡献值冲正 | 1 |
| `mip.admin.growth.levels.changeStatus` | 等级启用/停用 | 1 |
| `mip.admin.growth.benefits.changeStatus` | 等级权益启用/停用 | 1 |
| `mip.admin.growth.levelTransitions.list` | 升级记录列表（扩筛选分页） | 1 |
| `growth.saveLevel` | 保存等级（契约已有，接入 UI） | 1 |
| `growth.saveBenefit` | 保存等级权益（契约已有，接入 UI） | 1 |
| `mip.admin.growth.rules.changeStatus` | 经验值规则启用/停用 | 2 |
| `growth.saveRule` | 保存经验值规则（契约已有，接入 UI） | 2 |
| `mip.admin.exp.transactions.reverse` | 经验值冲正 | 2 |

---

## 7. 数据库迁移

涉及新数据模型，必须追加迁移脚本到 `database/mysql/migrations/`，不得直接修改现有表结构：

- [ ] `entitlement_transactions` 表（权益流水号/用户/类型/内容/关联订单号/发放人/发放时间/来源）
- [ ] `contribution_rules` 表（行为/奖励/上限/适用服务器/生效区间/状态/版本）
- [ ] `contribution_transactions` 表（玩家/行为/贡献值/关联业务/发生时间/处理结果）
- [ ] `contribution_reversals` 表（原流水/冲正值/原因/操作者/操作时间）
- [ ] `exp_reversals` 表（原流水/冲正值/实际冲销值/原因/操作者/操作时间）
- [ ] 等级、等级权益表若现有结构缺字段则追加迁移，不破坏现有只读装载

---

## 8. 契约包扩展

新增 action 需同步更新 `packages/admin-contracts` 的类型定义和 action 清单：

- [ ] 权益流水相关 input/output 类型
- [ ] 贡献规则、贡献值流水、贡献值冲正相关 input/output 类型
- [ ] 等级/权益启用停用相关 input/output 类型
- [ ] 经验值规则启用停用、经验值冲正相关 input/output 类型（Wave 2）

---

## 9. 边界条件与异常处理

| 场景 | 处理策略 |
|------|----------|
| 手动会籍撤销 | 手动会籍仅追加，不支持撤销/扣回/删除/修改 |
| 系统会籍重复回调 | 不得重复生成系统会籍，按订单号幂等 |
| 经验值冲正后小于 0 | 冲正后重算，不得造成用户经验值小于 0，超额部分记录但不执行 |
| 贡献规则冲突 | 同一行为在相同时间和服务器范围内不可存在冲突规则，保存时服务端拒绝 |
| 已产生流水的规则删除 | 不可物理删除，仅可停用 |
| 等级门槛递增 | 顺序调整后需保持经验值门槛递增，否则保存失败 |
| 已有用户的等级删除 | 不允许物理删除，仅可停用 |
| 版本冲突 | expectedVersion 乐观锁，冲突时保留草稿提示重新打开 |

---

## 10. 验收门禁

```bash
pnpm admin:web:verify   # 类型检查 + 契约测试 + 组件测试 + 构建 + 响应式验证
pnpm verify             # 涉及服务端契约变更
pnpm verify:all
git diff --check
```

- [ ] Wave 1 三个 FR 完成并通过 `pnpm admin:web:verify`
- [ ] Wave 2 两个 FR 完成并通过 `pnpm admin:web:verify`
- [ ] 权益流水可查询和手动发放
- [ ] 贡献规则可配置，贡献值流水可查询、导出、冲正
- [ ] 等级和等级权益可写入，等级统计可按服务器筛选
- [ ] 经验值规则可配置，经验值冲正不造成负值（Wave 2）
- [ ] `pnpm verify:all` 全绿

---

## 11. 待确认问题

- [ ] 等级权益是仅展示还是需要业务校验 — PRD 待确认（影响 FR-022 权益配置的校验深度）
- [ ] 贡献行为奖励的是经验值还是贡献值 — PRD 文案为"奖励经验值"，但模块名为贡献值管理，需确认贡献值与经验值的关系
- [ ] 经验值规则行为类型与 M02 任务奖励类型对齐细节 — 需与 M02 协商
