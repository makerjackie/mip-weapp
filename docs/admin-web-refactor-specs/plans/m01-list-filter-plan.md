# M01 列表筛选增强 实现计划

- 优先级：P0
- 波次：Wave 1
- 模块：M01
- 范围：admin-web/ 列表筛选管线（URL → 搜索状态 → 规范化查询 → 后端输入 → UI）

## 1. 目标和范围

将现有「q + status」二维筛选扩展为可插拔的多维筛选管线，支撑后续按时间区间、会员等级、活动状态、订单渠道等维度过滤，且每个新维度只需在约定位置追加字段，不再逐层散落改动。

本次落地三件事：

1. 把 `FilterBarValue` 从固定结构改造为可扩展的筛选值集合（保留 `q`、`status`，新增 `filters` 动态键值）。
2. 把 `listInput`（唯一的后端 payload 组装点）改为显式映射全部筛选维度，避免后端收到未被声明的字段。
3. 修正 `useQuery.queryKey` 仅包含 `query/status/cursor/limit` 的缺陷，新增维度必须进入缓存键，否则会出现陈旧缓存。

非目标：

- 不在本计划内新增具体业务维度（会员等级、时间区间等由各业务模块计划承接）。
- 不改造分页模型（`data-table.tsx:127` 的 `pagination={false}` 保持客户端排序）。
- 不改动后端 `mip-admin-api` 的 filters 契约结构，仅保证前端发送的字段集合向后兼容。

## 2. 实现步骤（按文件，每步具体到函数和行号）

### 步骤 2.1 filter-bar.tsx — UI 筛选模型扩展

文件：`admin-web/src/.../filter-bar.tsx`

- 第 5 行 `FilterBarValue = { q: string; status: string }` 改为：
  - 保留 `q: string`、`status: string`。
  - 新增 `filters?: Record<string, string | string[] | undefined>`，承载未来扩展维度。
- 第 18 行 `sync` 签名：增加 `extraFilters?: (value: FilterBarValue) => void` 可选回调，供页面把 `filters` 同步回搜索状态；默认不调用，保持现有行为。
- 第 50 行 `reset`：重置时同时清空 `filters`（置为 `{}`），避免上一次的扩展筛选残留。
- 第 7-55 行 `FilterBar` 主体：渲染区增加 `extraFilterSlots?: React.ReactNode` 入参，用于后续注入 Select/DatePicker；本次不渲染具体控件，仅留槽位。

### 步骤 2.2 router.tsx — URL 搜索参数契约

文件：`admin-web/src/.../router.tsx`

- 第 6-12 行 `AdminListSearch`：
  - 保留 `q?`、`status?`、`cursor?`、`page?`、`tab?`。
  - 新增 `filters?: Record<string, string>`，扁平化键值对，URL 序列化为 `filters[xxx]=yyy`。
- 第 14-24 行 `validateSearch`：
  - 增加对 `filters` 的解析：只接受字符串值，非字符串丢弃；空对象归一为 `undefined`。
  - 保持 `pageRoutes` 共用同一 `validateSearch`，不复制逻辑。

### 步骤 2.3 core-page-types.ts — 核心页搜索状态

文件：`admin-web/src/.../core-page-types.ts`

- 第 7-12 行 `CorePageSearchState`：新增 `filters?: Record<string, string>`。
- 第 26-31 行 `CorePageExportIntent.filters`：把导出筛选意图从仅 `query/status` 扩展为 `query/status/filters`，保证导出能携带扩展维度。

### 步骤 2.4 operations-pages/types.ts — 运营页状态

文件：`admin-web/src/.../operations-pages/types.ts`

- 第 36 行 `OperationsPageState.query`：类型从 `Pick<AdminListQuery, 'query' | 'status'>` 扩展为 `Pick<AdminListQuery, 'query' | 'status' | 'filters'>`。
- 第 46 行 `onFilterChange`：入参类型同步扩展，确保页面把 `filters` 写回 query。

### 步骤 2.5 admin-read-contracts.ts — 查询模型与路由定义

文件：`admin-web/src/.../admin-read-contracts.ts`

- 第 27-32 行 `AdminListQuery`：新增 `filters?: Record<string, string>`。
- 第 34-38 行 `AdminReadRouteDefinition`：新增 `filterDimensions?: readonly FilterDimensionSpec[]`，其中 `FilterDimensionSpec = { key: string; urlParam: string; multi?: boolean }`，用于声明某路由支持的扩展维度，避免无声明字段进入后端。

### 步骤 2.6 use-core-page-query.ts — 规范化与缓存键

文件：`admin-web/src/.../use-core-page-query.ts`

