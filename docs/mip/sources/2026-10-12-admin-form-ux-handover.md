# 管理后台小白用户体验优化 · 交接小结（2026-10-12）

> 本文是交接文档：讲清任务背景、已完成、方法、未完成与目标，供后续接手的同事（或 ZCode 会话）直接续作。
> 需求基线（source of truth）见同目录 [2026-10-12-admin-form-ux-prd.md](2026-10-12-admin-form-ux-prd.md)（UX-01~UX-32）。
> 分支：`feature/admin-form-ux`（基于 `main` @ ca587838）。

## 1. 任务背景

管理后台（`admin-web/`）的使用者是不懂技术的运营人员。当前表单存在大量对小白不友好的设计：创建活动要手填经纬度、超级案例要手填标签 ID、各处要填 key/版本号/英文标识、有前置依赖的字段（如标签）没有引导。用户要求：

- 以**小程序字段消费为 source of truth**（小程序端已基本完成，后台较旧、有冗余字段），先整理 PRD 再优化；
- 能不填的不填、能选的不写；每个有前置依赖的字段要有「这个值从哪来、去哪建」的引导；
- 构建「用户模拟（GLM 5.3 Flash）→ 产品经理评审 → 开发实现」的迭代循环，直到挑不出 P0/P1 问题；
- 全程在独立 worktree 分支上进行。

## 2. 已完成

### 2.1 调研与 PRD（commit 247d06e4）

三路并行调研（admin-web 全部表单字段盘点 / 小程序各领域字段实际消费 / 服务端契约与 DB 约束），产出 PRD。关键结论：

- 活动 `latitude/longitude`：服务端与 DB 均可选（仅要求成对），小程序用于详情页「导航」（`wx.openLocation`）→ 保留功能但收进高级区；
- 活动 `summary`：服务端必填但小程序完全不渲染 → 前端免填自动生成；
- 知识库模块小程序零消费 → 本迭代不动，已登记为产品决策项；
- 侮辱性角色文案（皮条客/狗策划等）是历史玩笑文案，与「改品牌后上线」的仓库定位冲突。

### 2.2 实现（commits 9d916558 / 24d2b4e9 / 020397d8）

按 PRD 分三批实现，覆盖 UX-01~UX-21、UX-23~UX-32 的大部分：

| 领域 | 内容 |
| --- | --- |
| 基建 | `OperationField` 新增 `placeholder/extra/emptyHint/advanced`；`RemoteCatalogSelect` 空态引导 + 失败提示；`kind:'time'` → TimePicker（含 dayjs 转换）；`OperationFields` 渲染「高级设置（选填）」折叠区 |
| 活动 | 经纬度/报名截止/取消截止/路线指引进高级折叠区并带获取教程；摘要选填、空则自动截介绍前 120 字；金额定义层统一「元」且仅 PAID 显示；类型/标签下拉空态引导；目录 key 创建自动生成、编辑隐藏；目录弹窗 `catalogId` 隐藏、`kind` 锁定 |
| 内容 | 角色文案双端统一为中性词（商务对接/企业经营者/资本合作/策略策划/视觉设计/交付管理，roleKey 不变）：admin 三处 + 小程序 `mip-catalogs.ts` + 云函数两处映射 + 测试；超级案例城市/行业标签改远程下拉（`mip.admin.opportunities.options` 的 `cities`/`tags`，tags 即行业标签）；能力评分 0–5 提示；机会弹窗定义与独立页对齐（万元 money、标签多选、城市隐藏）；公告关联内容按类型联动下拉（events.list / opportunities.list）；消息定时版本号隐藏预填、label 去掉「(UTC)」 |
| 知识 | 信息源/分类编码创建自动生成隐藏；采集时间 TimePicker；时区改固定下拉（默认 Asia/Shanghai）；视频号字段补获取教程 |
| 治理 | 服务器 branchKey 创建自动生成隐藏；后台账号改「登录账号」+ 帮助文案；capabilities 选项中文化；变更主服务器下拉恒接服务器目录；赛季/盲盒目录/卡片 key 自动生成隐藏 |
| 任务/其他 | 周送达时间（保存+派发）TimePicker；任务模板描述更新；可参与等级空态引导；Banner 跳转地址双格式说明；素材上传页过时文案更新 |

### 2.3 测试与验证证据

