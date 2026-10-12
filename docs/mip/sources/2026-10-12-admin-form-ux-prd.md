# 管理后台表单小白用户化 PRD（2026-10-12）

> 定位：**需求输入材料**（snapshot），不是验收标准。后台唯一验收标准仍是 [admin-web/ACCEPTANCE.md](../../../admin-web/ACCEPTANCE.md)。
> 依据：小程序端字段消费盘点（src/）、服务端契约（packages/admin-contracts、cloudfunctions、database/mysql/mip）、admin-web 表单现状盘点（2026-10-12，分支 feature/admin-form-ux）。

## 1. 背景与用户画像

- 使用管理后台的是**不懂技术的运营人员**：不知道什么是 ID、UUID、key、版本号、坐标、UTC、分（货币单位）。
- 原则：**能不让他填的就不让他填；能选的不让他写；每个有前置依赖的字段必须当场告诉他依赖从哪来、去哪建。**
- 小程序端功能已基本完成，是字段层面的 source of truth：小程序不消费的字段不应让运营填写；小程序要用的字段必须能被运营顺利配出来。

## 2. Source of truth 关键结论（调研摘要）

| 事实 | 结论 |
| --- | --- |
| 活动 `latitude/longitude`：服务端与 DB 均可空（仅需成对），小程序用于详情页「导航」按钮（`wx.openLocation`） | 功能保留，但不允许裸填数字对 |
| 活动 `summary`：服务端必填（≤300），小程序列表/详情**完全不渲染** | 前端免填，提交时自动生成 |
| 活动 `eventTypeKey`/`tags`：小程序详情页展示类型标签与标签 chip | 保留，必须下拉选择 + 空态引导 |
| 超级案例 `cityTagId/industryTagId`：小程序按目录解析城市展示 | 改下拉，禁止手填 ID |
| `eligibleLevelIds`（任务）：小程序端零消费，服务端字段 | 保留选填，加引导，不删 |
| 知识库模块：小程序端**完全无消费**（无页面、无模块） | 本迭代不处理；建议产品决策后整体下线/隐藏（已登记到第 6 节） |
| 各表 `expectedVersion`/`status`/`version`：服务端默认或行上下文可得 | 一律不暴露给用户 |
| 金额：DB 以分存储，服务端校验分值 | 前端一律用「元」（机会按产品语义用「万元」），定义层统一 |
| 角色文案 `皮条客/生意佬/暴发户/狗策划/死美工/老保姆`：小程序 `src/config/mip-catalogs.ts` 与 admin 两处一致使用，key 为英文 slug | 展示文案双端同步替换为专业文案，key 不变 |

## 3. 通用规则（所有表单适用）

- **R1 能选不填**：可枚举/可关联的值一律用下拉（远程目录或静态枚举），禁止手填 ID/UUID/key。
- **R2 能省不问**：服务端有默认值、或可从上下文/其他字段推导的字段，不暴露；必须暴露的放「高级设置」折叠区（默认收起）。
- **R3 前置依赖必有引导**：每个远程下拉的空态与加载失败态必须说明「选项从哪来、去哪里创建」（写明页面与按钮位置）；关联类字段在选择类型后联动出对应内容下拉。
- **R4 技术字段不出现在表单**：内部标识（各类 key、expectedVersion、行 ID）创建时自动生成或隐藏，编辑时只读展示（带说明），操作弹窗从行上下文预填。
- **R5 单位与格式人性化**：金额用元/万元并写明单位；时间一律用选择器（含 HH:mm）；不出现「UTC」「（分）」等技术词；校验前置到表单层并给出人话错误提示。
- **R6 修在定义层**：字段增强（label、控件、选项、提示）尽量下沉到 `modules/*-forms` 共享定义，页面只做页面级行为；同一 action 的弹窗与独立页面入口体验一致。

## 4. 需求清单

严重度：P0 = 直接造成小白无法完成/填错；P1 = 明显困惑或易错；P2 = 体验打磨。

