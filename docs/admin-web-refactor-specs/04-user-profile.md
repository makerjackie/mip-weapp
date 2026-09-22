# M04 — 用户档案补齐

> 来源 Spec: [admin-web-prd-refactor-spec.md](../admin-web-prd-refactor-spec.md)
> 涉及 FR: FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-029
> Wave: 1（全部 FR 相互独立，可并行开发）
> 复杂度: 高
> 依赖: 无
> 跨模块: 消费 M01（列表筛选增强）— 用户列表与各子模块列表接入多维度筛选

---

## 1. 模块定位

围绕"用户档案"做信息深度补齐：把当前 `loadUserDetail`（`admin-details.ts`）展示的影响力简表、用户内容草稿、合作卡/超级案例表单扩展为完整运营档案，新增心动关系、邀请嘉宾、操作记录三块只读子模块，并将合作卡重构为 PRD 定义的 6 卡型结构化模型。

现有代码基线：

- `admin-web/src/modules/admin-details.ts` 的 `loadUserDetail` 已通过 `mip.admin.users.get` + `mip.admin.memberships.get` 装载用户详情，并把 `user.influence` 简表渲染成 4 项指标（嘉宾邀请/互动/心动/访客）。PRD 要求 8 项指标，需扩展。
- `admin-web/src/modules/content-mutation-forms.ts` 已有 `COOPERATION_CARD` 与 `SUPER_CASE` 两种内容类型的保存表单，但合作卡用的是 `roleKey`（connector/business_builder/...）6 角色 + 6 项通用 `abilityScores`，与 PRD 的 6 卡型（PIMP/BUSINESS/RICH/PLANNER/DESIGNER/NANNY）+ 各卡型独立评分项不一致，需重做数据模型。
- `admin-web/src/modules/admin-people-mutation-forms.ts` 的 `mip.admin.users.update` 当前仅写 nickname/headline/introduction，PRD 要求扩展职业信息字段。
- 契约包 `packages/admin-contracts` 已定义 `mip.admin.users.influence.list`（QUERY，safeToRetry）但 web 未接入；`mip.admin.userContent.get/save/unpublish/archive` 已存在，合作卡与超级案例复用这套 action。

---

## 2. 数据模型

### 2.1 合作卡 6 卡型（重构）

PRD 要求合作卡按 6 种固定卡型结构化，每卡型独立评分项与菜单字段。重构后模型：

```ts
type CooperationCardType =
  | 'PIMP'       // 皮条客
  | 'BUSINESS'   // 生意佬
  | 'RICH'       // 暴发户
  | 'PLANNER'    // 狗策划
  | 'DESIGNER'   // 死美工
  | 'NANNY'      // 老保姆

interface CooperationCard {
  userId: string
  cardType: CooperationCardType
  // 共同字段
  realName: string             // 姓名
  gameName: string             // 游戏名
  cardSummary: string          // 卡型说明
  targetSummary: string        // 我的目标
  referralNeeded: string       // 需要引荐的是
  quirks: string               // 臭毛病（外显）
  rootCause: string            // 病因（内在）
  prevention: string           // 预防发作建议（行为）
  cooperationValue: string     // 和我合作最大的价值
  // 特征评分：每卡型 6 项，1-5 星
  abilityScores: { key: string; score: 1 | 2 | 3 | 4 | 5 }[]
  // 菜单字段：按卡型不同
  menuFields: CooperationCardMenuFields
  status: 'ACTIVE' | 'INACTIVE'
  // 审计
  modifiedBy: string
  modifiedAt: string           // datetime
  changeLog: string            // 变更内容摘要
  expectedVersion: number
}
```

卡型与评分项映射（每卡型固定 6 项，不可自定义）：

| 卡型 | 评分项 |
|------|--------|
| PIMP（皮条客） | 开拓人脉 / 引荐人脉 / 长期维护 / 引荐商机 / 卖点提炼 / 跨圈交际 |
| BUSINESS（生意佬） | 商机洞察 / 财务测算 / 盈利建模 / 资源整合 / 利益统筹 / 合作谈判 |
| RICH（暴发户） | 投资洞察 / 上市规划 / 股权规划 / 投融策划 / 融资达成 / 资源整合 |
| PLANNER（狗策划） | 项目调研 / 项目定位 / 创新创意 / 方法设计 / 提案竞标 / 落地规划 |
| DESIGNER（死美工） | 视觉策略 / 视觉设计 / 素材搜寻 / 视觉落地 / 视觉管理 / 提案竞标 |
| NANNY（老保姆） | 目标计划 / 执行统筹 / 进度复盘 / 沟通机制 / 标准研发 / 应急沟通 |

