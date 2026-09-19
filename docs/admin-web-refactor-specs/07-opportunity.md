# M07 — 机会管理增强

> 来源: [admin-web-prd-refactor-spec.md](../admin-web-prd-refactor-spec.md) · FR-023 / FR-024 / FR-025
> 总览: [00-overview.md](00-overview.md)
> Wave: 1（三条 FR 互不依赖，可并行实现）
> 优先级: P1
> 预估复杂度: 中

## 1. 模块定位

补齐管理后台「机会」领域的三块缺口：

1. 机会详情缺少完整的操作记录子模块，且当前缺少删除入口（FR-023）。
2. 机会创建表单字段与 PRD 要求不一致，缺粘贴识别、多选城市、可见范围、发布人校验等（FR-024）。
3. 机会详情未展示「想推荐名单」，运营无法追踪谁对机会表达了推荐意愿（FR-025）。

三条 FR 相互独立，内部无依赖链，可同时开工。

## 2. 现状基线

- 机会写操作契约已存在于 `packages/admin-contracts/src/generated/admin-operation-contract.ts`：
  `mip.admin.opportunities.save / publish / end / unpublish / archive`。
- 表单定义在 `admin-web/src/modules/content-mutation-forms.ts`（`getContentMutationForm('mip.admin.opportunities.save')`），当前 `draft` 字段为：
  `ownerUserId / scopeType / branchId / title / valueSummary / targetSummary / description / cityTagId / commercialTerms / roleKeys / tagIds / deadlineAt`。
- 表单页：`admin-web/src/features/form-pages/opportunity-edit-form-page.tsx`，基于 `IndependentFormPage`。
- 机会详情：`admin-web/src/modules/admin-details.ts` 的 `loadOpportunityDetail`，已有一个简化的「操作记录」section，仅展示 `action / actorNickname / createdAt` 三列，直接取自 `opportunity.history`，未区分操作枚举、无状态变更前后值、无删除快照。
- 当前无 `mip.admin.opportunities.operationLogs`、`mip.admin.opportunities.delete` action。

## 3. FR 清单

| FR | 标题 | 优先级 | 依赖 |
|----|------|--------|------|
| FR-023 | 机会操作记录与删除 | P1 | 无 |
| FR-024 | 机会创建增强 | P1 | 无 |
| FR-025 | 机会详情想推荐名单 | P1 | 无 |

## 4. FR-023 — 机会操作记录与删除

### 4.1 目标

机会详情新增独立的「操作记录」子模块，覆盖机会全生命周期的操作审计；并提供机会删除能力，删除后小程序端与后台同步移除业务展示数据，但操作记录永久保留。

### 4.2 新增 API action

| Action | Kind | 说明 |
|--------|------|------|
| `mip.admin.opportunities.operationLogs` | QUERY | 按 `opportunityId` 分页查询操作记录，按操作时间倒序 |
| `mip.admin.opportunities.delete` | MUTATION | 软删除机会本体（小程序端与后台同步隐藏），保留操作记录与删除前内容快照 |

两个 action 均需 `authentication: REQUIRED`、`session: REQUIRED`。`operationLogs` 设 `safeToRetry: true`；`delete` 设 `safeToRetry: false`，要求 `expectedVersion` 乐观锁与 `reason`（≤240 字）。

### 4.3 操作记录字段

操作记录单条结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `logId` | string | 记录主键 |
| `opportunityId` | string | 所属机会 ID（删除后仍保留） |
| `actorUserId` | string | 操作人用户 ID |
| `actorNickname` | string | 操作人昵称（快照） |
| `action` | enum | 操作类型，见下 |
| `fromStatus` | enum \| null | 状态变更前状态，仅状态变更类操作有值 |
| `toStatus` | enum \| null | 状态变更后状态，仅状态变更类操作有值 |
| `summary` | string \| null | 摘要（如删除前内容快照引用、导出范围等） |
| `snapshotRef` | string \| null | 删除操作时指向机会删除前内容快照的引用 |
| `createdAt` | datetime | 操作时间 |

`action` 枚举（与 `admin-details.ts` 现有 `admin.opportunities.*` codeLabel 映射对齐并补齐）：

```
CREATE          创建
EDIT            编辑
PUBLISH         发布
STATUS_CHANGE   修改状态
UNPUBLISH       下架
RESTORE         恢复
DELETE          删除
VIEW_DETAIL     查看详情
EXPORT_DATA     导出数据
```

> 说明：`STATUS_CHANGE` 用于非 publish/unpublish/end 的通用状态切换；`publish / unpublish / end / archive` 等既有动作各自记录对应枚举，并在 `fromStatus / toStatus` 中带出前后状态。`DELETE` 记录必须写入 `snapshotRef` 与 `summary`（机会 ID、名称、删除前内容快照）。

### 4.4 删除行为

- `mip.admin.opportunities.delete` 执行后：
  - 机会本体及其在小程序端、后台列表的业务展示数据同步删除/隐藏（按服务端既有软删约定）。
  - 操作记录表对应机会的所有历史记录**永久保留**，不得随机会一同软删。
  - 删除动作写入一条 `action=DELETE` 的操作记录，`snapshotRef` 指向删除前内容快照（包含机会 ID、机会名称、关键字段JSON）。