- 第 70-77 行 `normalizeListQuery`：
  - 在映射 `CorePageSearchState → AdminListQuery` 时，透传 `filters`（仅保留 `AdminReadRouteDefinition.filterDimensions` 中声明的 key，其余丢弃）。
  - 保留 `limit: 20` 不变。
- 第 20-30 行 `useQuery.queryKey`：
  - 在缓存键数组中追加 `['filters', value.filters ?? {}]`。
  - 对 `filters` 做稳定排序后序列化，避免键顺序差异导致缓存失效。
- 这是本计划最易出错点：任何新增维度都必须同时进入 `queryKey`，否则切回旧筛选仍命中陈旧数据。

### 步骤 2.7 admin-read-pages.ts — 路由定义与后端 payload

文件：`admin-web/src/.../admin-read-pages.ts`

- 第 60-121 行 `routeDefinitions`（12 条）：
  - 为需要扩展维度的路由（events/messages/knowledge 等）补充 `filterDimensions`；本次仅声明空数组占位，不绑定具体维度。
- 第 419-426 行 `listInput`：
  - 把 `filters: { query, status }` 扩展为 `filters: { query, status, ...extraFilters }`，`extraFilters` 来自 `AdminListQuery.filters`。
  - 显式删除值为 `undefined`/空字符串的 key，避免后端误判。
- 第 179-190 行 `loadEvents`、第 343-353 行 `loadMessages`、第 390-396 行 `loadKnowledge`：
  - 这三个 loader 各自拼装 payload，不复用 `listInput`。逐一检查并补齐 `filters` 透传，确保与 `listInput` 行为一致。

### 步骤 2.8 admin-read-formatters.ts — 客户端二次过滤

文件：`admin-web/src/.../admin-read-formatters.ts`

- 第 72-80 行 `filterRows`：
  - 当前仅按 `q/status` 客户端过滤（用于 `loadPermissions` 等纯前端列表）。
  - 扩展为遍历 `value.filters` 的每个 key，调用对应的 `FilterDimensionSpec.matcher`；无 matcher 的 key 跳过。
  - 保持未声明维度不生效，避免客户端与后端行为不一致。

### 步骤 2.9 core-list-pages.tsx — 核心列表页接入

文件：`admin-web/src/.../core-list-pages.tsx`

- 第 189-202 行 `CoreListPageView` 中 `FilterBar` 调用：
  - 传入 `extraFilters` 回调，把 `filters` 写回 `CorePageSearchState`。
  - 传入 `extraFilterSlots`，从路由定义 `filterDimensions` 渲染对应控件（本次为空）。
- 第 170-171 行 导出 filters：把 `CorePageExportIntent.filters` 中的 `filters` 字段一并写入导出意图。

### 步骤 2.10 operations-read-page.tsx — 运营页接入

文件：`admin-web/src/.../operations-read-page.tsx`

- 第 51 行 `FilterBar` 调用：补齐 `extraFilters`。
- 第 62-68 行 `onFilterChange`：把扩展 `filters` 合并进 `OperationsPageState.query`，而非整体替换，避免丢失既有维度。

## 3. 新建文件列表

本次不新建源码文件。若 `FilterDimensionSpec` 需要独立类型文件，放在 `admin-web/src/.../filter-dimension.ts`，仅导出类型，不含运行时逻辑。是否新建取决于步骤 2.5 的类型是否被多个文件引用；默认与 `admin-read-contracts.ts` 同文件定义。

## 4. 修改文件列表

| 文件 | 具体改动点 |
|---|---|
| filter-bar.tsx | 第 5 行 `FilterBarValue` 加 `filters?`；第 18 行 `sync` 加 `extraFilters`；第 50 行 `reset` 清 `filters`；第 7-55 行加 `extraFilterSlots` 槽位 |
| router.tsx | 第 6-12 行 `AdminListSearch` 加 `filters?`；第 14-24 行 `validateSearch` 解析并归一 `filters` |
| core-page-types.ts | 第 7-12 行 `CorePageSearchState` 加 `filters?`；第 26-31 行 `CorePageExportIntent.filters` 扩展 |
| operations-pages/types.ts | 第 36 行 `OperationsPageState.query` 类型扩展；第 46 行 `onFilterChange` 入参扩展 |
| admin-read-contracts.ts | 第 27-32 行 `AdminListQuery` 加 `filters?`；第 34-38 行 `AdminReadRouteDefinition` 加 `filterDimensions?` |
| use-core-page-query.ts | 第 70-77 行 `normalizeListQuery` 透传并裁剪 `filters`；第 20-30 行 `queryKey` 追加稳定排序后的 `filters` |
| admin-read-pages.ts | 第 60-121 行 `routeDefinitions` 补 `filterDimensions` 占位；第 419-426 行 `listInput` 扩展 payload 并删空值；第 179-190/343-353/390-396 行三个 loader 同步透传 |
| admin-read-formatters.ts | 第 72-80 行 `filterRows` 遍历 `filters` 并按 `FilterDimensionSpec.matcher` 过滤 |
| core-list-pages.tsx | 第 189-202 行 `FilterBar` 调用传 `extraFilters`/`extraFilterSlots`；第 170-171 行导出意图带 `filters` |
| operations-read-page.tsx | 第 51 行 `FilterBar` 调用补 `extraFilters`；第 62-68 行 `onFilterChange` 合并而非替换 `filters` |