各卡型菜单字段（`menuFields`）：

| 卡型 | 菜单字段 |
|------|---------|
| PIMP | 常混迹的圈子（圈子名称 / 圈内身份 / 圈内年限 / 圈子特点简述） |
| BUSINESS | 做过行业或在做行业 / 行业年限 / 卖点 |
| RICH | 擅长领域 / 领域年限 / 成就 |
| PLANNER | 类型 / 擅长领域 / 卖点 |
| DESIGNER | 类型 / 擅长领域 / 卖点 |
| NANNY | 类型 / 擅长领域 / 卖点 |

> 实现说明：重构 `content-mutation-forms.ts` 中 `CooperationCardDraft`，将 `roleKey` + 通用 `abilityScores` 替换为 `cardType` + 卡型专属评分项与菜单字段。`USER_CONTENT_ROLE_FIELDS` 与 `ABILITY_KEYS` 常量废弃，替换为 `COOPERATION_CARD_TYPE_FIELDS` 与 `COOPERATION_CARD_ABILITY_KEYS`。旧数据需在迁移脚本中按 roleKey→cardType 做一次性映射（connector→PIMP、business_builder→BUSINESS、capital_operator→RICH、strategist→PLANNER、visual_designer→DESIGNER、delivery_lead→NANNY）。

### 2.2 超级案例（增强）

复用现有 `SuperCaseDraft`，补字段并支持多案例与版本记录：

```ts
interface SuperCase {
  caseId: string
  ownerUserId: string
  coverAssetId: string | null      // 案例封面
  projectName: string              // 项目名称
  oneLineSummary: string           // 一句话描述（≤120 字）
  startedOn: string                // 开始时间
  responsibility: string           // 担任职责
  cityTagId: string | null         // 主营城市
  regionTagId: string | null       // 主营地区（新增）
  caseType: string                 // 项目类型
  description: string              // 展开讲讲（全文不截断）
  status: 'PUBLISHED' | 'UNPUBLISHED' | 'TAKEN_DOWN'  // 新增 TAKEN_DOWN
  // 审计
  modifiedBy: string
  modifiedAt: string
  contentVersion: number           // 内容版本
  expectedVersion: number
}
```

> 实现说明：现有 `SuperCaseDraft` 已有 projectName/summary/startedOn/responsibility/cityTagId/caseType/description/coverAssetId。需补 `oneLineSummary`（替代 summary 语义）、`regionTagId`（主营地区）、`contentVersion`、`modifiedBy/modifiedAt`。`status` 枚举新增 `TAKEN_DOWN`（异常下架）。

### 2.3 影响力指标（接入现有契约）

`mip.admin.users.influence.list` 契约已定义，输出 8 项指标：

| 指标 | 字段 | 说明 |
|------|------|------|
| 邀请嘉宾数 | guestCount | 历史邀请的全部嘉宾数 |
| 互动用户数 | interactionUserCount | 与该用户有过互动的去重用户数 |
| 我的心动数 | outgoingInterestCount | 该用户主动心动的人数 |
| 对我心动数 | incomingInterestCount | 对该用户心动的人数 |
| 主页访客次数 | visitorVisitCount | 主页被访问次数 |
| 主页访客人数 | visitorDistinctCount | 主页被访问去重人数 |
| 活动参与（报名） | registrationCount | 报名活动数 |
| 活动签到 | checkInCount | 签到活动数 |
| 发布数 | publishedCount | 发布的合作卡/超级案例/机会数 |
| 想引荐数 | referralIntentCount | 被其他用户标记想引荐的次数 |

> 现状 `loadUserDetail` 用 `user.influence` 简表只渲染 4 项（guestCount/interactionCount/interestCount/visitorCount）。重构后改为调用 `mip.admin.users.influence.list` 独立装载，扩展为 8 项两列展示。

---

## 3. FR 验收标准

### FR-009: 合作卡 6 卡型结构化