- 新增/更新合同测试与 React 测试：摘要自动生成、目录 key 生成隐藏、价格元单位+PAID 联动、高级折叠区渲染、空态引导渲染、branchKey 生成、capabilities 中文、游戏 key 生成、任务 TimePicker 等（`admin-event-mutation-forms.test.ts`、`admin-people-mutation-forms.test.ts`、`admin-game-management.test.ts`、`admin-task-management.test.ts`、`session-user-select.react.test.tsx`、`independent-form-page.react.test.tsx` 等）。
- **admin-web 完整 `pnpm verify`：通过**（lint + typecheck + 179 合同测试 + React 测试 + build + 响应式检查）。
- **根仓库 `pnpm verify`（小程序 + CloudBase）：通过**（含 `src/config/mip-catalogs.ts` 改动）。
- 服务端 `cloudfunctions/mip-admin-api/tests/export.test.js`：13/13 通过（新角色文案）。

## 3. 方法（怎么做的）

1. 先调研后动手：三路并行只读调研（Explore 代理），把「小程序用不用 / 服务端要不要 / 后台现在长什么样」对齐成 PRD，避免瞎改；
2. 修复尽量**下沉到共享定义层**（`modules/*-forms`），同一 action 的弹窗与独立页入口同时受益（PRD 规则 R6）；
3. 技术字段处理原则：创建时前端自动生成并隐藏（key 类）、编辑时只读或隐藏、行上下文预填（版本号/ID 类），**不改动 AdminRequest 契约与数据库**（PRD「不做清单」）；
4. 每批实现跑 typecheck + 相关测试，批末跑完整 verify 门禁；
5. 设计了三角色迭代循环：workflow 内「新手用户模拟 + 产品经理评审」跑在 GLM 5.3-Flash 上（只读走查代码、给 file:line 证据、按 PRD 裁决），开发由主会话（最强模型）承担，每轮通过 AmendWorkflow 衔接。**该循环已搭好但第 1 轮在用户要求下停止，尚未产出任何走查结论。**

## 4. 未完成事项（接手从这里继续）

按优先级：

1. **跑通迭代循环至收敛**：R1 走查（11 个场景清单已写在 workflow 脚本与 PRD 第 7 节）→ 开发修复 → R2 回归 → 直到 PM 判定无新增 P0/P1（上限 3~4 轮）。workflow 脚本模板在本机 `.zcode/workflow-drafts/后台表单小白体验走查-R1.dwf.ts`（内容可从 PRD 第 7 节重建）；注意走查需给代理明确「范围边界」，否则不收敛。
2. **浏览器视觉验收**：`admin-web` demo 模式（`VITE_MIP_ADMIN_DEMO_MODE=true`）起 dev server，对新建/编辑活动、超级案例、公告、任务、知识采集等表单截图（1280×720 / 390×844），确认高级折叠区、空态引导、TimePicker 在桌面与手机视口正常、无横向溢出；可用 visual-judge 代理判定。
3. **终检**：`pnpm admin:web:verify`、`pnpm verify`、`git diff --check`（走查修复后要重跑）。
4. **收尾汇报**：向用户说明改动全貌 + 证据边界（静态/测试级已验，浏览器级与生产登录态未验）。
5. **遗留产品决策项**（不在本迭代，需用户拍板）：
   - 知识库模块小程序零消费，建议整体下线/隐藏（涉及路由、权限、BFF、云函数）；
   - 合作卡烘焙底图（`src/components/mip-cooperation-card/model.ts` 的 variant 名与美术图）仍是旧角色名，需要新美术资源才能换；
   - 角色 key 英文 slug 未变（只改了展示文案），若要连 key 一起换是数据迁移级变更。

## 5. 目标与完成定义

- 目标：管理后台所有创建/编辑表单对不懂技术的运营「能顺利填完并提交」——无手填 ID/key/版本号、无技术黑话、前置依赖有引导、小程序不消费的字段不让用户填。
- 完成定义（PRD 第 5 节）：每项 P0/P1 有测试覆盖；`pnpm admin:web:verify` 与 `pnpm verify` 全绿；390px 无横向溢出；静态检查无「required + 裸 text 的 *Id/*Key/expectedVersion」残留；走查循环收敛（一轮无新增 P0/P1）。

## 6. 交接操作指引

- 本分支 worktree（本机）：`/Users/oudouglas/project/mip-weapp/.worktrees/admin-form-ux`；
- 首次进入 worktree 需 `pnpm install`（pnpm workspace，store 共享，较快）；
- 验证命令一律从**仓库根目录**执行：`pnpm admin:web:verify`、`pnpm verify`；
- 后台唯一验收标准是 `admin-web/ACCEPTANCE.md`；PRD 是需求输入材料，不是平行验收表；
- 双端联动：改 admin 字段时同步检查小程序（`src/`）与云函数（`cloudfunctions/`）——本次角色文案就是三处同步的先例。
