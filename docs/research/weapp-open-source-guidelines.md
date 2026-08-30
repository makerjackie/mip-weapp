# 微信小程序开源工程规范调研

> 调研日期：2026-08-30
> 范围：微信官方文档、微信/Tencent 官方原生小程序仓库、与本仓库技术栈直接相关的活跃工具链，以及少量成熟社区项目。Stars 和更新时间只用于说明样本状态，不作为推荐依据。

## 结论

微信没有一份集中式的“生产级小程序最佳实践手册”。平台事实分散在性能、配置、组件、自动化、CI、体验评分和 API 文档中；官方 GitHub 仓库通常也没有 `AGENTS.md` 或 `CLAUDE.md`，工程要求主要体现在 `CONTRIBUTING.md`、`package.json`、Lint、Git hooks 和 CI。

对 MIP 最有价值的参考顺序是：

1. 微信官方文档决定平台事实和兼容边界。
2. `weapp-vite` 的 `AGENTS.md` 最接近当前构建链和 Agent 协作方式。
3. `Tencent/tdesign-miniprogram` 是原生小程序工程治理最完整的公开样本。
4. `weapp-tailwindcss` 展示了“短根规则 + 就近目录规则 + 专用 Skill”的组织方式。
5. `vant-weapp`、官方测试工具和 Taro 可补充测试、CI、发布和依赖治理经验，但不能作为 MIP 的实现框架。

因此，不建议把某个公共“微信小程序最佳实践 Skill”整包当成项目宪法。更合理的方式是：保留 MIP 当前项目级 `AGENTS.md` 和领域 Skills，以官方文档校准规则，再从下面的仓库选择可执行门禁。

## 官方平台规范

### 代码包与启动性能

微信官方建议所有小程序合理使用分包，按功能、使用频率和场景拆分页面；同时避免把低使用率组件注册为全局组件。全局组件会影响主包大小、启动注入和按需注入效果。

- [代码包体积优化](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/start_optimizeA.html)
- [使用分包](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)
- [全局配置：`subpackages`、`lazyCodeLoading`、`usingComponents`](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)

可转化为仓库门禁：

- 主包、会员分包、管理分包分别设置大小预算，并检查每次改动的增量。
- 组件默认在页面或分包配置中注册；只有高覆盖率基础组件才能进入全局 `usingComponents`。
- 保持 `lazyCodeLoading: "requiredComponents"`，新增分包时检查跨包依赖是否符合微信引用规则。
- 大图片、视频、字体不进入代码包；本地仅保留必要图标和关键首屏资源。

### 数据更新与页面运行时

微信官方指出，`setData` 的成本受组件树规模和更新数据量影响，要求控制调用频率、合并连续更新、只传变化字段，避免在滚动回调中高频更新。

- [合理使用 `setData`](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html)

可转化为仓库规则：

- 页面只把渲染所需数据放入 `data`，领域对象、缓存和不可见中间状态不整包塞入页面数据。
- 不允许 `this.setData(this.data)`；连续状态更新应合并。
- `onShow` 返回页面时优先保留已有内容并后台刷新，除非事实已失效，不要主动清空页面制造白屏。
- 长列表应分页或虚拟化，滚动事件不得直接高频 `setData`。

### 自定义导航、安全区与可调整窗口

`navigationStyle: "custom"` 只保留右上角胶囊，页面必须自己处理状态栏和胶囊几何。`safeArea` 在部分设备可能不存在，代码必须兼容缺失字段；固定底部交互控件也必须避开 Home Indicator。PC 小程序和 iPad 还可能发生窗口尺寸变化。

