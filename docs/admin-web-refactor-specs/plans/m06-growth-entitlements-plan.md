# M06 成长与权益 实现计划

> 优先级 P0 · Wave 1：FR-007 权益流水 + FR-021 贡献值 + FR-022 等级配置
> Wave 2（FR-019/020 等级权益可视化）后续单独排期，本计划不实现。

---

## 1. 目标和范围

### 1.1 范围内（Wave 1）

| FR | 内容 | 关键动作 |
|----|------|---------|
| FR-007 | 权益流水 | `entitlements.transactions.list`、`entitlements.grant` |
| FR-021 | 贡献值规则与流水 | `contribution.rules.list`、`contribution.rules.save`、`contribution.transactions.list`、`contribution.transactions.reverse` |
| FR-022 | 等级配置 | `growth.saveLevel`、`growth.saveBenefit`、`growth.saveRule`、`growth.levels.changeStatus`、`growth.benefits.changeStatus`、`growth.levelTransitions.list` |

### 1.2 范围外

- FR-019/020 等级权益可视化展示（Wave 2）
- 新增 growth 详情路由（`admin-details.ts` 暂不改，编辑走 rowAction mutation，降低摩擦）
- 客户端权益计算（始终服务端事实，客户端只提交意图）

---

## 2. 实现步骤（按 FR 顺序）

### 2.1 FR-022 等级配置（先做，后续流水依赖等级/规则就绪）

1. `admin-row-operations.ts` 新增三个 row action 工厂：`growthLevelRowActions`、`growthBenefitRowActions`、`growthRuleRowActions`，分别对应等级、等级权益、成长规则的编辑/启停。
2. `content-mutation-forms.ts` 新增表单定义：
   - `growth.saveLevel`（inputKeys：`levelId?`、`name`、`threshold`、`order`、`status`）
   - `growth.saveBenefit`（inputKeys：`benefitId?`、`levelId`、`benefitType`、`config`、`status`）
   - `growth.saveRule`（inputKeys：`ruleId?`、`metric`、`eventName`、`deltaValue`、`dailyLimitValue`、`scopeType`、`effectiveFrom`、`effectiveTo`、`auditMode`、`ruleVersion`）
   - `growth.levels.changeStatus`、`growth.benefits.changeStatus`（inputKeys：`id`、`status`）
3. `growth-badges-page.tsx` 的 `actions` 数组（L7-11）追加上述 5 个写动作。
4. `admin-read-special-pages.ts` 的 `loadGrowth`（L100-133）7 个 section 中，对「等级」「等级权益」「成长规则」三个 section 增加 `rowActions`，分别指向步骤 1 的三个工厂。
5. `growth.levelTransitions.list` 作为只读查询接入 `loadGrowth`，复用已有第 5 个请求（`growth.levelTransitions`），补充 `nextCursor` 分页支持（当前 `nextCursor: null`，见 L100-133 返回结构）。

### 2.2 FR-021 贡献值规则与流水

1. `admin-read-special-pages.ts` 的 `loadGrowth` 中新增两个并行请求：
   - `contribution.rules.list`（受 `growth.read` 权限门控，与 `growth.rules` 同组）
   - `contribution.transactions.list`（受 `growth.read` 权限门控，支持 `nextCursor` 分页，初始 `limit=20`）
2. 在 `loadGrowth` 返回的 sections 中新增：
   - 「贡献值规则」section，`rowActions` 复用新 `growthRuleRowActions` 的贡献变体（metric 锁为 `CONTRIBUTION`）
   - 「贡献值流水」section，只读 + `rowActions` 提供「冲正」入口
3. `content-mutation-forms.ts` 新增表单：
   - `contribution.rules.save`（inputKeys：`ruleId?`、`eventName`、`deltaValue`、`dailyLimitValue`、`scopeType`、`effectiveFrom`、`effectiveTo`、`auditMode`、`ruleVersion`）
   - `contribution.transactions.reverse`（inputKeys：`transactionId`、`reason`、`idempotencyKey`）
4. `growth-badges-page.tsx` 的 `actions` 追加 `contribution.rules.save`、`contribution.transactions.reverse`。
5. `growth.adjust`（`content-mutation-forms.ts` L407）已支持 `metric=CONTRIBUTION`，无需改动；但 `validateGrowthAdjust`（L632-636）的 0/~1_000_000 上下界对贡献值同样生效，确认产品口径一致。

### 2.3 FR-007 权益流水

1. `admin-read-special-pages.ts` 的 `loadGrowth` 新增第三个并行请求：
   - `entitlements.transactions.list`（受 `growth.read` 或新增 `entitlements.read` 门控，支持 `nextCursor` 分页）