### 4.1 活动域

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-01 (P0) | 活动表单经纬度 | 裸 InputNumber「纬度/经度」，无提示、无地图、成对校验仅在提交后 | 移入「高级设置（选填）」折叠面板，默认收起；带说明文案 | 新增折叠分组能力或页面级 Collapse；说明：用途（填后小程序详情页出现「导航」按钮打开地图）、获取方式（微信里把位置卡片发给自己/电脑，或腾讯地图搜地点复制坐标）、示例格式；表单层成对校验（都填或都空）+ 范围校验前置 | 小程序 `wx.openLocation` 消费；服务端/DB 可空 |
| UX-02 (P0) | 活动 summary 必填 | 必填 textarea，但小程序不渲染 | 改选填；提交为空时自动取 description 前 120 字（服务端 ≤300） | `event-edit-form-page.tsx` buildInput 与共享校验处兜底；列表页若有 events.save 弹窗入口同样兜底 | 小程序无消费；服务端必填 |
| UX-03 (P0) | 活动类型/标签空态无引导 | 下拉为空时不知道选项从哪来 | 空态提示「暂无可选××，可在 活动 页『新建活动目录』中创建」 | `RemoteCatalogSelect` 支持 `emptyHint`；接入活动类型、活动标签、更新标签弹窗 | R3 |
| UX-04 (P0) | 活动目录 key 手填 | 「目录标识」要求手填 `[A-Za-z0-9_.:-]+` | 创建时隐藏并自动生成（如 `web-tag-<random>`）；编辑时只读展示 | 服务端创建要求 key 存在，前端生成即可；编辑态 readOnly + 说明 | R4 |
| UX-05 (P0) | 活动目录弹窗 catalogId/version 可见可改 | 目录状态变更/归档弹窗要手填目录 ID + 版本号 | hidden + 从行上下文预填 | 对齐 `participants.cancel` 模式（operation-model 预填） | R4 |
| UX-06 (P0) | 审核报名/确认签到/撤销签到弹窗暴露 eventId/registrationId/expectedVersion | 三个必填技术字段直接可见 | 全部 hidden + 行上下文预填 | `prefillEventValues`（operation-model.ts:479）确认/扩展覆盖；确认所有入口都有行上下文 | R4 |
| UX-07 (P1) | priceCents 单位 | 弹窗定义层仍是「金额（分）」number；页面层才转元 | 定义层 money +「金额（元）」；PAID 时才显示并前置必填校验 | 下沉页面增强到 `admin-event-mutation-forms.ts` | R5/R6 |
| UX-08 (P1) | 活动地点相关字段提示 | venueName/address/cityName/onlineUrl/guideUrl 无 placeholder，https 校验提交后才报 | 补 placeholder 与格式提示（如「以 https:// 开头」）；城市与列表筛选城市一致性提示 | definition 层 placeholder 支持（OperationField 增加属性或页面注入） | R5 |

### 4.2 机会与用户内容域

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-09 (P0) | 合作角色侮辱性文案 | 「皮条客/生意佬/暴发户/狗策划/死美工/老保姆」，admin 两处（页面 options、read-formatters/admin-details 映射）+ 小程序 `mip-catalogs.ts` | 双端展示文案统一替换为专业词：connector=商务对接、business_builder=企业经营者、capital_operator=资本合作、strategist=策略策划、visual_designer=视觉设计、delivery_lead=交付管理；**roleKey 值不变** | 纯展示文案；admin 三处 + 小程序一处 + 相关测试断言更新 | 品牌可上线性；小白用户观感 |
| UX-10 (P0) | 超级案例城市/行业标签手填 ID | `draft.cityTagId/industryTagId` 为裸 idField | 改远程下拉，数据源与机会一致（`mip.admin.opportunities.options` 的城市/行业标签 optionsKey，dev 确认键名）；空态引导到机会目录维护处 | user-content 页面增强或定义层改造；`user-content-editor.ts` 回填 | R1/R3 |
| UX-11 (P0) | 机会表单弹窗定义层手填/技术字段 | `content-mutation-forms.ts:406` 弹窗定义：城市标签 idField、金额（分）integer、tagIds id-list、roleKeys 英文 slug | 弹窗定义层与独立页对齐：城市下拉、金额（万元）money、标签多选下拉、角色中文 label | 增强下沉定义层（R6）；检查弹窗入口是否仍可达 | R6 |
| UX-12 (P1) | 案例类型 caseType 无引导 | 自由文本 | placeholder 示例（如「品牌发布 / 联合策展 / 跨界合作」）；长度提示 | definition 层 | R5 |
| UX-13 (P1) | abilityScores 无范围说明 | 0–5 整数（页面报告误写 0-10，以服务端 0-5 为准） | label/extra 写明「0–5 分」；校验前置 | 服务端 normalizeDraft 0-5 | R5 |