- [ ] 6 种卡型固定枚举（PIMP/BUSINESS/RICH/PLANNER/DESIGNER/NANNY），不可自定义新增
- [ ] 每种卡型 6 项特征评分用 1-5 星输入，评分项按卡型不同（见 §2.1 映射表）
- [ ] 共同详情字段：姓名 / 游戏名 / 卡型说明 / 特征打分 / 目标 / 需要引荐 / 臭毛病（外显）/ 病因（内在）/ 预防发作建议（行为）/ 合作最大价值
- [ ] 皮条客菜单：常混迹的圈子（圈子名称 / 圈内身份 / 圈内年限 / 圈子特点简述）
- [ ] 生意佬菜单：做过行业或在做行业 / 行业年限 / 卖点
- [ ] 暴发户菜单：擅长领域 / 领域年限 / 成就
- [ ] 狗策划菜单：类型 / 擅长领域 / 卖点
- [ ] 死美工菜单：类型 / 擅长领域 / 卖点
- [ ] 老保姆菜单：类型 / 擅长领域 / 卖点
- [ ] 简写展示：卡型 / 我的目标 / 需要引荐；点"查看详情"在档案内原地展开，不跳转
- [ ] 操作流程：先查看详情再进入编辑；保存后提示成功
- [ ] 保存记录修改人 / 修改时间 / 变更内容摘要
- [ ] 卡片可按卡型切换编辑（同一用户可维护多张卡或切换卡型）
- [ ] 停用后不在前台展示但保留后台历史
- [ ] 旧 roleKey 数据迁移为 cardType（connector→PIMP 等），迁移脚本追加到 `database/mysql/migrations/`

### FR-010: 用户档案数据看板

- [ ] 看板顶部：头像 / 昵称 / 用户身份 / 账号状态
- [ ] 社交影响力卡片，右上角显示"当前累计"标签
- [ ] 两列共 8 项指标（见 §2.3 指标表）
- [ ] 空数据显示 0 并保留单位（如"0 次""0 人"）
- [ ] 加载失败对应指标显示"—"
- [ ] 影响力数据仅在左侧看板展示一次，右侧详情区不重复展示
- [ ] 接入 `mip.admin.users.influence.list`（契约已定义，仅需 UI 接入）

### FR-011: 用户档案职业信息

- [ ] 扩展 `mip.admin.users.update` 写入字段：所属城市 / 行业 / 职业角色 / 公司 / 职位 / 一句话介绍
- [ ] 用户列表展示当前城市标签
- [ ] 玩家列表同时展示所属服务器
- [ ] `admin-people-mutation-forms.ts` 的 `USER_PROFILE_FIELDS` 与 `buildUserUpdate` 扩展对应字段校验
- [ ] 字段长度与必填规则在 `buildUserUpdate` 内做 boundedText 校验，校验失败返回 null

### FR-012: 用户档案心动关系子模块

- [ ] 心动关系标签页字段：方向 / 关联用户（头像+昵称+按权限标识）/ 关联活动 / 发生时间 / 关系状态 / 最近更新时间
- [ ] 关系方向：我心动的人 / 对我心动的人 / 双向心动
- [ ] 关系状态：有效 / 已撤销 / 已失效
- [ ] 支持按方向 / 活动 / 状态 / 时间筛选（复用 M01 筛选组件）
- [ ] 点击关联用户进入对方档案，点击活动进入活动详情
- [ ] 已撤销 / 已失效仅后台历史保留，前台不展示
- [ ] 无权限时仅展示头像和昵称，不展示其他标识

### FR-013: 用户档案邀请嘉宾名单

- [ ] 字段：嘉宾昵称 / 嘉宾 ID（可点进用户详情）/ 当前角色
- [ ] 展示该用户邀请过的全部历史嘉宾名单
- [ ] 嘉宾账号停用后保留邀请记录（不因嘉宾停用而隐藏）
- [ ] 列表按邀请时间倒序

### FR-014: 用户档案操作记录

- [ ] 操作记录标签页按时间倒序展示该用户相关操作
- [ ] 字段：操作内容 / 操作类型 / 时间 / 操作人（名称及来源类型）
- [ ] 操作类型枚举：查看 / 编辑 / 冻结 / 解冻 / 发放徽章 / 保存合作卡 / 保存超级案例 等
- [ ] 时间精确到分钟
- [ ] 不可由普通用户修改或删除
- [ ] 无记录显示"暂无操作记录"

