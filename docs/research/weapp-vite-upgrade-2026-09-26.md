# weapp-vite 7.3.0 升级与样式简化（2026-09-26）

## 结论

**最终采用 weapp-vite 7.3.0 / weapp-ide-cli 6.1.8。** 首次评估发现旧毛玻璃兼容规则会被移除；用户随后确认可以简化非关键视觉效果、清理历史代码并在最后配合真机测试。因此将操作栏改为默认深色背景，标准模糊仅作可选增强，解除对旧前缀与条件规则的依赖。

最终变更：升级构建工具并更新锁文件；`src/app.css` 统一使用 `rgb(32 32 32 / 96%)` 深色操作栏；删除 `src/styles/liquid-glass.wxss`、8 个消费端的导入及其中 4 个不再有内容的样式文件；排除浏览器 Preflight，保留小程序样式重置与主题/工具类；构建门禁验证深色背景及按钮无浏览器外观。按钮尺寸、安全区、业务 JS/WXML、云函数和数据库未改。验证结果见下文。

## 来源与风险范围

- [官方 7.3.0 发布说明](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%407.3.0)及[完整 changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%407.3.0/packages/weapp-vite/CHANGELOG.md)：本轮查询 npm 的 latest 为 7.3.0，发布于 2026-09-24。7.x 涉及 Tailwind 作者样式/增量构建、模块归属、HMR 与编译插件，也包含 Wevu Store 行为变更。
- MIP 是原生 WXML + TypeScript 的 Page/Component，没有使用 Wevu Store/Vue/JSX；这些框架迁移不直接影响当前业务。构建器和样式链仍需独立验证，不能仅凭“没用 Vue”判断无风险。
- 使用仓库 Node **22.23.1**、pnpm **11.14.0**；符合候选构建器和其内置 Tailwind core 的要求。保留 classic HMR 与现有配置。
- 直接依赖只变更 `weapp-vite 6.25.0 → 7.3.0`、`weapp-ide-cli 6.1.7 → 6.1.8`；实际 Tailwind 适配器解析为 `weapp-tailwindcss 5.5.9`。管理后台独立的 Vite 仍为 8.2.2。
- 安装出现的 Babel ESLint parser / tsconfck peer 范围警告在旧锁文件中已有，不是本次新增故障。

## 首次发现的问题与替代方案

在同一源码、配置和环境先后构建并按相对路径比对全部文件：

| 项目 | 6.25.0 基线 | 7.3.0 候选 |
| --- | --- | --- |
| 文件数 | 1632 | 1632；无新增/删除 |
| dist 文件字节合计 | 4,539,166 | 4,539,798 |
| JS / WXML / JSON / 资源 | 基线 | SHA-256 全部相同 |
| WXSS | 基线 | 27 个文件变化 |

这里的字节合计是磁盘产物比较，不是微信上传计费或正式包体。包预算均通过。

27 处差异中，部分是颜色语法归一化、前缀和格式调整；`app.wxss` 还补入了作者的 base 样式。**其中 8 个导入毛玻璃公共 WXSS 的页面/组件丢失兼容规则**，包括机会详情、机会列表、活动详情/报名/反馈、会员订单、人脉页和底部操作栏。原来已有的规则为：

```css
.mip-liquid-glass {
  -webkit-backdrop-filter: blur(20px) saturate(150%);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .mip-liquid-glass { background: rgb(32 32 32 / 92%); }
}
```

这证明兼容声明丢失，但不是业务功能损坏，也不能据此声称所有 iPhone 必现。旧版背景只有 5–12% 白色透明度，直接丢掉模糊及降级规则可能让滚动内容透过、干扰操作条文字；新版本则无条件使用 96% 的深色背景，即使模糊完全不生效仍有遮挡。视觉取舍是操作栏更实、更少透光，按钮与流程不变。