### 4.3 公告与消息域

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-14 (P0) | 公告关联内容手填 ID | 选「关联类型=活动/机会」后要手填目标 ID | 按 targetType 联动远程下拉（活动/机会列表，显示标题），空态引导 | `optionsActionByValue` 机制已有（roles.set scopeId 用）；确认列表 action 与 optionsKey；空态提示 | R1/R3 |
| UX-15 (P1) | 消息定时计划版本手填 | expectedDispatchVersion 必填 integer | hidden + 行上下文预填 | operation-model 预填 | R4 |
| UX-16 (P1) | 「定时发布时间（UTC）」 | label 带 UTC，控件是本地时间选择器 | label「定时发布时间」+ extra 说明按北京时间执行；确认服务端时区语义后决定是否需要转换（不可改变提交语义） | 先只改文案+说明；语义由 dev 验证 | R5 |

### 4.4 任务域

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-17 (P1) | weeklyDeliverAt 手填 HH:mm 文本 | 保存与派发两处均为裸 Input | TimePicker（HH:mm）控件，提交仍产 HH:mm 字符串 | OperationField kind 'time' 映射到 TimePicker | R5 |
| UX-18 (P1) | 任务模板图片描述过时 | 描述仍写「可使用素材上传页返回的素材 ID」 | 描述改为「上传任务模板图片，成员完成时可下载」 | `admin-task-management.ts:401` | R3 |
| UX-19 (P2) | 可参与等级空态 | 选项来自会员等级配置，为空时无引导 | 空态提示「暂无可选等级；等级在 会员配置 → 等级 中维护」 | emptyHint 接入 | R3 |

### 4.5 知识库域（小程序无消费，仅做表单止血）

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-20 (P1) | 信息源/分类「唯一编码」手填 | sourceKey/categoryKey 必填手填 | 创建时自动生成并隐藏；编辑只读 | 前端生成（同 UX-04） | R4 |
| UX-21 (P1) | 采集计划 dailyTime/timeZone 手填 | time 裸 Input + 时区自由文本 | dailyTime→TimePicker；timeZone→Select（默认 Asia/Shanghai，含常用时区），或隐藏默认+说明 | definition 层 | R5 |
| UX-22 (P2) | 知识商品价格（分） | integer「价格（分）」 | 定义层 money「价格（元）」 | `content-mutation-forms.ts:422` | R5 |
| UX-23 (P2) | 视频号字段无引导 | channelFinderUserName/channelFeedId、视频页 finderUserName/feedId 手填，sph 校验提交后才报 | placeholder+extra：写明「视频号主页的账号名（以 sph 开头）」与获取路径；前端 pattern 校验前置 | definition/页面层 | R5 |