2. sections 新增「权益流水」section，展示字段：`userId`、`benefitType`、`delta`、`balance`、`reason`、`createdAt`，只读。
3. `content-mutation-forms.ts` 新增 `entitlements.grant` 表单（inputKeys：`userId`、`benefitType`、`delta`、`reason`、`idempotencyKey`），复用 `validateGrowthAdjust` 同款上下界校验（封装为 `validatePositiveDelta`）。
4. `growth-badges-page.tsx` 的 `actions` 追加 `entitlements.grant`。
5. `ContentMutationCapability`（`content-mutation-forms.ts` L41-50）扩展：当前只有 `growth.adjust`，新增 `growth.saveLevel`、`growth.saveBenefit`、`growth.saveRule`、`growth.levels.changeStatus`、`growth.benefits.changeStatus`、`contribution.rules.save`、`contribution.transactions.reverse`、`entitlements.grant` 共 8 项。

---

## 3. 新建文件列表

本计划尽量复用现有文件，不新增页面级文件。Wave 1 不新建文件，所有改动落在既有 6 个文件内。

> 若后续权益流水量大导致 `admin-read-special-pages.ts` 膨胀，可在 Wave 2 拆出 `growth-entitlements-sections.ts`，本 Wave 不做。

---

## 4. 修改文件列表

### 4.1 `admin-web/src/.../growth-badges-page.tsx`（34 行）

- **L7-11 `actions` 数组**：追加 8 个写动作
  - `growth.saveLevel`、`growth.saveBenefit`、`growth.saveRule`
  - `growth.levels.changeStatus`、`growth.benefits.changeStatus`
  - `contribution.rules.save`、`contribution.transactions.reverse`
  - `entitlements.grant`
- 保持委托 `OperationsReadPage` 不变。

### 4.2 `admin-web/src/.../admin-read-special-pages.ts`（189 行）

- **L100-133 `loadGrowth`**：并行请求从 7 个扩展到 10 个
  - 新增 `contribution.rules.list`（与 `growth.rules` 同权限门 `growth.read`）
  - 新增 `contribution.transactions.list`（`limit=20`，支持 `nextCursor`）
  - 新增 `entitlements.transactions.list`（`limit=20`，支持 `nextCursor`）
  - 现有 `growth.levelTransitions` 补充分页游标传递
- **7 → 10 sections**：新增「贡献值规则」「贡献值流水」「权益流水」3 个 section
- **rowActions**：
  - 「等级」section → `growthLevelRowActions`
  - 「等级权益」section → `growthBenefitRowActions`
  - 「成长规则」section → `growthRuleRowActions`（metric 可选）
  - 「贡献值规则」section → `growthRuleRowActions`（metric 锁 `CONTRIBUTION`）
  - 「贡献值流水」section → 冲正 rowAction
  - 「成长流水」「等级变更」「徽章」「徽章获得记录」保持只读无 rowAction
  - 「权益流水」section 只读
- 注意：当前所有 section 的 `nextCursor: null`，新增的三个流水 section 必须真实回传游标。

### 4.3 `admin-web/src/.../content-mutation-forms.ts`（831 行）

- **L4-34 `CONTENT_MUTATION_ACTIONS`**：追加 8 个 action 定义
  - `growth.saveLevel`、`growth.saveBenefit`、`growth.saveRule`
  - `growth.levels.changeStatus`、`growth.benefits.changeStatus`
  - `contribution.rules.save`
  - `contribution.transactions.reverse`
  - `entitlements.grant`
- **L278-284 `GrowthAdjustInput` 附近**：新增对应 Input 类型
  - `GrowthSaveLevelInput`、`GrowthSaveBenefitInput`、`GrowthSaveRuleInput`
  - `ContributionRulesSaveInput`、`ContributionTransactionsReverseInput`
  - `EntitlementsGrantInput`
- **L41-50 `ContentMutationCapability`**：扩展 capability union，追加上述 8 个
- **L407 `growth.adjust` 表单**附近：新增 8 个表单定义
  - `growth.saveLevel`：`levelId` 可选、`name`/`threshold`/`order` 必填、`status` select `ACTIVE|INACTIVE`
  - `growth.saveBenefit`：`benefitId` 可选、`levelId` select（从 `growth.levels` 查询结果联动）、`benefitType` select、`config` JSON 文本域、`status` select
  - `growth.saveRule`：`metric` select、`eventName`、`deltaValue` number、`dailyLimitValue` number 可选、`scopeType` select、`effectiveFrom`/`effectiveTo` date、`auditMode` select `STRICT|LENIENT`、`ruleVersion` number
  - `contribution.rules.save`：metric 锁 `CONTRIBUTION`，其余字段同 `growth.saveRule`
  - `contribution.transactions.reverse`：`transactionId`、`reason` textarea、`idempotencyKey` 自动生成
  - `entitlements.grant`：`userId`、`benefitType` select、`delta` number、`reason`、`idempotencyKey` 自动生成
  - `growth.levels.changeStatus` / `growth.benefits.changeStatus`：`id` hidden、`status` select