- 删除后机会详情页仍可访问操作记录子模块（机会本体字段以快照形式只读展示，标题加「已删除」标记）。

### 4.5 前端实现要点

- `admin-web/src/modules/admin-details.ts` 的 `loadOpportunityDetail`：将现有「操作记录」section 从直接消费 `opportunity.history` 改为调用 `mip.admin.opportunities.operationLogs`（分页），列扩展为：操作 / 操作人 / 操作时间 / 变更前状态 / 变更后状态 / 摘要。
- 机会详情页新增「删除机会」操作入口（受 `opportunities.archive` 或新增 `opportunities.delete` capability 控制，需走 `MutationDialog`，要求填写 `reason` 并带 `expectedVersion`）。
- 删除成功后详情页进入「已删除」只读视图，操作记录仍可查询。
- `content-mutation-forms.ts` 的 `CONTENT_MUTATION_ACTIONS` 追加 `mip.admin.opportunities.delete`，并补表单定义（`reasonField` + `versionField`）。

### 4.6 数据库迁移

需追加迁移脚本到 `database/mysql/`（按仓库迁移约定，不修改现有表结构）：

- 新增机会操作记录表（若已有 `opportunity_history` 则扩展列：`from_status / to_status / summary / snapshot_ref`，并补 `action` 枚举值）。
- 新增机会删除快照存储（可为独立表或 JSON 列），保留机会 ID / 名称 / 删除前内容。
- 操作记录表对 `opportunity_id` 建索引，但不随机会软删级联。

### 4.7 验收标准

- [ ] 机会详情新增独立「操作记录」子模块，调用 `mip.admin.opportunities.operationLogs` 分页加载
- [ ] 操作记录字段完整：操作人 / 操作时间 / 操作枚举（创建/编辑/发布/修改状态/下架/恢复/删除/查看详情/导出数据）
- [ ] 状态变更类操作同时记录变更前状态（`fromStatus`）与变更后状态（`toStatus`）并在详情展示
- [ ] 操作记录按操作时间倒序排列
- [ ] 机会详情提供「删除机会」入口，走 `MutationDialog`，要求 `reason` 与 `expectedVersion`
- [ ] 删除机会后小程序端与后台同步删除/隐藏该机会及业务展示数据
- [ ] 删除操作记录永久保留，保存机会 ID / 名称 / 删除前内容快照（`snapshotRef`）
- [ ] 删除后机会详情页以只读「已删除」视图展示，操作记录仍可查询
- [ ] `packages/admin-contracts` 同步新增 `operationLogs` 与 `delete` action 清单与类型
- [ ] 追加数据库迁移脚本，不修改现有表结构

## 5. FR-024 — 机会创建增强

### 5.1 目标

按 PRD 补齐机会创建/编辑表单字段、校验与交互。

### 5.2 字段调整

在 `content-mutation-forms.ts` 的 `mip.admin.opportunities.save` 表单定义中调整 `draft` 字段：

| 字段 | 当前 | 目标 | 校验 |
|------|------|------|------|
| `partnerSeeking` | 无 | 新增「寻找合作方」 | 必填，≤300 字 |
| `elaboration` | 无 | 新增「展开讲讲」 | 可空，≤300 字 |
| `cityTagIds` | `cityTagId` 单选 | 改为多选「主营城市」 | 至少 1 个 |
| `region` | 无 | 新增「所在地区」 | 可空 |
| `ownerUserId` | 必填 | 必填且必须为账号状态正常的系统用户 | 校验返回 `FORBIDDEN`/`VALIDATION_ERROR` 时提示 |
| `coverAssetId` | 无 | 新增「项目封面」，最后填写 | 可空；空则用系统默认封面 |
| `visibility` | `scopeType`（PLATFORM/BRANCH） | 新增「可见范围」枚举：`PLATFORM`（发布到平台）/ `MIP_INTERNAL`（仅 MIP 内部玩家可见） | 必填 |

> `scopeType / branchId` 既有作用范围语义保留（与可见范围正交：作用范围控制服务器维度，可见范围控制人群维度）。如服务端契约确认两者合并，以服务端契约为准并在 spec 中注明。

### 5.3 粘贴整段文字自动识别填充

- 表单顶部新增「智能识别」粘贴区，用户粘贴整段文字后由前端解析尝试填充：标题、寻找合作方、展开讲讲、主营城市、所在地区等。
- 解析规则：
  - 以换行/常见分隔符（「：」「:」「-」「】」）切分键值。
  - 城市名匹配城市标签选项集（来自 `mip.admin.opportunities.options`）。
  - 识别失败的字段忽略，不阻塞提交；识别结果以草稿态填入表单，用户可二次编辑。
- 识别为前端辅助，不作为服务端契约；服务端仍按字段校验。

### 5.4 发布人校验

- `ownerUserId` 选择器只列出账号状态正常的系统用户（消费 `mip.admin.users.list` 或现有账号选项 action，过滤 `status=ACTIVE`）。
- 选中后被停用的用户在提交时由服务端返回校验错误，前端展示「发布人账号状态异常」。