### FR-029: 超级案例管理增强

- [ ] 一个用户可维护多个案例，按开始时间倒序排列
- [ ] 详情字段：案例封面 / 项目名称 / 一句话描述 / 开始时间 / 担任职责 / 主营城市 / 主营地区 / 项目类型 / 展开讲讲（全文不截断）
- [ ] 支持手动编辑 / 保存
- [ ] 记录修改人 / 修改时间 / 内容版本
- [ ] 支持异常下架（status 置为 `TAKEN_DOWN`）
- [ ] 公开且未下架的案例进入用户主页和人才搜索
- [ ] 多案例列表在用户档案内展示，单案例详情原地展开不跳转

---

## 4. API 设计

保持 action-based RPC。新增与接入的 action：

| Action | 类型 | 状态 | 说明 |
|--------|------|------|------|
| `mip.admin.cooperationCards.get` | QUERY | 新增 | 获取指定用户的合作卡详情（含卡型/评分/菜单字段/审计） |
| `mip.admin.cooperationCards.save` | MUTATION | 新增 | 保存合作卡（新增或编辑，含 cardType/abilityScores/menuFields/status） |
| `mip.admin.users.influence.list` | QUERY | 契约已定义，接入 UI | 8 项影响力指标 |
| `mip.admin.users.invitedGuests.list` | QUERY | 新增 | 用户邀请过的全部嘉宾名单 |
| `mip.admin.users.likeRelations.list` | QUERY | 新增 | 用户心动关系列表（支持方向/活动/状态/时间筛选） |
| `mip.admin.users.operationLogs.list` | QUERY | 新增 | 用户操作记录列表（按时间倒序） |
| `mip.admin.userContent.save` | MUTATION | 已有，扩展 | 超级案例保存扩展 oneLineSummary/regionTagId/contentVersion |
| `mip.admin.userContent.unpublish` | MUTATION | 已有，扩展 | 超级案例异常下架（status=TAKEN_DOWN） |
| `mip.admin.users.update` | MUTATION | 已有，扩展 | 扩展职业信息字段 |

> 契约扩展：新增 action 需同步更新 `packages/admin-contracts/src/generated/admin-operation-contract.ts` 的 action 清单与 input/output 类型。`mip.admin.cooperationCards.*` 与现有 `mip.admin.userContent.save`（kind=COOPERATION_CARD）的关系：合作卡因数据模型重构（roleKey→cardType），独立 action 更清晰；旧 `userContent.save` 的 COOPERATION_CARD 分支保留向后兼容或标记废弃。

---

## 5. 实现要点

### 5.1 用户档案详情页结构调整

`loadUserDetail` 重构为左右两栏布局：

- **左侧看板（FR-010）**：头像/昵称/身份/账号状态 + 8 项影响力指标卡片。影响力改为调用 `mip.admin.users.influence.list` 独立装载，不再只读 `user.influence` 简表。
- **右侧标签页**：
  - 基本信息 + 职业信息（FR-011）
  - 合作卡（FR-009）
  - 超级案例（FR-029）
  - 心动关系（FR-012）
  - 邀请嘉宾（FR-013）
  - 操作记录（FR-014）

### 5.2 合作卡表单重构

`content-mutation-forms.ts` 中 `COOPERATION_CARD` 分支重做：

- 废弃 `roleKey`（OpportunityRole）选择，改为 `cardType`（6 卡型枚举）选择
- 废弃通用 `ABILITY_KEYS`（6 项固定 business_development/...），改为按 cardType 查 `COOPERATION_CARD_ABILITY_KEYS[cardType]` 取该卡型专属 6 项
- 废弃 `USER_CONTENT_ROLE_FIELDS`，改为 `COOPERATION_CARD_MENU_FIELDS[cardType]` 定义各卡型菜单字段
- 评分输入用 1-5 星组件（非 integer 输入框）
- 表单字段切换：选 cardType 后动态渲染对应评分项与菜单字段（复用 `visibleWhen` 机制）

### 5.3 超级案例多案例与版本

- 用户档案内展示案例列表（按 startedOn 倒序），单案例点击"查看详情"原地展开
- 保存时递增 `contentVersion`，记录 modifiedBy/modifiedAt
- 异常下架走 `mip.admin.userContent.unpublish`，status 置 `TAKEN_DOWN`，需填下架原因

