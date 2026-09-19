# M01 列表筛选增强

> 模块: M01
> Wave: 1（无依赖，可立即启动）
> 覆盖 FR: FR-008
> 优先级: P0
> 来源: [admin-web-prd-refactor-spec.md](../admin-web-prd-refactor-spec.md) FR-008
> 总览: [00-overview.md](00-overview.md)

## 描述

实现全局统一的列表筛选能力，覆盖 admin-web 所有列表页（用户/活动/订单/机会及后续新增列表模块）。包括方案 B 开始时间筛选组件、金额范围筛选、多维度下拉筛选、统一分页选项和筛选结果导出。

本模块是全局基础组件层，其他模块（M02–M08）的列表页在各自开发时消费本模块产出的共享筛选组件和扩展后的筛选参数类型。

## 现状基线

- `FilterBar` 组件（`admin-web/src/shared/ui/filter-bar.tsx`）仅支持 `q`（关键词）和 `status`（状态单选）两个筛选维度。
- `AdminListQuery`（`admin-web/src/modules/admin-read-contracts.ts`）类型仅包含 `query / status / cursor / limit` 四个字段，无法承载多维度筛选参数。
- `CorePageSearchState`（`admin-web/src/features/core-pages/core-page-types.ts`）仅含 `q / status / cursor / page`。
- `normalizeListQuery`（`admin-web/src/features/core-pages/use-core-page-query.ts``）硬编码 `limit: 20`，分页无页码跳转和每页条数选择。
- 分页仅"上一页/下一页"翻页（`core-list-pages.tsx`），无每页条数切换和跳转页码。
- 导出仅传 `{ query, status }` 两个筛选条件（`core-list-pages.tsx` onSensitiveExport），未覆盖全部筛选维度。

## 关键功能

### 1. 方案 B 开始时间组件

- 新建共享组件 `StartTimeFilter`，供所有列表页复用。
- 日期精确到年月日 + 时刻精确到分钟，提交格式 `YYYY-MM-DD HH:mm`。
- 仅筛选开始时间，不设结束时间：返回该时刻之后的所有记录。
- 清空时间输入即恢复全部数据（不附带时间筛选条件）。
- 组件内部使用 Ant Design DatePicker + TimePicker 或 DatePicker `showTime` 组合，输出统一格式字符串。

### 2. 金额范围筛选（机会管理）

- 最小值和最大值两个数字输入框，单位万元。
- 仅填最小值：筛选 ≥ 最小值；仅填最大值：筛选 ≤ 最大值；两者都填：区间筛选。
- 输入校验：非负数，最大值不得小于最小值（前端提示）。
- 清空恢复全部。

### 3. 用户列表筛选

- 行业（下拉选择）
- 当前身份（下拉选择）
- 玩家权益状态（下拉选择）
- 时间类型选择（注册时间 或 到期时间）+ 开始时间（方案 B 组件）
- 服务器切换（下拉选择）
- 关键词（现有 `q`）

### 4. 活动列表筛选

- 开始时间（方案 B 组件）
- 费用金额（范围或类型，视活动费用结构）
- 活动标签（多选下拉）
- 服务器/城市（下拉选择）

### 5. 机会列表筛选

- 状态（下拉选择）
- 主营城市（下拉选择）
- 发布人：datalist + 昵称搜索（输入昵称模糊匹配系统用户，选中后传用户 ID）
- 发布时间：本周 / 本月 / 自定义区间（方案 B 开始时间组件支持自定义开始时间）
- 价值金额范围（最小值 + 最大值，单位万元）
- 关键词（现有 `q`）

### 6. 订单列表筛选

- 订单号（输入框）
- 玩家 ID（输入框）
- 手机号（输入框）
- 订单类型（下拉选择）
- 状态（下拉选择，现有 status 扩展）
- 服务器（下拉选择）
- 时间（方案 B 开始时间组件）

### 7. 统一分页

- 每页条数选项统一为 10 / 20 / 50 / 100，默认 20。
- 支持跳转页码输入（输入页码回车跳转）。
- 分页组件替换现有"上一页/下一页"简单翻页。
- 切换每页条数时重置到第 1 页。
- 非分页路由（banners / game / permissions / messages / knowledge / growth / operations）不受影响。

### 8. 筛选结果导出

- 用户列表和订单列表支持导出当前筛选结果。
- 导出请求携带当前全部筛选参数（不仅是 `query` 和 `status`）。
- 复用现有 `onSensitiveExport` 四步异步工作流（create→prepare→reserve→complete）。

## 技术方案

### 新建共享组件

| 组件 | 路径 | 职责 |
|------|------|------|
| `StartTimeFilter` | `admin-web/src/shared/ui/start-time-filter.tsx` | 方案 B 开始时间组件，输出 `YYYY-MM-DD HH:mm` 格式字符串，清空返回 undefined |
| `AmountRangeFilter` | `admin-web/src/shared/ui/amount-range-filter.tsx` | 金额范围输入（最小/最大，单位万元），校验最大 ≥ 最小 |
| `ListPagination` | `admin-web/src/shared/ui/list-pagination.tsx` | 统一分页：10/20/50/100 每页 + 跳转页码 |

### 扩展 FilterBar

- `FilterBar`（`admin-web/src/shared/ui/filter-bar.tsx`）当前 `FilterBarValue` 仅 `{ q, status }`，需扩展为可承载多维度筛选参数的结构。
- 方案：将 `FilterBar` 改为接受 `extraFilters` 渲染槽或子组件组合模式，各列表页按需组合 `StartTimeFilter`、`AmountRangeFilter`、`Select` 等组件。保持 `FilterBar` 的"筛选/清除/刷新"按钮和表单提交语义不变。
- `FilterBarValue` 扩展为开放式结构，向后兼容现有 `{ q, status }` 消费方。

### 扩展筛选参数类型

- `AdminListQuery`（`admin-web/src/modules/admin-read-contracts.ts`）扩展筛选字段：

```typescript
export interface AdminListQuery {
  query: string
  status: string
  cursor: string | null
  limit: number
  // 新增：多维度筛选参数
  startTime?: string              // 方案 B 开始时间，YYYY-MM-DD HH:mm
  amountMin?: number              // 金额最小值（万元）
  amountMax?: number              // 金额最大值（万元）
  industry?: string               // 行业（用户列表）
  identity?: string               // 当前身份（用户列表）
  membershipStatus?: string       // 玩家权益状态（用户列表）
  timeField?: 'registeredAt' | 'expiresAt'  // 时间类型选择（用户列表）
  branch?: string                 // 服务器
  city?: string                   // 城市/主营城市
  tags?: string[]                 // 活动标签
  orderNo?: string                // 订单号
  playerId?: string               // 玩家 ID
  phone?: string                  // 手机号
  orderType?: string              // 订单类型
  publishedBy?: string            // 发布人用户 ID
  publishPeriod?: 'thisWeek' | 'thisMonth' | 'custom'  // 发布时间区间
}
```

- `CorePageSearchState`（`admin-web/src/features/core-pages/core-page-types.ts`）同步扩展，新增对应的 URL 搜索参数字段。
- `CorePageExportIntent.filters` 从 `{ query, status }` 扩展为包含全部筛选参数的结构。

### 各列表页 action input 扩展

- `listInput`（`admin-web/src/modules/admin-read-pages.ts`）当前仅传 `{ query, status }` 到 `filters`，需扩展为透传 `AdminListQuery` 的全部筛选字段。
- 各 `loadXxx` 函数（`loadUsers` / `loadEvents` / `loadOrders` / `loadOpportunities`）将筛选参数映射到对应 action input。
- 契约包 `packages/admin-contracts` 中各 list action 的 input 类型需同步扩展筛选字段定义。

### 分页改造

- `normalizeListQuery` 移除硬编码 `limit: 20`，改为从 `CorePageSearchState.pageSize` 读取，默认 20。
- `CoreListPageView` 中分页区域替换为 `ListPagination` 组件。
- 路由 search params 增加 `pageSize` 和 `page` 参数。

### 受影响文件清单

| 文件 | 变更类型 |
|------|----------|
| `admin-web/src/shared/ui/filter-bar.tsx` | 扩展（多维度筛选支持） |
| `admin-web/src/shared/ui/start-time-filter.tsx` | 新建 |
| `admin-web/src/shared/ui/amount-range-filter.tsx` | 新建 |
| `admin-web/src/shared/ui/list-pagination.tsx` | 新建 |
| `admin-web/src/shared/ui/index.ts` | 导出新组件 |
| `admin-web/src/modules/admin-read-contracts.ts` | 扩展 `AdminListQuery` 类型 |
| `admin-web/src/modules/admin-read-pages.ts` | 扩展 `listInput` 和各 `loadXxx` |
| `admin-web/src/features/core-pages/core-page-types.ts` | 扩展 `CorePageSearchState` 和 `CorePageExportIntent` |
| `admin-web/src/features/core-pages/use-core-page-query.ts` | 移除硬编码 limit，读取 pageSize |
| `admin-web/src/features/core-pages/core-list-pages.tsx` | 接入新筛选组件和分页组件 |
| `packages/admin-contracts` | 各 list action input 类型扩展筛选字段 |

## 依赖

- 无外部模块依赖（全局基础组件层）。
- 其他模块（M02–M08）的列表页在各自开发时消费本模块产出的 `StartTimeFilter`、`AmountRangeFilter`、`ListPagination` 和扩展后的 `AdminListQuery` 类型。M01 应最先完成或与其他模块同步开发。

## 验收标准

- [ ] 方案 B 开始时间组件 `StartTimeFilter` 实现：日期精确到年月日 + 时刻精确到分钟，格式 `YYYY-MM-DD HH:mm`，仅开始时间不筛结束时间，清空恢复全部
- [ ] 金额范围筛选 `AmountRangeFilter` 实现：最小值和最大值输入，单位万元，校验最大值不得小于最小值
- [ ] 用户列表筛选：行业 / 当前身份 / 玩家权益状态 / 时间类型选择（注册时间或到期时间）+ 开始时间 / 服务器切换 / 关键词
- [ ] 活动列表筛选：开始时间 / 费用金额 / 活动标签 / 服务器（城市）
- [ ] 机会列表筛选：状态 / 主营城市 / 发布人（datalist + 昵称搜索）/ 发布时间（本周 / 本月 / 自定义区间）/ 价值金额范围 / 关键词
- [ ] 订单列表筛选：订单号 / 玩家 ID / 手机号 / 订单类型 / 状态 / 服务器 / 时间
- [ ] 统一分页：每页 10 / 20 / 50 / 100 条可选，默认 20，支持跳转页码
- [ ] 切换每页条数时重置到第 1 页
- [ ] 用户列表支持导出当前筛选结果（携带全部筛选参数）
- [ ] 订单列表支持导出当前筛选结果（携带全部筛选参数）
- [ ] `AdminListQuery` 类型扩展覆盖全部新增筛选字段
- [ ] `CorePageSearchState` 和 `CorePageExportIntent` 同步扩展
- [ ] 各列表页 action input 正确传递新增筛选参数到服务端
- [ ] `packages/admin-contracts` 中各 list action input 类型同步更新
- [ ] 非分页路由（banners / game / permissions / messages / knowledge / growth / operations）不受影响
- [ ] 清空任一筛选项即恢复该维度全部数据，不影响其他筛选维度
- [ ] 筛选参数可通过 URL search params 持久化，刷新页面保持筛选状态
- [ ] 通过 `pnpm admin:web:verify`（类型检查 + 契约测试 + 组件测试 + 构建）
- [ ] 通过 `pnpm verify:all`

## 已确认决策

- [x] 活动列表"费用金额"筛选用范围输入，与机会金额范围一致
- [x] 机会发布人 datalist 的昵称搜索不复用 `roles.candidates`（权限模型不匹配），新增独立搜索 action
