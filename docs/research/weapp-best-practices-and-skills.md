# 微信小程序最佳实践与 Agent Skills 调研

> 调研日期：2026-08-30
> 范围：原生微信小程序、微信云开发、开发者工具与编码 Agent Skill。本文不讨论 Taro、uni-app、React 小程序方案。

## 结论

当前没有一个公开、知名且适合直接覆盖本仓库全部约束的“原生微信小程序最佳实践 Skill”。本仓库已经有按技术栈和业务边界定制的 [`weapp-development`](../../.agents/skills/weapp-development/SKILL.md)、[`weapp-design`](../../.agents/skills/weapp-design/SKILL.md)、[`weapp-runtime-qa`](../../.agents/skills/weapp-runtime-qa/SKILL.md)、[`weapp-cloudbase`](../../.agents/skills/weapp-cloudbase/SKILL.md) 等本地 Skill，直接安装通用 Skill 会产生重复或冲突。

建议：

1. **当前不新增第三方 Skill。** 先把本次调研中可验证的官方规则补入现有本地 Skill 和自动检查。
2. **暂不安装官方 Skyline Skills。** 它是目前最可信、最专门的微信小程序 Agent Skill，但只覆盖 Skyline；当前工程仍是原生 WebView / `glass-easel` 路线，并未启用 Skyline renderer。[微信 Skyline Skills 官方文档](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/skills.html) · [GitHub](https://github.com/wechat-miniprogram/skyline-skills)
3. **如果以后决定迁移 Skyline，再安装官方包。** 建议先使用 `skyline-overview` 评估迁移成本，再按需安装 config、components、wxss、route 等子 Skill，不要为了“有 Skill”提前改变渲染架构。
4. **如果以后需要更强的开发者工具自动化，优先评估微信开发者工具 Nightly 内置 Skill。** 它属于工具能力，不应复制为仓库业务规范；本次检查未发现 `wechatide` 或内置 `miniprogram-dev-skill`，因此不能把官方 Agent 工作流记为当前可用。Nightly 的稳定性和账号授权仍需单独评估。[Nightly 下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/nightly_backup.html)

## 用户指出的顶部安全边距问题

这个判断是正确的：基本页面骨架、安全区域、系统胶囊避让不应由某个业务页面独立发挥。

当前工程只有 [`events`](../../src/pages/events/index.json) 和 [`opportunities`](../../src/pages/opportunities/index.json) 设置了 `navigationStyle: "custom"`，其他主页面使用微信默认导航栏。因此：

- 默认导航栏页面由微信处理顶部系统区域，不需要再人为增加一套自定义导航高度。
- 活动和机会页面要自行处理状态栏、右上角胶囊和导航内容高度。
- 审计前，两个页面分别复制了一套状态栏占位与自定义导航结构。虽然都调用了 [`status-bar.ts`](../../src/platform/navigation/status-bar.ts)，页面级重复实现仍会导致间距和运行时回退逻辑漂移。本轮已将状态栏占位收口到 [`app-top-safe-area`](../../src/components/top-safe-area/index.ts)，活动与机会页只保留各自不同的业务导航内容。

微信官方要求为固定在右上角的小程序菜单预留空间，并强调跨页面保持导航与控件一致。[微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/) 页面配置也明确说明，`navigationStyle: "custom"` 只保留右上角胶囊，意味着其余导航区域由开发者负责。[页面配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/page.html)

本轮整改：

1. [`app-top-safe-area`](../../src/components/top-safe-area/index.ts) 统一从平台层读取顶部几何，并在组件首次渲染和页面再次显示时同步。
2. [`status-bar.ts`](../../src/platform/navigation/status-bar.ts) 同时兼容 `statusBarHeight` 和 `safeArea.top`。官方说明部分机型不会返回 `safeArea`，所以实现继续保留状态栏回退；靠近右上角胶囊的完整导航内容仍使用 `wx.getMenuButtonBoundingClientRect()`。[`wx.getWindowInfo`](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html) · [`wx.getMenuButtonBoundingClientRect`](https://developers.weixin.qq.com/miniprogram/dev/api/ui/menu/wx.getMenuButtonBoundingClientRect.html)
3. 静态测试会扫描所有 `navigationStyle: custom` 页面，要求注册并渲染共享组件，同时禁止页面直接读取顶部几何。
4. `weapp-design` Skill 已写入同一约束，减少后续实现再次分叉。

仍需在真机验收中覆盖有刘海或灵动岛的 iPhone、普通 Android、Mac/Windows 可调整窗口。只有后续出现更多导航内容和高度都相同的页面时，再进一步抽取完整导航壳；当前不为两个业务头部提前制造插槽抽象。

这里不是“机会业务比较特殊”，而是它属于少数启用自定义导航的页面，系统级布局职责被下放到了页面。正确修复位置应是共享页面壳，而不是继续给机会页面叠加一个偶然可用的 `padding-top`。

## 官方最佳实践基线

### 1. 导航、反馈与一致性

- 固定小程序菜单区域必须预留空间，次级页面应有明确返回路径；页面内导航应简单，并在不同页面保持一致。[微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/)
- 等待时要及时反馈；不同页面应使用一致的控件与交互方式，避免页面跳动和重新学习。[微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/)
- 移动端控件需要足够的点击热区，官方设计指南给出的物理尺寸参考约为 7–9mm。[微信小程序设计指南](https://developers.weixin.qq.com/miniprogram/design/)

对本仓库的含义：加载、空、错、权限不足、未绑定手机号等状态应继续使用共享组件；安全边距和导航同样要进入共享组件，而不是只统一颜色和按钮。

### 2. 分包、按需注入与包体

- 微信官方称分包加载是优化启动耗时最明显的手段之一，并建议按功能、使用频率和场景划分分包；单个代码包上限为 2MB。[代码包体积优化](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/start_optimizeA.html)
- `tabBar` 页面必须在主包内；普通分包只能同步引用主包或本分包资源，不能同步引用其他普通分包资源。[使用分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)
- `lazyCodeLoading: "requiredComponents"` 会只注入当前页面需要的页面和组件代码；未使用组件不应继续声明，低频组件不宜全局注册。[按需注入和用时注入](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/lazyload.html)
- 大图片、音频、视频和字体不宜放入代码包；官方建议代码包主要保留小体积图标，其他资源使用 CDN。[代码包体积优化](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/start_optimizeA.html)

当前工程已将会员和管理端拆为分包，并启用了 `lazyCodeLoading: "requiredComponents"`，方向正确。[`src/app.json`](../../src/app.json) 后续重点应是持续执行包体预算、清理未用组件声明与避免大型演示素材进入主包，而不是继续为目录数量拆包。

### 3. 渲染与 `setData`

- `setData` 的主要成本与组件 Shadow Tree 总节点量和更新数据量有关；官方建议合理拆分组件、降低更新频率、合并连续更新、只传变化字段，不要 `this.setData(this.data)`。[合理使用 setData](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html)
- 后台页面的高频更新会与前台页面竞争逻辑层和渲染层资源，应暂停或延后到页面重新展示。[合理使用 setData](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html)
- 官方体验评分参考包括：首屏主要内容不超过 5 秒、每秒 `setData` 不超过 20 次、单次序列化数据不超过 256KB、单页 WXML 节点少于 1000 个。[性能评分](https://developers.weixin.qq.com/miniprogram/dev/framework/audits/performance.html)

对本仓库的含义：Tab 切回时应保留可用内容并在后台刷新；长列表、筛选器和管理端大表应关注分页、节点数量和增量更新。静态测试不能替代开发者工具性能面板和真机数据。

### 4. 服务端事实与安全

- 微信官方明确指出，小程序前端代码可被获取和反混淆，必要的数据校验、重要业务逻辑、鉴权应放在后台或云函数；隐藏页面或按钮不能替代服务端鉴权。[安全指引](https://developers.weixin.qq.com/miniprogram/dev/framework/security.html)
- AppSecret、后台密钥、手机号等敏感信息不得以明文、注释、Base64 等方式出现在小程序包中；展示敏感数据应脱敏。[安全指引](https://developers.weixin.qq.com/miniprogram/dev/framework/security.html)

本仓库规定“会员、活动资格、订单和支付权益由服务端决定”与官方方向一致。[`AGENTS.md`](../../AGENTS.md) 后续审计应继续检查页面是否绕过 module / cloud function、云函数是否逐请求鉴权，以及日志和 seed 是否包含真实敏感信息。

## 公开 Skill 评估

安装量与仓库数据是 2026-08-30 的快照，会随时间变化。安装量来自 [skills.sh](https://skills.sh/)，仓库规模和维护记录来自相应 GitHub 仓库。

| 候选 | 快照 | 适配判断 | 建议 |
| --- | --- | --- | --- |
| [`wechat-miniprogram/skyline-skills`](https://github.com/wechat-miniprogram/skyline-skills) | 微信官方组织；约 5.6K 总安装、51 stars、15 commits；最近提交 2026-06-03；skills.sh 三方安全审计均通过。[skills.sh](https://skills.sh/wechat-miniprogram/skyline-skills) | 高可信，但只覆盖 Skyline 的配置、组件、WXSS、Worklet、路由和滚动 API。当前工程未使用 Skyline。 | **条件推荐**：迁移 Skyline 时安装；当前不安装。 |
| [`TencentCloudBase/skills` 的 `miniprogram-development`](https://github.com/TencentCloudBase/skills/tree/main/skills/miniprogram-development) | 4.2K installs、75 stars；最近提交 2026-08-28；skills.sh 显示两项通过、一项 Snyk Warn。[skills.sh](https://skills.sh/tencentcloudbase/skills/miniprogram-development) | 覆盖开发、调试、CloudBase、发布和搜索优化，但范围过宽，依赖多个 sibling skills；其中“默认采用纯文字自定义 TabBar”等偏好与本仓库带品牌图标的 TabBar 和现有设计规范冲突。 | **不整包安装**：仅在需要 Nightly、消息推送或搜索收录时审阅相应 reference，把验证过的规则合入本地 Skill。 |
| [`wechat-miniprogram/ai-mode-skills`](https://github.com/wechat-miniprogram/ai-mode-skills) | 微信官方组织；约 170 总安装、约 190 stars、31 commits；最近提交 2026-07-28。[skills.sh](https://skills.sh/wechat-miniprogram/ai-mode-skills) | 用于把小程序能力改造成 `wx.modelContext` 原子接口/组件并验证 AI Mode Skill，不是普通页面与安全边距最佳实践。[仓库说明](https://github.com/wechat-miniprogram/ai-mode-skills#readme) | **不安装**，除非产品明确接入微信“小程序 AI 开发模式”。 |
| [`TencentCloudBase/mp-skills`](https://github.com/TencentCloudBase/mp-skills) | 307 总安装、9 stars；最近提交 2026-06-22。[skills.sh](https://skills.sh/tencentcloudbase/mp-skills) | 是发现、生成、安装和评测小程序 AI 业务 Skill 的 CLI，不是编码 Agent 的原生页面最佳实践包。[仓库说明](https://github.com/TencentCloudBase/mp-skills#readme) | **不安装**。 |
| [`TencentCloudBase/awesome-miniprogram-skills`](https://github.com/TencentCloudBase/awesome-miniprogram-skills) | 59 总安装、34 stars、132 commits；最近提交 2026-06-18。[skills.sh](https://skills.sh/tencentcloudbase/awesome-miniprogram-skills) | 是旅行、支付、订单等 AI Mode 业务 Skill 示例集合，会向小程序加入 skills 分包、接口和组件，不是工程规范。[仓库说明](https://github.com/TencentCloudBase/awesome-miniprogram-skills#readme) | **不安装**。 |
| [`mzopedia/develop-wechat-ai-miniprograms`](https://github.com/mzopedia/develop-wechat-ai-miniprograms) | 0 stars、5 commits；最近提交 2026-07-26；skills.sh 尚未收录。[GitHub](https://github.com/mzopedia/develop-wechat-ai-miniprograms) | 包含预检和发布 SOP，但样本、采用度和维护证据不足，并与本仓库现有 runtime/CloudBase/release Skill 大量重叠。 | **不安装**。 |
| [`yfmeii/weapp-dev-mcp`](https://github.com/yfmeii/weapp-dev-mcp) | 172 stars、59 commits；README 已明确建议迁移到微信开发者工具官方 Skill。[GitHub](https://github.com/yfmeii/weapp-dev-mcp) | 是 MCP 自动化服务，不是最佳实践 Skill；本仓库已有 `miniprogram-automator` runtime harness，再加一套连接层会增加维护面。 | **不安装**；需要新工具能力时优先官方 Nightly。 |

## 建议合入现有本地 Skill 的规则

不需要新增一个“大而全”的 Skill。更合理的是在现有职责中补以下小规则：

### `weapp-design`

- 自定义导航页面必须使用共享导航组件。
- 顶部使用运行时状态栏与胶囊几何，底部使用 safe-area inset；禁止只靠固定 `padding-top`。
- 统一页面壳、加载/空/错态和最小点击热区。

### `weapp-development`

- 新增 `navigationStyle: custom` 时同步注册 runtime 覆盖并通过自定义导航静态检查。
- 避免全局注册低频组件；页面只声明实际使用的组件。
- 页面更新只发送变化字段，禁止高频滚动 `setData` 和整棵 data 回传。

### `weapp-runtime-qa`

- 自定义导航覆盖 iPhone 刘海/灵动岛、Android、桌面可调整窗口。
- 截图验收除内容外，必须检查状态栏/胶囊重叠、底部安全区、固定操作栏遮挡、系统字体缩放。
- 性能验收区分冷启动、Tab 切换、二级页首次进入和返回缓存；记录控制台、网络与页面截图证据。

### 自动门禁

- `navigationStyle: custom` 页面只能引用共享导航壳。
- 跟踪主包及每个分包体积，不只检查总包。
- 扫描前端密钥、AppSecret 和直连敏感管理接口。
- 对高风险页面保留真实 DevTools journey，而不是只用 WXML 文本断言。

## 安装决策

| 时间 | 决策 |
| --- | --- |
| 现在 | 不安装新的公共 Skill；修复并收口共享页面壳，把官方规则写入现有本地 Skill 和质量门禁。 |
| 需要官方 DevTools Agent 自动化时 | 先在独立环境评估 Nightly 内置 `miniprogram-dev-skill`，确认稳定性后再决定是否作为团队工具要求。 |
| 确认迁移 Skyline 时 | 安装 `wechat-miniprogram/skyline-skills`，先跑 `skyline-overview` 做迁移评估。 |
| 接入微信小程序 AI 开发模式时 | 再评估 `wechat-miniprogram/ai-mode-skills`；不要把它与普通编码 Agent Skill 混为一谈。 |