- **L632-636 `validateGrowthAdjust`**：抽公共 `validatePositiveDelta(value, max=1_000_000)`，被 `growth.adjust`、`entitlements.grant`、`contribution.transactions.reverse`（delta 取反校验）复用
- `growth.saveRule` / `contribution.rules.save` 新增 `validateGrowthRule`：`deltaValue` 允许 0（规则可为 0），`dailyLimitValue >= 0`，`effectiveTo > effectiveFrom`

### 4.4 `admin-web/src/.../admin-row-operations.ts`（315 行）

- 新增 `growthLevelRowActions(record)`：编辑（打开 `growth.saveLevel` 表单，预填 `levelId`/`name`/`threshold`/`order`/`status`）、启停（`growth.levels.changeStatus`）
- 新增 `growthBenefitRowActions(record)`：编辑（`growth.saveBenefit`）、启停（`growth.benefits.changeStatus`）
- 新增 `growthRuleRowActions(record, opts?: { metric?: 'EXPERIENCE'|'CONTRIBUTION'|'COIN' })`：编辑（`growth.saveRule` 或 `contribution.rules.save`，按 `metric` 选择目标 action）
- 新增 `contributionTransactionRowActions(record)`：冲正（`contribution.transactions.reverse`，二次确认弹窗）
- 不新增 growth 详情 row action（不引入 `admin-details.ts` 路由）

### 4.5 `admin-web/src/.../admin-details.ts`（928 行）

- **本 Wave 不改动**。等级/权益/规则编辑全部走 rowAction mutation，避免新增 detail route。

### 4.6 `growth-badges-page.tsx` 的委托页 `OperationsReadPage`

- 无需改动，自动消费新增的 sections 与 rowActions。

---

## 5. 数据模型变更

> 前置依赖迁移计划，本计划只列契约对齐点；迁移脚本由后端迁移计划负责。

### 5.1 新增表（迁移 069/070）

- `mip_entitlement_transactions`（069）：字段对齐 `entitlements.transactions.list` 响应——`userId`、`benefitType`、`delta`、`balance`、`reason`、`createdAt`、`cursor`
- `mip_contribution_rules`（070）：对齐 `contribution.rules.list`——`ruleId`、`eventName`、`deltaValue`、`dailyLimitValue`、`scopeType`、`effectiveFrom`、`effectiveTo`、`auditMode`、`ruleVersion`
- `mip_contribution_transactions`（070）：对齐 `contribution.transactions.list`
- `mip_contribution_reversals`（070）：支撑 `contribution.transactions.reverse`

### 5.2 ALTER（迁移 071）

- `mip_growth_entries`：新增 `reversal_of_entry_id`（nullable，指向原 entry）
  - 前端 `growth.adjust` 冲正时回传 `idempotencyKey`，服务端写入 reversal 记录
- `mip_growth_rules`：新增 `audit_mode`（`STRICT|LENIENT`）、`rule_version`（int）
  - `growth.saveRule` / `contribution.rules.save` 表单对应字段

### 5.3 现有表复用

- `mip_growth_entries.metric` 已区分 `EXPERIENCE|CONTRIBUTION|COIN`，FR-021 贡献值流水可复用 `growth.entries` 的 `CONTRIBUTION` 子集，同时 `contribution.transactions.list` 作为独立查询接口（服务端按 metric 过滤）。
- `mip_growth_rules` 已有 `metric`/`delta_value`/`daily_limit_value`/`scope_type`/`effective_from`/`effective_to`，FR-021 贡献规则复用同表 `metric=CONTRIBUTION` 子集。

---

## 6. 测试要点

### 6.1 合同测试（非空服务端响应 → 页面展示）

- `loadGrowth` 10 个并行请求，每个必须有「非空响应 → 字段结构 → section 渲染」合同测试
- 重点校验三个新流水 section 的 `nextCursor` 分页游标传递（当前既有 section 全是 `nextCursor: null`，容易遗漏）
- 权益流水字段：`benefitType`、`delta`、`balance` 必须真实出现在响应中，不接受空列表替代

### 6.2 表单校验