## 5. 测试要点

1. URL 契约：`?filters[level]=gold` 解析为 `{ filters: { level: 'gold' } }`；非法值（数组、对象）被丢弃；空 `filters={}` 归一为 `undefined`。
2. 缓存键：`use-core-page-query.ts:20-30` 的 `queryKey` 必须在 `filters` 变化时生成新键；同内容不同 key 顺序应命中同一缓存（稳定排序生效）。
3. 后端 payload：`listInput`（419-426）输出的 `filters` 不含 `undefined`/空字符串；未在 `filterDimensions` 声明的 key 不进入 payload。
4. 三个独立 loader（loadEvents 179-190、loadMessages 343-353、loadKnowledge 390-396）与 `listInput` 行为一致。
5. 客户端过滤：`filterRows`（72-80）对 `loadPermissions` 类纯前端列表，按 `matcher` 正确过滤；无 matcher 的 key 被跳过。
6. 重置：`filter-bar.tsx:50` reset 后 `filters` 为 `{}`，URL 同步清除 `filters[*]` 参数。
7. 导出：`CorePageExportIntent.filters` 携带扩展维度，导出文件名/筛选摘要正确反映当前 `filters`。
8. 回归：现有 `q`/`status` 行为不变；`pagination={false}`（data-table.tsx:127）不受影响。

## 6. 验收检查清单

- [ ] `FilterBarValue` 含 `filters?` 字段，`reset` 清空该字段。
- [ ] `AdminListSearch` / `validateSearch` 支持 `filters`，非法值被丢弃。
- [ ] `CorePageSearchState`、`OperationsPageState.query`、`onFilterChange` 类型含 `filters`。
- [ ] `AdminListQuery` 含 `filters?`；`AdminReadRouteDefinition` 含 `filterDimensions?`。
- [ ] `normalizeListQuery` 透传并按 `filterDimensions` 裁剪 `filters`。
- [ ] `useQuery.queryKey` 追加稳定排序后的 `filters`。
- [ ] `listInput` 输出 payload 删除空值，未声明 key 不进入。
- [ ] `loadEvents`/`loadMessages`/`loadKnowledge` 三个 loader 透传 `filters`。
- [ ] `filterRows` 遍历 `filters` 并按 `matcher` 过滤。
- [ ] `core-list-pages.tsx` 与 `operations-read-page.tsx` 的 `FilterBar` 调用传 `extraFilters`。
- [ ] `onFilterChange` 合并 `filters` 而非替换。
- [ ] `pnpm admin:web:verify` 通过；`pnpm verify:all` 通过。
- [ ] `git diff --check` 无尾随空白。

## 7. 实现顺序（依赖关系）

1. `admin-read-contracts.ts`（步骤 2.5）—— 定义 `AdminListQuery.filters`、`FilterDimensionSpec`、`AdminReadRouteDefinition.filterDimensions`。下游所有步骤依赖此类型。
2. `core-page-types.ts`（2.3）+ `operations-pages/types.ts`（2.4）—— 搜索状态类型扩展，依赖 1。
3. `router.tsx`（2.2）—— URL 解析，依赖 1、2。
4. `use-core-page-query.ts`（2.6）—— 规范化与缓存键，依赖 1、2、3。注意 `queryKey` 改动必须与 `normalizeListQuery` 同步提交，否则缓存不一致。
5. `admin-read-pages.ts`（2.7）—— `routeDefinitions` 占位 + `listInput` + 三个 loader，依赖 1、4。
6. `admin-read-formatters.ts`（2.8）—— `filterRows`，依赖 1。
7. `filter-bar.tsx`（2.1）—— UI 模型与槽位，依赖 1。
8. `core-list-pages.tsx`（2.9）+ `operations-read-page.tsx`（2.10）—— 页面接入，依赖 1-7 全部就绪。
9. 运行 `pnpm admin:web:verify` → `pnpm verify:all` → `git diff --check`。

依赖链关键约束：步骤 4 的 `queryKey` 与 `normalizeListQuery` 必须同一提交；步骤 5 的 `listInput` 与三个 loader 必须同一提交，否则会出现「部分列表带 filters、部分不带」的中间态。
