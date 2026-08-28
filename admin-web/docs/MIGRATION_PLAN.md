# React 迁移计划

## 基线与回滚

- 来源仓库：迁移前的本地独立仓库 `mip-admin-web`
- 来源提交：`bf16657 feat(admin): align web console with Workbuddy design`
- 导入方式：不压缩历史的 `git subtree`，迁入 `admin-web/`。
- 原仓库保持不动。任一阶段可回退到 subtree 导入 commit，并继续使用原 Cloudflare Pages 构建。

## 旧 DOM 与 React 并存

底座阶段将原 `src/main.ts` 移到 `src/legacy/main.ts` 作为只读对照，新入口改为 `src/main.tsx`。React 首先接管 AppShell、登录/会话、路由、Query、反馈状态和公共 UI；页面按批次改用既有 `src/modules` 与 `src/services`。

并存期间的规则：

- 生产入口只运行 React，不同时挂载两个根节点。
- legacy 文件不得新增功能、action、字段或样式。
- 每完成一个页面，React 测试和截图取代对应 legacy 行为证据。
- 详情、表单、导出和上传未迁移前，入口明确禁用或标记，不由旧 DOM 跨根节点接管。

## 顺序与退出条件

### 0. 安全导入

完成条件：精确基线、完整历史、排除本地依赖/产物/凭证、独立 commit、原仓库不变。

### 1. 规范与 React 底座

完成内容：`AGENTS.md`、`DESIGN.md`、`ARCHITECTURE.md`、差距分析、Router、QueryClient、ConfigProvider、SessionProvider、错误边界、ResponsiveAppShell 与公共 UI。

退出条件：React 能显示受权限控制的路由壳；demo 与真实模式严格分离；公共状态有 Testing Library 覆盖；生产 build 通过。

### 2. 第一批页面

网站概览、用户管理、活动管理、订单管理。

退出条件：真实 module/service、筛选 URL、分页、四项指标、详情入口、桌面/手机截图和对应测试完成。

### 3. 第二批页面

任务、Banner、素材、战队、机会与内容、成长与勋章。

退出条件：多 section、上传预览、游戏/任务详情和 capability 入口完成；不得复制 validator。

### 4. 第三批页面

权限、消息、知识库、运营记录。

退出条件：多 section 表格、审计/消息/知识状态、权限不足与错误恢复完成。

### 5. 横切交互

所有详情抽屉、写操作表单、确认、敏感导出、上传、登录/退出/恢复、空/错/加载/无权限/冲突。

退出条件：保留 action、幂等键、capability、expectedVersion；mutation 不自动重试；键盘焦点可恢复。

### 6. 删除 legacy

只有同时满足以下条件才删除 `src/legacy/main.ts`：

1. 14 个一级页面均由 React 路由提供。
2. 8 类详情、所有受审写操作入口、导出、上传和会话恢复已迁移。
3. 真实 API 失败不会落到 legacy 或 demo。
4. `pnpm verify`、`pnpm admin:web:verify`、`pnpm verify:all` 全通过。
5. 三种视口和 Workbuddy 左右对照完成，P0/P1/P2 已处理或记录证据边界。

## 每页测试和截图

- module interface 单元测试。
- React 路由与筛选 URL 测试。
- 加载、空、错误、无权限与至少一个成功表格状态。
- 有详情或 mutation 时覆盖打开、校验、确认、失败保留输入和成功失效 query。
- 1280×720、1440×900、390×844 至少各一张代表截图；相同视口对照 Workbuddy。

## 提交策略

导入、规则/底座、每个页面批次、横切交互、QA 修复和文档收口分别提交。提交只包含当前阶段路径；提交前运行对应门禁并检查 staged scope。