- `validatePositiveDelta`：0 拒绝、负数拒绝、>1_000_000 拒绝
- `entitlements.grant`：`benefitType` 必填、`delta` 走 `validatePositiveDelta`
- `contribution.transactions.reverse`：`reason` 必填、`idempotencyKey` 自动生成且唯一
- `growth.saveRule` / `contribution.rules.save`：`effectiveTo > effectiveFrom`、`auditMode` 枚举、`ruleVersion` 自增

### 6.3 rowAction

- `growthLevelRowActions`：编辑预填字段与 record 完全一致；启停按钮按 `status` 切换文案
- `growthRuleRowActions`：metric 锁定场景下 metric 字段禁用且不可改
- `contributionTransactionRowActions`：冲正二次确认弹窗，确认后提交 `contribution.transactions.reverse`

### 6.4 权限门控

- `loadGrowth` 新增 3 个请求必须受 `growth.read`（或 `entitlements.read`）门控
- 身份失败后的重试必须重新确认身份，不绕过
- 8 个新写动作必须在 `growth-badges-page.tsx` 的 `actions` 中声明，受对应 capability 校验

### 6.5 桌面/手机视口

- 10 个 section 的表格在手机视口下横向滚动正常
- rowAction 触发的表单弹层在手机视口下不溢出

---

## 7. 验收检查清单

- [ ] `growth-badges-page.tsx` `actions` 包含全部 13 个写动作（原 3 + 新 8 + 已有 2 个 changeStatus 合并计数）
- [ ] `loadGrowth` 并行请求数 = 10，且每个都有非空合同测试
- [ ] 「等级」「等级权益」「成长规则」「贡献值规则」4 个 section 有 `rowActions`
- [ ] 「权益流水」「贡献值流水」section 支持 `nextCursor` 分页
- [ ] `ContentMutationCapability` union 包含全部 9 项（原 1 + 新 8）
- [ ] `admin-row-operations.ts` 导出 4 个新工厂
- [ ] `validatePositiveDelta` 被 `growth.adjust`/`entitlements.grant`/`contribution.transactions.reverse` 复用
- [ ] `growth.saveRule` / `contribution.rules.save` 表单含 `auditMode`、`ruleVersion` 字段
- [ ] `admin-details.ts` 未新增 growth 路由（本 Wave 不做）
- [ ] `pnpm admin:web:verify` 通过
- [ ] `pnpm verify:all` 通过

---

## 8. 实现顺序

1. **后端契约先行**：迁移 069/070/071 + 云函数 `entitlements.transactions.list`、`entitlements.grant`、`contribution.rules.list/save`、`contribution.transactions.list/reverse`、`growth.levels.changeStatus`、`growth.benefits.changeStatus`、`growth.levelTransitions.list`（本计划只列前端，后端由对应迁移/云函数计划负责）
2. **FR-022 等级配置**：`admin-row-operations.ts` → `content-mutation-forms.ts`（saveLevel/saveBenefit/saveRule + changeStatus）→ `growth-badges-page.tsx` actions → `admin-read-special-pages.ts` rowActions 接线
3. **FR-021 贡献值**：`content-mutation-forms.ts`（contribution.rules.save + reverse）→ `admin-read-special-pages.ts` 新增 2 请求 + 2 sections → `growth-badges-page.tsx` actions
4. **FR-007 权益流水**：`content-mutation-forms.ts`（entitlements.grant）→ `admin-read-special-pages.ts` 新增 1 请求 + 1 section → `growth-badges-page.tsx` actions
5. **`ContentMutationCapability` 收尾**：统一扩展 union，跑 `pnpm admin:web:verify`
6. **合同测试补齐**：10 个请求的非空响应 → section 渲染链路
7. **`pnpm verify:all`** 收尾门禁

---

## 9. 风险与备注

- **`admin-read-special-pages.ts` 膨胀风险**：10 个请求 + 10 sections 后该文件接近上限，Wave 2 评估是否拆分为 `growth-sections.ts` / `entitlements-sections.ts`。
- **metric 双轨**：`growth.entries` / `growth.rules` 与 `contribution.transactions` / `contribution.rules` 在服务端可能是同表 metric 过滤，但前端按独立接口对接，避免假设字段结构一致；两套表单字段（`growth.saveRule` vs `contribution.rules.save`）保持独立定义，只共享校验函数。
- **冲正幂等**：`contribution.transactions.reverse` 与 `growth.adjust` 都依赖 `idempotencyKey`，前端自动生成策略需与 `growth.adjust`（L407）保持一致。
- **真机/生产验证**：等级阈值变更、贡献规则生效、权益发放涉及服务端事实与权益计算，前端合同测试通过后仍需在 CloudBase 环境验证服务端逻辑；本 Wave 不涉及支付/手机号，无需微信真机。
