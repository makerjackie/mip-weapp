# admin-web 交互优化验收清单

## 验收标准对照

### 1. 日常高频操作步数明显减少

| 操作 | 改造前 | 改造后 | 状态 |
|------|--------|--------|------|
| 创建活动 | 列表页 → 弹窗内 30+ 字段挤在一起 | 列表页 → 独立页面全屏表单 | ✅ |
| 编辑活动 | 详情抽屉 → 弹窗内 30+ 字段 | 详情抽屉 → 独立页面全屏表单 | ✅ |
| 创建任务 | 列表页 → 弹窗内 8 字段 | 列表页 → 独立页面全屏表单 | ✅ |
| 编辑任务 | 详情抽屉 → 弹窗内 8 字段 | 详情抽屉 → 独立页面全屏表单 | ✅ |
| 创建机会 | 列表页 → 弹窗内嵌套分组 | 列表页 → 独立页面全屏表单 | ✅ |
| 编辑知识内容 | 列表页 → 弹窗内 12+ 字段 | 列表页 → 独立页面全屏表单 | ✅ |
| 状态筛选 | 选状态 → 点筛选按钮 | 选状态即自动筛选 | ✅ |
| 列表排序 | 无排序能力 | 点击列头排序（数值/文本/日期） | ✅ |

### 2. 可点选的控件不要求手动打字

- ✅ 枚举字段使用 Select（活动方式、收费类型、报名方式、审核结果等）
- ✅ 布尔字段使用 Checkbox / Switch（相册开关、必填开关、附件要求）
- ✅ 日期字段使用 DatePicker（开始/结束时间、截止时间）
- ✅ 多选字段使用 multi-select Select（任务等级、成员分配、标签）
- ✅ 报名字段配置使用 RegistrationSchemaEditor（类型下拉、必填勾选）
- ✅ FilterBar 状态筛选使用 Select 下拉

### 3. 每个异步操作都有加载/成功/失败反馈，报错能看懂

- ✅ 按钮提交时 loading 禁用，防止重复提交
- ✅ 写操作成功后 `message.success`（如"保存活动已提交"）
- ✅ 失败使用 `humanizeError` 将错误码映射为中文（VERSION_CONFLICT → "记录已被其他人更新，请刷新后重试"）
- ✅ 版本冲突保留填写内容，提示重新核对
- ✅ 页面首次加载显示 Skeleton
- ✅ 网络错误显示 ErrorState + 重试按钮

### 4. 复杂表单改用独立页面

| 表单 | 载体 | 路由 | 状态 |
|------|------|------|------|
| 活动新建/编辑 | 独立页面 | `/events/$eventId/edit` | ✅ |
| 任务创建/编辑 | 独立页面 | `/tasks/$taskId/edit` | ✅ |
| 机会创建/编辑 | 独立页面 | `/opportunities/$opportunityId/edit` | ✅ |
| 合作卡/超级案例创建编辑 | 独立页面 | `/userContent/$contentId/edit` | ✅ |
| 任务创建/编辑 | 独立页面 | `/tasks/$taskId/edit` | ✅ |
| 知识内容创建/编辑 | 独立页面 | `/knowledge/$contentId/edit` | ✅ |
| 其余 54 个弹窗表单 | 保留弹窗 | — | ✅（见 FORM_AUDIT.md） |

### 5. 全后台交互模式一致

- ✅ 所有列表页使用统一 FilterBar（搜索 + 状态下拉 + 即时筛选 + 清除）
- ✅ 所有列表页使用统一 DataTable（列头排序 + 行选择 + 操作列）
- ✅ 所有状态标签使用统一 StatusTag
- ✅ 所有详情使用统一 DetailDrawer
- ✅ 所有简单操作使用统一 MutationDialog + ConfirmDialog
- ✅ 所有错误反馈使用统一 humanizeError 管道

### 6. 门禁通过

- ✅ `pnpm admin:web:verify` 通过（lint + typecheck + 62 tests + build + responsive）
- ✅ 桌面视口正常（1280×720、1440×900）
- ✅ 手机视口正常（390×844）：筛选项垂直排列、表格横向滚动、弹窗全宽

## 仍需真机/生产验证

- 独立表单页面的实际提交流程需在登录态下验证（demo 模式不提交写操作）
- 活动编辑页的报名字段配置编辑需在真机验证保存后字段不丢失
- 任务编辑页的等级多选需在有 eligible levels 数据的环境验证

## 文件清单

### 新增文件
- `admin-web/INTERACTION_SPEC.md` — 交互规范
- `admin-web/FORM_AUDIT.md` — 弹窗表单排查与载体判定
- `admin-web/ACCEPTANCE.md` — 本验收清单
- `src/shared/ui/humanize-error.ts` — 错误码中文映射
- `src/features/shared/registration-schema-editor.tsx` — 共享报名字段编辑器
- `src/features/form-pages/independent-form-page.tsx` — 独立表单页通用组件
- `src/features/form-pages/event-edit-form-page.tsx` — 活动编辑页
- `src/features/form-pages/event-form-loader.ts` — 活动表单数据加载
- `src/features/form-pages/task-edit-form-page.tsx` — 任务编辑页
- `src/features/form-pages/opportunity-edit-form-page.tsx` — 机会编辑页
- `src/features/form-pages/knowledge-edit-form-page.tsx` — 知识内容编辑页
- `src/features/form-pages/user-content-edit-form-page.tsx` — 合作卡/超级案例编辑页
- `src/features/form-pages/content-form-helpers.ts` — 内容表单默认值工具

### 修改文件
- `src/shared/ui/data-table.tsx` — 增加列排序、行选择、批量操作栏
- `src/shared/ui/filter-bar.tsx` — 状态下拉即时筛选、回车搜索、条件清除
- `src/shared/ui/mutation-dialog.tsx` — 提取 RegistrationSchemaEditor 到共享文件
- `src/shared/ui/index.ts` — 导出 humanizeError
- `src/styles/app.css` — 批量操作栏样式、表单卡片样式、手机适配
- `src/app/router.tsx` — 注册 4 个表单页路由
- `src/app/route-pages.tsx` — 添加表单页路由组件
- `src/features/admin-runtime/admin-operation-provider.tsx` — 接入 humanizeError
- `src/features/admin-runtime/admin-detail-actions.tsx` — 复杂表单改为跳转独立页面
- `src/features/core-pages/core-list-pages.tsx` — 新建活动按钮跳转独立页面
- `src/features/operations-pages/task-management-page.tsx` — 创建任务跳转独立页面
- `src/features/operations-pages/opportunities-content-page.tsx` — 创建机会跳转独立页面
- `src/features/governance-pages/governance-pages.tsx` — 新建知识内容跳转独立页面