### 5.4 职业信息扩展

`admin-people-mutation-forms.ts` 的 `USER_PROFILE_FIELDS` 新增：

```
cityName（所属城市）/ industry（行业）/ careerRole（职业角色）
company（公司）/ position（职位）/ oneLineIntroduction（一句话介绍）
```

`buildUserUpdate` 的字段白名单同步扩展，并做 boundedText 校验。

### 5.5 列表城市标签

用户列表与玩家列表的列定义新增"当前城市"标签列；玩家列表额外展示"所属服务器"列。筛选接入 M01 的多维度筛选（行业/身份/权益状态/时间类型）。

---

## 6. 数据库迁移

需追加迁移脚本到 `database/mysql/migrations/`：

1. **合作卡卡型迁移**：将现有合作卡数据的 `roleKey` 字段映射为 `cardType`（connector→PIMP、business_builder→BUSINESS、capital_operator→RICH、strategist→PLANNER、visual_designer→DESIGNER、delivery_lead→NANNY），并将通用 `abilityScores` JSON 重构为卡型专属评分项。
2. **合作卡菜单字段**：新增/重构 `menuFields` JSON 列，按卡型写入对应菜单字段结构。
3. **超级案例字段扩展**：新增 `one_line_summary`、`region_tag_id`、`content_version`、`modified_by`、`modified_at` 列；`status` 枚举增加 `TAKEN_DOWN`。
4. **用户职业信息**：`users` 表新增 `city_name`、`industry`、`career_role`、`company`、`position`、`one_line_introduction` 列（若不存在）。
5. **心动关系/邀请嘉宾/操作记录**：若服务端已有对应表，仅补索引；若无，新增表并追加迁移。

> 改数据库必须追加迁移，不直接修改现有表结构（AGENTS.md 领域额外规则）。

---

## 7. 边界条件与异常处理

| 场景 | 处理策略 |
|------|----------|
| 合作卡重复保存 | expectedVersion 乐观锁，冲突时保留草稿提示重新打开 |
| 合作卡停用 | status=INACTIVE，前台不展示，后台历史保留 |
| 旧 roleKey 数据 | 迁移脚本一次性映射为 cardType，未迁移数据不展示编辑入口 |
| 影响力指标空数据 | 显示 0 并保留单位（0 次/0 人） |
| 影响力加载失败 | 对应指标显示"—"，不阻塞档案其他区域 |
| 心动关系无权限 | 仅展示头像和昵称，不展示身份标识 |
| 嘉宾账号停用 | 保留邀请记录，嘉宾行标注"已停用" |
| 操作记录 | 不可修改或删除，无记录显示"暂无操作记录" |
| 超级案例异常下架 | status=TAKEN_DOWN，不进入用户主页和人才搜索，后台保留 |
| 超级案例多案例 | 按开始时间倒序，不限制数量 |

---

## 8. 依赖与跨模块

- **依赖**: 无（本模块全部 FR 相互独立，Wave 1 可立即启动）
- **消费 M01**: 用户列表、心动关系列表、邀请嘉宾列表、操作记录列表均接入 M01 的方案 B 时间组件 + 多维度筛选 + 统一分页（10/20/50/100 条 + 跳转页码）
- **被消费**: 无（其他模块不依赖本模块产出）

---

## 9. 验收门禁

```bash
pnpm admin:web:verify   # 类型检查 + 契约测试 + 组件测试 + 构建
pnpm verify             # 服务端契约变更（合作卡重构、新 action）
pnpm verify:all
git diff --check
```

涉及合作卡数据模型重构与数据库迁移，需在迁移脚本中验证旧数据映射正确性。心动关系、邀请嘉宾涉及用户隐私字段，需真机/生产环境验证权限隔离。

---

## 10. 相关文件

- `admin-web/src/modules/admin-details.ts` — `loadUserDetail` 重构（左右两栏 + 标签页）
- `admin-web/src/modules/admin-people-mutation-forms.ts` — `USER_PROFILE_FIELDS` / `buildUserUpdate` 扩展职业信息
- `admin-web/src/modules/content-mutation-forms.ts` — `CooperationCardDraft` 重构（cardType）、`SuperCaseDraft` 增强
- `packages/admin-contracts/src/generated/admin-operation-contract.ts` — 新增 action 清单
- `database/mysql/migrations/` — 追加迁移脚本