- [全局配置：`navigationStyle` 与 `resizable`](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)
- [`wx.getWindowInfo`](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html)
- [`wx.getMenuButtonBoundingClientRect`](https://developers.weixin.qq.com/miniprogram/dev/api/ui/menu/wx.getMenuButtonBoundingClientRect.html)
- [体验评分：安全区域和窗口变化适配](https://developers.weixin.qq.com/miniprogram/dev/framework/audits/accessibility.html)

可转化为仓库门禁：

- 所有自定义导航页面使用同一个安全区/导航壳，禁止页面自行写固定顶部 `padding`。
- 固定底栏统一使用 `env(safe-area-inset-bottom)` 或共享组件，并确保最后一项内容能滚动到操作栏上方。
- 对手机、PC 可调整窗口分别保留截图或运行证据；不能用一个 375 px 截图证明桌面适配。

### 自动化、CI 与真机

微信官方自动化 SDK 提供外部脚本控制小程序的能力，`miniprogram-ci` 提供预览、上传和包信息等接口。自动化并不能替代手机号、支付、订阅消息和扫码等真机能力验收。

- [小程序自动化](https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/)
- [小程序 CI](https://developers.weixin.qq.com/miniprogram/dev/devtools/ci.html)

公开 GitHub 上不存在官方的 `wechat-miniprogram/miniprogram-ci` 源仓库；官方来源是微信文档和发布到 npm 的包，不应把同名第三方仓库当作官方规范。

## 开源候选清单

| 项目 | 类型与快照 | 最值得借鉴 | 不应照搬 |
| --- | --- | --- | --- |
| [`wechat-miniprogram/miniprogram-demo`](https://github.com/wechat-miniprogram/miniprogram-demo/tree/0b1de6f2a28ff185d7139e06b3956d8fdf15f61c) | 微信官方 API/组件示例；约 7.2k stars；快照提交 2026-03-27 | 大规模分包、`lazyCodeLoading`、API 与兼容用法、变更文件 ESLint | 它是示例集合，不是业务架构；PR CI 只有 Lint，不能作为 MIP 质量基线 |
| [`Tencent/tdesign-miniprogram`](https://github.com/Tencent/tdesign-miniprogram/tree/b60cdc8a1dce1f06dd45cb4e41eefd31c674e514) | Tencent 原生小程序组件库，另含 uni-app；约 1.7k stars；快照提交 2026-08-28 | 贡献规范、单测、E2E、包体积比较、预览、提交规范、发布流程 | Git Flow、`t-` 前缀、组织邮箱检查等库/组织专属规则 |
| [`Tencent/tdesign-miniprogram-starter-retail`](https://github.com/Tencent/tdesign-miniprogram-starter-retail/tree/4280f410121c75775c4b1fd15c3849031f830cd7) | 更接近真实业务的原生零售模板 | `components/config/model/pages/services/style/utils` 分层、页面与交互组织 | `test` 仍是占位，CI 主要同步仓库；只能参考结构和交互，不能参考质量门禁 |
| [`youzan/vant-weapp`](https://github.com/youzan/vant-weapp/tree/7a7d43757ed19d3ad5e6bca69059e0b9ea565d0b) | 成熟原生小程序组件库；快照提交 2026-02-27 | TypeScript strict、ESLint + Stylelint、Jest + `miniprogram-simulate`、lint/test/build 三个 CI job、覆盖率 | 部分 Actions、Jest 和依赖版本较旧；组件库目录不等于业务应用架构 |
| [`wechat-miniprogram/weui-miniprogram`](https://github.com/wechat-miniprogram/weui-miniprogram/tree/5d04cad87bf9305d709aa1b623b8f34f2c659a2d) | 微信官方 UI 组件库；约 2.4k stars；快照提交 2026-04-28 | 微信视觉、组件语义、API 兼容参考 | 构建和 TypeScript/Lint 版本偏旧，未发现现代 CI；不作为新工程模板 |
| [`weapp-vite/weapp-vite`](https://github.com/weapp-vite/weapp-vite/tree/a06edc1a356471830cbfafdb4fe0563361b7abb5) | 当前仓库直接使用的构建工具；约 465 stars；2026-08 仍活跃 | `AGENTS.md` 的任务路由、最小验证优先、真实 DevTools 与 headless 证据分层、生成项目级 Agent 规则 | 其大部分规则服务于构建器 monorepo、Rust/native、跨平台 runtime，不能整份复制到业务仓库 |
| [`sonofmagic/weapp-tailwindcss`](https://github.com/sonofmagic/weapp-tailwindcss/tree/52692d14702bc1454d6b7b0a49645974ee7484af) | 当前样式链直接依赖；约 1.8k stars；快照提交 2026-08-30 | 分层 `AGENTS.md`、故障回归要求、源码/产物/运行时证据区分、按任务拆分 Skill | 大量规则面向 bundler、uni-app、App WebView 和发布包；与 MIP 无关的部分不要引入 |
| [`TencentCloudBase/awesome-cloudbase-examples`](https://github.com/TencentCloudBase/awesome-cloudbase-examples/tree/b3aee65d62b4c7bf7c99036b6e7c105449abdefc) | 腾讯 CloudBase 多平台示例；快照提交 2026-08-28 | Agent 路由表、环境先行、平台鉴权边界、静态与运行时自证 | 多个示例复制同一份大型通用 `AGENTS.md/CLAUDE.md`，项目语境不够精确；MIP 不应照搬整份 CloudBase 规则 |
| [`NervJS/taro`](https://github.com/NervJS/taro/tree/30ccf422203523af0e0ee0610217f4be2d85becf) | 跨端框架，不是原生小程序；快照提交 2026-08-06 | workspace 依赖治理、包级最小测试、快照更新、文档随 Breaking Change 更新、安全报告流程 | React/Vue、跨端运行时和 Taro 包结构不能进入 `src/`，只能借鉴协作流程 |

## 最值得借鉴的规范文件

### 1. TDesign：把要求变成 CI

[`CONTRIBUTING.md`](https://github.com/Tencent/tdesign-miniprogram/blob/b60cdc8a1dce1f06dd45cb4e41eefd31c674e514/CONTRIBUTING.md) 明确编码规范、Conventional Commits、`miniprogram-simulate + Jest` 单元/集成测试、`miniprogram-automator + Jest` E2E，以及体验版验证后再提交审核。

对应自动门禁包括：

- [PR 执行 Lint 和单测](https://github.com/Tencent/tdesign-miniprogram/blob/b60cdc8a1dce1f06dd45cb4e41eefd31c674e514/.github/workflows/pull-request.yml)
- [PR 比较压缩后包体积](https://github.com/Tencent/tdesign-miniprogram/blob/b60cdc8a1dce1f06dd45cb4e41eefd31c674e514/.github/workflows/pr-compressed-size.yml)
- [发布时构建并上传小程序](https://github.com/Tencent/tdesign-miniprogram/blob/b60cdc8a1dce1f06dd45cb4e41eefd31c674e514/.github/workflows/auto-publish.yml)

核心经验不是复制它的文字，而是让 `AGENTS.md` 中的要求都有命令或 CI 对应。

### 2. weapp-vite：Agent 规则应包含路由和证据边界

[`AGENTS.md`](https://github.com/weapp-vite/weapp-vite/blob/a06edc1a356471830cbfafdb4fe0563361b7abb5/AGENTS.md) 值得借鉴的部分：

- 明确目录所有权，避免无必要的跨包改动。
- 优先运行最小范围测试，再按风险升级到完整回归。
- 区分源码、构建产物、headless 模拟、开发者工具真实运行时和真机证据。
- 当下游消费 `dist` 时，先重建再验证，避免使用陈旧产物得出错误结论。
- 测试断言稳定语义，不依赖压缩后的临时变量名、hash 或本机绝对路径。

其 [AI 协作指南](https://vite.weapp.dev/guide/ai) 还建议项目级 `AGENTS.md` 只负责把意图路由到具体命令和专用 Skill，详细说明按需读取。

### 3. weapp-tailwindcss：就近规则和专用 Skill

该仓库采用根规则、目录级规则和按任务拆分 Skill：

- [根 `AGENTS.md`](https://github.com/sonofmagic/weapp-tailwindcss/blob/52692d14702bc1454d6b7b0a49645974ee7484af/AGENTS.md)
- [核心包局部规则](https://github.com/sonofmagic/weapp-tailwindcss/blob/52692d14702bc1454d6b7b0a49645974ee7484af/packages/weapp-tailwindcss/AGENTS.md)
- [总路由 Skill](https://github.com/sonofmagic/weapp-tailwindcss/blob/52692d14702bc1454d6b7b0a49645974ee7484af/skills/weapp-tailwindcss/SKILL.md)
- [排障 Skill](https://github.com/sonofmagic/weapp-tailwindcss/blob/52692d14702bc1454d6b7b0a49645974ee7484af/skills/weapp-tailwindcss-troubleshoot/SKILL.md)

最有价值的结构是：根文档只写全局硬边界和路由；目录级文档只写该目录的职责、禁止事项、测试命令；Skill 针对接入、迁移、排障等具体任务提供步骤。

同时应避免维护多份重复事实。该仓库的 `AGENTS.md` 和 `CLAUDE.md` 在 Node/格式化口径上能看到版本漂移，这说明 MIP 应保持一个语义权威文件，其他入口只做短映射，不复制完整规则。

### 4. 官方测试工具：三层以上证据

- [`miniprogram-simulate`](https://github.com/wechat-miniprogram/miniprogram-simulate) 的 CI 同时覆盖 Jest/jsdom 和 Karma/浏览器。
- [`glass-easel`](https://github.com/wechat-miniprogram/glass-easel) 覆盖多操作系统、多个 Node 版本、Lint、单测和类型测试。
- [`api-typings`](https://github.com/wechat-miniprogram/api-typings) 使用 `tsd` 验证 TypeScript 公共契约。

对业务小程序更合理的证据层级是：

1. 静态契约、类型检查和单元测试。
2. 构建与包体积验证。
3. 微信开发者工具自动化和截图。
4. 手机号、支付、订阅消息、扫码等真机验收。
5. 发布前体验版回归。

## Skill 判断

### 可以考虑试装

仅建议在独立 worktree 中审阅后试装，而不是直接写入项目规则：

- `weapp-vite-best-practices`：当前仓库直接使用 `weapp-vite`，对构建产物、DevTools、截图和 E2E 的规则有专门价值。
- `weapp-devtools-e2e-best-practices`：适合补强开发者工具自动化，不替代 MIP 的业务场景验收。
- `weapp-tailwindcss` 与 `weapp-tailwindcss-troubleshoot`：只在样式构建、动态 class、HMR 或产物异常时使用，属于专用排障 Skill。

这些 Skill 的来源分别见 [`weapp-vite` Agent 规则的 Project Skills 章节](https://github.com/weapp-vite/weapp-vite/blob/a06edc1a356471830cbfafdb4fe0563361b7abb5/AGENTS.md) 和 [`weapp-tailwindcss` Skill 目录](https://github.com/sonofmagic/weapp-tailwindcss/tree/52692d14702bc1454d6b7b0a49645974ee7484af/skills)。

### 不建议作为项目主规范

- 声称适用于所有微信小程序、但强制 JavaScript、禁止 TypeScript、强制某种 CSS 命名或固定目录的通用 Skill。
- 以 Taro、uni-app、mpvue、WePY 为默认实现的 Skill；它们只能提供跨端流程经验。
- 没有测试脚本、版本边界、官方来源或运行时验收步骤的纯提示词 Skill。
- 把 CloudBase、视觉设计、支付、数据模型全部塞进一个超长 `SKILL.md` 的集合；这会降低任务命中精度并与项目事实冲突。

## 建议更新 MIP 现有规则

以下仅是建议，本次调研没有修改 `AGENTS.md` 或 Skills。

### 根 `AGENTS.md`

保留现有的技术栈、目录地图、平台边界、CloudBase、支付和完成命令。建议补四条短规则：

1. 明确证据层级：源码测试通过不等于 DevTools 运行通过，DevTools 通过不等于真机支付/手机号通过。
2. `navigationStyle: custom` 页面必须使用共享安全区/导航壳；固定底部操作区必须处理底部安全区。
3. 页面返回或 Tab 切换默认保留可用旧数据并后台刷新，不能无条件清空内容进入整页 Loading。
4. 新增全局组件、主包资源或分包依赖时必须通过包体和依赖分析门禁。

根文件不宜继续增厚具体实现细节；规则细节应放入现有 Skills，并由根表格路由。

### `weapp-development`

建议增加：

- `setData` 只传变化字段、合并连续更新、禁止高频滚动更新。
- 组件默认页面/分包局部注册，全局注册需要说明覆盖率与包体影响。
- 页面加载采用首次骨架、缓存内容保留、后台刷新三个明确状态。
- 修改页面生命周期时必须补 Tab 返回、普通返回、冷启动和弱网场景中的至少相关子集。

### `weapp-design`

建议增加：

- 自定义导航统一安全区组件；禁止手写固定顶部数值。
- 固定底部栏统一处理 `safe-area-inset-bottom` 和内容滚动余量。
- 手机、PC 可调整窗口分别验收；桌面字体和内容宽度不能只按 `rpx` 等比放大。
- 交互热区、文字对比度、Loading/Empty/Error 使用共享 token 和组件。

### `weapp-runtime-qa`

建议把验收报告固定分成：

- 静态/类型/单测
- 构建与主包/分包大小
- DevTools 路由和交互自动化
- 截图与控制台日志
- 真机专属能力
- 外部环境阻塞

登录或会员身份阻塞时应记录为环境/身份阻塞，不能把未执行页面计为通过，也不能把旧报告当作当前运行证据。

### `weapp-cloudbase` 与支付 Skill

继续坚持当前“客户端只提交意图，服务端决定会员、订单、金额和权益”的边界。CloudBase 通用 Agent 文档可参考环境先行和平台鉴权区分，但不能替代 MIP 已有的 MySQL、云函数部署和微信支付领域规则。

## 推荐落地顺序

1. 先把上述官方规则映射到现有 `verify`、包体检查和运行时报告，不新增大而全 Skill。
2. 对自定义导航、安全区、固定底栏、页面缓存刷新建立静态扫描或组件契约测试。
3. 给 PR 增加与 TDesign 类似的 Lint、单测、构建和包体增量门禁。
4. 再在隔离 worktree 试用 `weapp-vite-best-practices` 和 DevTools E2E Skill；只保留现有项目规则没有覆盖、且能产生可验证结果的部分。
5. 所有新增 Agent 规则必须指向真实命令、测试或官方来源；无法自动验证的内容明确标注需要 DevTools 或真机。