[WebKit 官方说明](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/#backdrop-filter)指出 Safari 18 起标准 `backdrop-filter` 不再需要前缀。这不是微信真机兼容证明，所以实现没有依赖具体 iOS 版本判断：标准模糊可用则增强、不可用仍显示深色背景，无额外检测分支。

排查候选已安装实现：新版内置集成在 bundle 阶段对所有 WXSS 调用 `compiler.transformCss`，没有用 `cssMatcher` 排除作者样式；其依赖的最终化逻辑会移除未列入保留名单的 WebKit 属性和 `@supports`。尝试公开的 `autoprefixer.remove: false` / `atRules` 配置后，WebKit 声明仍会被删除，因此仅关闭 Autoprefixer 清理不足以解决。没有提交 node_modules 修改、复制旧编译器代码或自行追加构建产物。

本地调试记录（均在 Git 忽略目录）：`.tmp/upgrade-20260926/build-before.json`、`build-after.json`、`build-comparison.json`、`styles.diff`。另外使用仍安装的旧编译器输出到独立临时目录，27 个旧 WXSS 哈希均与最初基线匹配，避免把源码变化误当成升级差异。

## 实拍发现的浏览器按钮外观

第一轮升级实拍的会员订单页中，TDesign 支付按钮出现白色矩形底框。最终 WXSS 含浏览器 Preflight 的 `appearance: button`；新版开始保留作者 base 样式，将浏览器控件外观带入了小程序。

按 [Tailwind 官方禁用 Preflight 的方式](https://tailwindcss.com/docs/preflight#disabling-preflight)，将完整 `tailwindcss` 导入改为 `theme.css` 和 `utilities.css`，保留层顺序、现有作者 base 和 weapp-tailwindcss 的原生重置。不新增单页面覆盖补丁，不改 TDesign 源码。产物门禁检查 `appearance: button` 不再进入 app.wxss。

## 验证与运行时边界

- 候选的原有 `pnpm verify:all` **通过**：小程序 239 个测试文件 / 1317 个用例，服务端合同、类型、lint、构建与预算通过；Web 144 个 Node 用例及 63 个 React 用例通过。日志为 `.tmp/upgrade-20260926/verify-all.log`。
- 初版兼容检查曾在候选产物上 **按预期失败**，首个报错为 `Compiled liquid glass lost its iOS blur or opaque fallback: dist/components/sticky-actions/index.wxss`。用户接受简化后，验证目标改为默认深色底而非强制保留已经移除的兼容代码。
- 候选运行时尝试：开发者工具可登录和连接，IDE 编译诊断为 0；6 类受控代表状态通过。记录了 25/70 路由，其中 23 通过、2 失败，随后身份 fixture 恢复失败中断；不是 70 路由验收通过。
- 失败现象：`pages/index/index` 长时间为 loading；`packages/admin/event-registrations/index` 显示“运营服务返回了无效的参与者名单”；身份 fixture 返回首页后未恢复预期页面。这些来自候选运行环境，**尚未归因**。JS/WXML 与基线相同不能单独排除自动化工具、会话、接口部署或运行环境因素。下一轮在保留版本上复现，再分别排查首页在途请求、非空名单 DTO 和身份 fixture 恢复。
- 原始运行证据仅保留本地 `.tmp/runtime-evidence/2026-09-26-weapp-vite-730/`；其中可能包含当前用户数据，不纳入提交。会话最终报告 `cleanup.status: closed`。

最终方案验证：

- 7.3.0 构建与新默认深色底门禁通过。主包 1.29 MB、用户分包 1.27 MB、现场工作台分包 84.9 KB，均在预算内。
- 最终 **1628 个文件 / 4,535,487 字节**；与原始基线比较，23 个 WXSS 变化、4 个仅含旧兼容规则的 WXSS 删除，无新增文件，**JS/WXML/JSON/业务资源哈希全部相同**。
- 最终 `pnpm verify:all` **通过（exit 0）**：小程序 239 个测试文件 / 1317 个用例、服务端合同、类型、lint、构建、预算、文档检查通过；Web 144 个 Node 用例 / 63 个 React 用例及生产构建、响应式合同通过。`runtime:preflight` 通过，开发者工具已登录且服务端口开启；`git diff --check` 通过。
- 采用深色背景后、移除浏览器 Preflight 前，第二轮运行遍历 70 条路由：**65 通过、4 失败、1 等待上游测试数据**，6 类代表状态通过、IDE 编译诊断为 0、会话正常关闭。失败为现场活动名单无效、成长/游戏页加载超时、感兴趣名单身份受限；游戏队伍页依赖未加载的游戏数据。首页及身份 fixture 恢复在此轮通过。不能把前一次首页失败继续描述为稳定复现的问题，也尚未证明上述失败属于升级回归。
- 最终样式实拍确认会员订单按钮白色矩形底框消失，黄色胶囊按钮及深色操作栏可见。没有触发支付；截图中的 6000 元来自当前测试套餐，正式年费要求为 6600 元，须按服务端正式配置另验。
- 严格交互未通过：自动化连接降级为 App-Service route fallback，节点查询能找到渲染对象，但真实 `Element.tap` 不支持；按 ID 查询输入框也会被包装成普通 `view`。未将 `callMethod` 或直接改页面数据冒充真实输入测试。最终样式未重复完成 70 路由遍历，仍需真机测试与后续运行问题排查。
- 已提交无身份信息的[验证摘要](../mip/evidence/weapp-vite-2026-09-26/verification.json)及[最终订单截图](../mip/evidence/weapp-vite-2026-09-26/membership-order.png)。原始日志保留 `.tmp/upgrade-20260926/verify-final-native.log`、`preflight-final.log`、`focus-native.log`；带用户数据的全量运行报告不纳入提交。本轮没有上传微信开发版，也未部署云函数或修改数据库。