### 4.6 权限与治理域

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-24 (P1) | 服务器 branchKey 手填 | 创建服务器必填「服务器标识」 | 创建时自动生成并隐藏；编辑只读展示 | 前端生成（小写字母数字连字符） | R4 |
| UX-25 (P1) | 后台账号 loginAccount 无提示 | 手填必填，登录要用 | 保留手填（有业务语义），加帮助「登录后台用的账号名，创建后不可修改；建议用姓名拼音或工号」 | extra 文案 | R3 |
| UX-26 (P1) | 角色权限策略 capabilities 显示英文 key | 多选 value=label=capability key | 选项用中文 capabilityLabels（value 不变） | `admin-people-mutation-forms.ts` CAPABILITY_OPTIONS 接 labels | R1 |
| UX-27 (P1) | 赛季/盲盒目录/盲盒卡片 key 手填 | seasonKey/catalogKey/cardKey 必填手填 | 创建自动生成隐藏；编辑只读 | 前端生成（同 UX-04） | R4 |
| UX-28 (P2) | 变更主服务器下拉可能为空 | options 仅详情带 primaryBranchOptions 时注入 | options 恒接 `mip.admin.branches.list`；空态引导「服务器在 权限 → 服务器 中创建」 | definition 层 | R3 |
| UX-29 (P2) | 勋章撤销 awardId 手填 | 从行打开时仍可见必填 | hidden + 行上下文预填 | operation-model | R4 |

### 4.7 通用基建

| # | 项 | 现状与问题 | 目标 | 实现要点 | 依据 |
| --- | --- | --- | --- | --- | --- |
| UX-30 (P0) | RemoteCatalogSelect 空态/失败态 | 空目录下拉无内容、无引导 | 支持 `emptyHint`（含创建入口指引）；加载失败显示可重试提示 | `session-user-select.tsx` | R3 |
| UX-31 (P2) | Banner 跳转地址无区分提示 | targetValue 单一 label | 按 targetType 联动 placeholder/extra（小程序路径示例 vs 公众号文章链接） | banner-management | R5 |
| UX-32 (P2) | 素材上传页过时文案 | 「将素材 ID 填入对应字段」为手填时代残留 | 更新说明为「上传后可在各表单中直接选择使用」 | `media-upload-page.tsx:141` | R3 |

## 5. 验收要点（工程口径）

1. 每项 P0/P1 有对应 vitest 覆盖（沿用现有 `*.react.test.tsx` / `*.test.ts` 模式），断言字段可见性、预填、选项来源与提示文案。
2. `pnpm admin:web:verify` 全绿；UX-09 涉及小程序则 `pnpm verify` 全绿。
3. 390px 视口不横向溢出（新增折叠区/提示不破坏响应式）。
4. 静态检查：表单定义中不再存在「required + 裸 text 的 *Id$ / *Key$ / expectedVersion 字段」（允许 hidden/readOnly）。
5. 每项改动不改变 AdminRequest 载荷语义（自动生成 key、自动 summary 属于合法载荷构造）。

## 6. 明确不做（本迭代）与遗留建议

- **知识库模块整体下线/隐藏**：小程序零消费，建议产品决策后单独迭代（涉及路由、权限、云函数、BFF）。
- **服务端契约与 DB 变更**：全部需求纯前端可达成；不为表单体验改契约。
- **弹窗 vs 独立页面载体调整**：已有 FORM_AUDIT.md 判定，不重开。
- **eligibleLevelIds 移除**：服务端字段，保留。
- **活动类型/标签筛选在小程序端接入**：网关已有、UI 未用，属小程序产品决策，不在后台迭代内。

## 7. 迭代流程（用户要求的三角色循环）

- **用户模拟**（GLM 5.3-Flash 子代理）：以「不懂技术的运营新手」人设，按场景走查当前实现的表单定义与渲染逻辑，输出「看不懂/不会填/不知道去哪」的问题清单（带代码证据）。
- **产品经理评审**（子代理）：对照本 PRD 逐条裁决用户问题（真问题/超出范围/已满足），给出修复优先级。
- **开发**（主会话模型）：按裁决实现修复，跑 `pnpm admin:web:verify`。
- 循环至一轮走查后 PM 判定无新增 P0/P1，或达到轮次上限；最终由主会话做浏览器视觉验收与提交。