### 5.5 项目封面

- `coverAssetId` 排在表单最后；可空。
- 为空时服务端使用系统默认封面（不在前端硬编码默认封面 URL）。
- 复用 `assetPurpose` 上传通道（参考知识内容 `SUPER_CASE_COVER` 模式，机会封面使用独立 purpose 如 `OPPORTUNITY_COVER`）。

### 5.6 验收标准

- [ ] 表单支持粘贴整段文字自动识别填充，识别结果可二次编辑
- [ ] 「寻找合作方」字段必填且 ≤300 字
- [ ] 「展开讲讲」字段可空，填写时 ≤300 字
- [ ] 「主营城市」支持多选，至少选择 1 个
- [ ] 「所在地区」可空
- [ ] 「发布人」必须选账号状态正常的系统用户；选择器仅列出正常账号，提交时服务端校验异常有明确提示
- [ ] 「项目封面」位于表单最后，可空；为空时由服务端使用系统默认封面
- [ ] 「可见范围」提供「发布到平台」与「仅 MIP 内部玩家可见」两个选项，必填
- [ ] `validateOpportunity` 同步更新字段校验，`assertKeys` 与服务端契约一致
- [ ] `packages/admin-contracts` 同步更新 `mip.admin.opportunities.save` 的输入类型

## 6. FR-025 — 机会详情想推荐名单

### 6.1 目标

机会详情展示「想推荐名单」，记录哪些用户对该机会表达了推荐意愿。

### 6.2 新增 API action

| Action | Kind | 说明 |
|--------|------|------|
| `mip.admin.opportunities.referrals` | QUERY | 按 `opportunityId` 分页查询想推荐名单，按操作时间倒序 |

> 若服务端已有 `referralCount` 数据（`loadOpportunityDetail` 已展示「引荐数」），本 action 提供明细列表。`safeToRetry: true`。

### 6.3 名单字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `referralId` | string | 记录主键 |
| `opportunityId` | string | 所属机会 ID |
| `userId` | string | 用户 ID |
| `nickname` | string | 用户昵称（快照） |
| `createdAt` | datetime | 操作日期时间 |

按 `createdAt` 倒序。

### 6.4 前端实现要点

- `loadOpportunityDetail` 新增「想推荐名单」section，调用 `mip.admin.opportunities.referrals` 分页加载。
- 列：用户 ID / 昵称 / 操作日期时间。
- 与现有「引荐数」字段联动：总数与名单条数一致；权限不足时 section 降级为「数据权限：当前账号不可查看」（参考现有评论数据 section 的降级模式）。

### 6.5 验收标准

- [ ] 机会详情新增「想推荐名单」子模块
- [ ] 名单记录用户 ID / 昵称 / 操作日期时间
- [ ] 名单按操作时间倒序排列
- [ ] 权限不足时降级展示「当前账号不可查看」，不抛整页错误
- [ ] `packages/admin-contracts` 同步新增 `mip.admin.opportunities.referrals` action 与类型

## 7. 依赖与跨模块

- **模块内部依赖**: 无。FR-023 / FR-024 / FR-025 可并行实现。
- **跨模块依赖**: 消费 M01（列表筛选增强）的机会列表多维度筛选，含金额范围（`commercialTerms.minAmountCents / maxAmountCents`）。M07 不修改列表筛选本身，仅在机会列表页接入 M01 提供的筛选组件。
- **共享基础设施**: 复用 `OperationField / MutationDialog / IndependentFormPage / AdminDetailSection`，不重复造。
- **契约包**: 所有新增 action 同步更新 `packages/admin-contracts`，遵循 action-based RPC 模式。

## 8. 数据库迁移

- 机会操作记录表扩展/新增（`from_status / to_status / summary / snapshot_ref`，`action` 枚举补齐）。
- 机会删除快照存储。
- 想推荐名单表（若服务端尚无明细表则新增；已有则补字段）。
- 所有变更以追加迁移脚本方式提交到 `database/mysql/`，不修改现有表结构。

## 9. 验收门禁

```bash
pnpm admin:web:verify   # 类型检查 + 契约测试 + 组件测试 + 构建 + 响应式验证
pnpm verify             # 涉及服务端契约变更
```

- 桌面与手机视口均需验证机会详情、创建表单、操作记录分页、想推荐名单分页的响应式表现。
- 删除机会为不可逆操作，需在 staging 环境验证小程序端与后台同步删除效果。
- 操作记录与想推荐名单的合同测试必须包含非空服务端响应到页面展示的校验（按 AGENTS.md 第 11 节要求）。

## 10. 待确认

- [ ] `scopeType/branchId`（作用范围）与新增 `visibility`（可见范围）是否在服务端合并为同一字段 —— 需服务端契约确认。
- [ ] 「想推荐」数据源是否已存在服务端明细表，还是需新建 —— 需服务端确认。
- [ ] 删除机会的 capability 是复用 `opportunities.archive` 还是新增 `opportunities.delete` —— 需权限模型确认。
