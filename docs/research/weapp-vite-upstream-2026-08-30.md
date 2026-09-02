# weapp-vite 上游更新评估

> 调查日期：2026-08-30  
> 上游范围：`weapp-vite@6.18.6` 至 `weapp-vite@6.25.0`  
> 实际待升级范围：锁文件中的 `6.20.4` 至 `6.25.0`  
> 信息源：只使用 weapp-vite 官方 GitHub 仓库、官方 GitHub Releases 与 npm 官方 registry。

## 结论

截至 2026-08-30，npm `latest` 和 GitHub 最新稳定发布均为 **`weapp-vite@6.25.0`**，发布于 2026-08-30。仓库调查开始时 `package.json` 声明 `^6.18.6`，锁文件实际安装 `6.20.4`；因此评估升级影响时应以 `6.20.4 -> 6.25.0` 为准，而不是把 `6.19`、`6.20.0-6.20.4` 已经获得的修复再次列为待采用项。

推荐升级到 `6.25.0`，并同步采用以下两项：

1. **把 Tailwind 集成从外部 `WeappTailwindcss()` Vite 插件迁移到 `weapp.tailwindcss`。** `6.25.0` 已内置 `weapp-tailwindcss@5.4.1` compiler API，会统一处理 CSS 生成、WXML/JavaScript 转换、WXSS 最终化与 HMR 失效。官方新模板也已经移除外部插件注册，改用 `weapp.tailwindcss`。
2. **将仓库直接使用的配套包与 `6.25.0` 对齐。** `weapp-vite@6.25.0` 官方依赖 `weapp-ide-cli@6.1.0`、`@weapp-vite/miniprogram-automator@1.2.16` 和 `weapp-tailwindcss@^5.4.1`。当前仓库在调查开始时仍直接固定 `weapp-ide-cli@6.0.0` 与 automator `1.2.8`；直接依赖不对齐会保留旧实现或产生重复版本。

不建议因为本次升级同时切换 React、Wevu、i18n、Web Runtime 或 stateful HMR；这些都不是升级前置条件。`glass-easel` 也应先运行兼容检查，不应仅因上游新增检查能力就开启 WebView glass-easel。

来源：[6.25.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.25.0)、[6.25.0 Changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/CHANGELOG.md#6250)、[npm 6.25.0](https://www.npmjs.com/package/weapp-vite/v/6.25.0)、[6.20.4...6.25.0 官方比较](https://github.com/weapp-vite/weapp-vite/compare/weapp-vite%406.20.4...weapp-vite%406.25.0)

## 1. 版本与运行环境

| 项目 | 调查开始时的仓库状态 | 上游最新稳定状态 | 判断 |
| --- | --- | --- | --- |
| `weapp-vite` | manifest `^6.18.6`；lock `6.20.4` | `6.25.0` | 推荐更新 manifest 下限与锁文件 |
| `weapp-tailwindcss` | manifest `^5.1.16`；lock `5.3.1` | `6.25.0` 内置依赖 `^5.4.1` | 迁移到内置集成；若无其他直接 API 使用，独立直接依赖可移除 |
| `weapp-ide-cli` | 直接固定 `6.0.0` | `6.1.0` | 推荐对齐；包含 MCP v2 与 DevTools 链路修复 |
| `@weapp-vite/miniprogram-automator` | 直接固定 `1.2.8` | `1.2.16` | 推荐对齐；已有多项新版 DevTools 兼容修复 |
| Node.js | 仓库要求 `>=22.18.0 <23` | weapp-vite 要求 `^20.19.0 || >=22.12.0` | 仓库约束满足，没有 Node 迁移 |

`weapp-vite` 在 `6.18.6`、`6.20.4` 与 `6.25.0` 的 `engines.node` 都是 `^20.19.0 || >=22.12.0`，本次升级没有提高 Node 最低版本。内置所用 `weapp-tailwindcss@5.4.1` 要求 `^22.18.0 || >=24.11.0`，仓库声明的 Node 22 范围同样满足。

需要区分 manifest 与 lock：`^6.18.6` 在重新解析依赖时已经允许安装 `6.25.0`，但 frozen lock 或现有安装仍会保持 `6.20.4`。把 manifest 更新为 `^6.25.0` 的作用，是明确项目依赖的新配置合同，而不只是偶然通过宽松范围拿到新版本。

来源：[6.25.0 package.json](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/package.json)、[npm registry: weapp-vite latest](https://registry.npmjs.org/weapp-vite/latest)、[npm registry: weapp-tailwindcss 5.4.1](https://registry.npmjs.org/weapp-tailwindcss/5.4.1)

## 2. 必须处理的迁移

### 2.1 Tailwind 改用内置集成

`6.25.0` 新增 `weapp.tailwindcss`：

```ts
export default defineConfig({
  weapp: {
    tailwindcss: {
      cssEntries: ['src/app.css'],
      rem2rpx: true,
    },
  },
})
```

上游合同是：

- `true` 或对象表示显式启用；`false` 会连自动检测一起关闭。
- 未配置时，仅在解析到 Tailwind CSS v4 且实际 CSS 模块包含 `@import "tailwindcss"` 时自动启用。
- `cssEntries` 只声明 compiler 入口，CSS 文件仍需被应用模块图实际引入。
- 启用内置集成后，不应再注册 `WeappTailwindcss()` 外部 Vite 插件；preflight 会移除外部 `weapp-tailwindcss:*` 插件并提示迁移。
- 内置实现使用 `weapp-tailwindcss@5.4.1/core`，由 core 统一完成 WXML、JavaScript、WXSS 转换，并按 `@source` glob 精确处理 HMR 失效。

当前仓库的 `src/app.css` 已包含 Tailwind v4 import，且显式使用 `cssEntries`、`rem2rpx`。推荐显式迁移配置，而不是只依赖自动检测；这样配置意图与现有行为保持一致，也不会因入口内容调整而意外关闭 Tailwind。

官方 `6.25.0` Tailwind 模板只直接依赖 `tailwindcss` 与 `weapp-vite`，不再把 `weapp-tailwindcss` 列为模板直接依赖。`weapp-vite@6.25.0` 自己已依赖 `weapp-tailwindcss@^5.4.1`。因此，在仓库不再直接导入 `weapp-tailwindcss` 其他 API 后，可以移除该直接 devDependency；若为了版本治理仍保留，则至少对齐 `^5.4.1`，避免两套版本。

迁移价值不只是少一个插件注册。`6.25.0` 同时修复了：

- Sass/Less URL 占位符二次处理错误；
- 多个 `<style src>` 写入同一 `app.wxss` 时样式相互覆盖；
- Tailwind 指令重复进入最终 WXSS；
- 内置 Tailwind 与 Vue HMR 协同时错误降级全量重载；
- 多入口 snapshot 与 `@source` 精确失效。

来源：[内置 Tailwind 配置文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/weapp-config.md#tailwindcss)、[6.25.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.25.0)、[官方 Tailwind 模板配置](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/templates/weapp-vite-tailwindcss-template/weapp-vite.config.ts)、[官方 Tailwind 模板 package.json](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/templates/weapp-vite-tailwindcss-template/package.json)

### 2.2 对齐 DevTools 配套包

`weapp-vite@6.25.0` 的官方依赖版本为：

- `weapp-ide-cli@6.1.0`
- `@weapp-vite/miniprogram-automator@1.2.16`

automator `1.2.9-1.2.16` 相比仓库原直接版本 `1.2.8` 的高价值修复包括：

- 会话复用、页面重启、日志收集和截图清理稳定性；
- 缺少 `SDKVersion` 的兼容处理；
- CLI-first 打开流程和 `wv ide doctor`；
- App-Service route 降级元素的 `offset/size/style/attribute` 只读能力；
- 新版 DevTools 重复打开项目、嵌套 readiness 探针放大超时的问题；
- XPath 返回异常时提供明确协议诊断，而不是无上下文 `map` 错误。

当前仓库有专门针对 `1.2.8` 缺少 `SDKVersion` 防护的本地兼容层。上游在 `1.2.13` 已明确补齐这项兼容；升级后可以删除该本地补丁，但应以现有 runtime verification 通过为删除证据，不要只凭版本号推断所有本地边界都已覆盖。

`weapp-ide-cli@6.1.0` 自身最低 Node 是 `>=22`，也符合仓库 Node 22 合同。

来源：[automator Changelog 1.2.16-1.2.9](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/miniprogram-automator/CHANGELOG.md#1216)、[weapp-ide-cli 6.1.0 Changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-ide-cli/CHANGELOG.md#610)、[6.24.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.24.0)、[npm registry: automator latest](https://registry.npmjs.org/@weapp-vite%2fminiprogram-automator/latest)

## 3. 升级后直接获得的修复

以下改动不要求新增业务配置，升级后可直接受益。

### `6.20.5`

- 局部构建会同步裁剪 `preloadRule`、`tabBar` 和默认启动页，避免 `app.json` 继续引用未构建页面。
- Skyline 开发模式会自动关闭不兼容的 DevTools 热重载并降级 classic。
- stateful HMR 继承 polling watcher，原子重命名保存时不再漏更新。

来源：[6.20.5 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.20.5)

### `6.21.0`

- 新增 `weapp.styles` 主包共享样式入口。
- 新增 `weapp.chunks.preserveModules`，可按源码相对路径保留独立输出模块。
- 分包预下载分析修正路由误报和 2 MB 额度计算。
- Sass Embedded 子进程在构建或分析结束后正确退出。

来源：[6.21.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.21.0)、[`preserveModules` 官方文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/weapp-config.md#chunkspreservemodules)

### `6.22.0`

- 修复独立分包产物被主构建输出插件重复处理。
- 修复模板中二进制、八进制、十六进制、数字分隔符与 BigInt 直接进入 WXML 的问题。
- 修复 `weapp.styles.include` 显式匹配 `app.vue` 时未写入 `app.wxss`。
- 新增可选 i18n 方案；它是新能力，不是升级要求。

来源：[6.22.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.22.0)

### `6.23.0`

- 新增稳定的 `wv analyze --glass-easel-check` 诊断。
- 修复 Vite 开发服务重复监听输出目录导致 Windows `EBUSY` 退出。
- 修复 `dev -o` 与 automator 端口、重复等待和新版 DevTools 重复打开项目问题。
- 改善 npm 包复制范围，减少原生组件库无关文件。

来源：[6.23.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.23.0)、[glass-easel 检查文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/glass-easel.md)

### `6.24.0`

- 修复新版微信开发者工具加载小程序 npm 包时，压缩 ESM import 与 `export *` 桶文件未转 CommonJS、产物遗留裸 `export` 的问题。
- MCP 升级到 TypeScript SDK v2，stdio/HTTP 保持旧客户端兼容；HTTP 增加 Host/Origin 防护和 XPath 元素查询。
- 文档主域迁移到 `vite.weapp.dev`。

来源：[6.24.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.24.0)

### `6.25.0`

- 内置 Tailwind 集成与相关 CSS/HMR 修复，见迁移章节。
- 修复 stateful-experimental 初始构建、构建失败后挂起和公共运行时误判。
- 修复本地自动导入组件在文件名 kebab-case、模板标签 PascalCase 时无法匹配。
- SFC HMR 改为按 script/template/style/config block 分类，但不要求项目切换现有 HMR 策略。

来源：[6.25.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.25.0)

## 4. 适合现在采用的按需能力

### 4.1 运行分包预下载分析

推荐把以下命令作为只读诊断运行一次：

```bash
wv analyze --preload
wv analyze --preload --json --output reports/preload.json
```

它会识别宿主导航 API 与 weapp-vite router binding，通过不写盘的分析构建统计跨分包跳转、实际分包体积和共享的 2 MB 预下载额度；只给建议，不自动修改源码。当前项目有多个业务分包，这项分析有直接价值。只有报告提供明确的高频跨包证据后，再考虑用 `routeRules.*.preload` 合成 `app.json.preloadRule`，并保留手写同路由规则的优先级。

来源：[preload 配置文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/weapp-config.md#routerules)、[AI workflow 对分析边界的说明](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/ai-workflows.md#常用-ai-命令)

### 4.2 运行 glass-easel 兼容检查

当前 `src/app.json` 声明了 `componentFramework: "glass-easel"`，但没有 `glassEaselWebview: true`。按上游说明，单独的 `componentFramework` 不会开启 WebView glass-easel；WebView 模式要求基础库 `3.8.12` 以上，并由用户在宿主 JSON 中显式成对开启。

本次适合采用的是检查命令：

```bash
wv analyze --glass-easel-check
wv analyze --glass-easel-check --json
```

不建议把 `glassEaselWebview: true` 混入依赖升级。只有检查无阻塞、开发者工具和真机基础库均满足要求，并完成运行时验收后，再单独评估启用。删除或关闭 `glassEaselWebview` 是官方回退路径。

来源：[glass-easel 检查文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/glass-easel.md)、[6.23.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.23.0)

### 4.3 保留 `wv ide doctor --json` 作为故障诊断入口

`wv open`、`wv dev -o` 和 `wv ide logs --open` 已统一成 CLI-first 打开路径。DevTools 没有自动连接时，官方推荐先运行：

```bash
wv ide doctor --json
```

它适合写入故障排查文档或按需使用，不需要成为每次构建的固定步骤。

来源：[Troubleshooting](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/troubleshooting.md#终端里看不到小程序日志)、[6.20.2 Changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/CHANGELOG.md#6202)

### 4.4 `preserveModules` 只做定向实验

当前项目已有针对少数 presentation seam 的稳定路径处理。`weapp.chunks.preserveModules` 可以让匹配模块按 `srcRoot` 相对路径形成独立产物，适合调试定位和产物审计，但官方明确说明它不保证减小包体积或改善冷启动，全量 `['**']` 还会增加文件数。

因此不要在升级中直接把现有 chunk 策略整体换成 `preserveModules`。若要验证能否替代局部路径 workaround，应只匹配那两个具体模块，比较构建产物路径、主包/分包体积和真实 DevTools 运行结果后再决定。

来源：[`preserveModules` 官方文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/weapp-config.md#chunkspreservemodules)

## 5. 当前不建议引入

| 上游能力 | 本次判断 | 原因 |
| --- | --- | --- |
| React 19 小程序 runtime | 不引入 | 当前仓库合同是原生 WXML + TypeScript；增加框架会扩大运行时和维护面 |
| Wevu / Vue SFC 新能力 | 不引入 | 当前项目没有 Vue SFC 迁移需求；相关修复保留为上游内部收益即可 |
| `@weapp-vite/i18n` | 暂不引入 | 是新业务能力，不是依赖升级前置；没有多语言需求证据 |
| Web Runtime | 不引入 | `admin-web/` 已是独立 React 管理后台，小程序 Web Runtime 不是当前架构目标 |
| `weapp.styles` | 暂不引入 | 当前有明确的 `src/app.css` 应用入口；没有需要跨页面自动注入另一套共享样式的证据 |
| stateful / stateful-experimental HMR | 保持 `classic` | 新版本修复了实验模式，但当前配置显式选择 classic；不应把 HMR 策略切换与依赖升级绑在一起 |
| `glassEaselWebview: true` | 先不启用 | 上游要求基础库门槛、兼容检查和显式 opt-in；仍需真机证据 |
| uview-plus / Wot UI 兼容层 | 不引入 | 当前 UI 库是 TDesign MiniProgram，不属于现有依赖面 |

相关来源：[6.20.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.20.0)、[6.22.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.22.0)、[6.23.0 Release](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%406.23.0)

## 6. 破坏性变更、弃用与风险

### 没有新的 major migration

官方从 `6.20.4` 到 `6.25.0` 的发布记录没有标注 major 或 breaking change，Node engine 也没有变化。MCP v2 发布说明明确写明 stdio 与 HTTP 保持旧客户端兼容。因此不存在必须先完成的全局迁移指南。

这是基于官方 Changelog 与 package metadata 的结论，不等于所有第三方插件组合都零风险；本次升级仍涉及 Rolldown、Oxc、SWC、Sass、Tailwind 与 DevTools 依赖联动，应完成项目自己的 build、typecheck、runtime preflight 和真实 DevTools 验收。

### 明确的迁移提示

唯一与当前项目直接相关的显式迁移是外部 Tailwind 插件：改用 `weapp.tailwindcss`，删除 `WeappTailwindcss()` import 与 `plugins` 注册。保留旧注册时，上游会自动移除并警告，短期可兼容，但不应把警告长期留在配置中。

### 既有弃用未被本次升级新增触发

当前待升级范围内没有新增与当前配置直接相关的弃用。上游文档仍记录的既有弃用包括：

- `chunks.dynamicImports: 'inline'` 已废弃，会回退为 `preserve`；当前仓库未使用。
- `weapp.injectRequestGlobals` 是过渡配置，应使用 `weapp.appPrelude.requestRuntime`；当前仓库未使用。
- 历史 `weapp.es5` / `@swc/core` ES5 降级方案已废弃；当前仓库未使用。

因此本次不需要为这些弃用修改配置。

来源：[完整 Changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/CHANGELOG.md)、[配置文档](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/weapp-config.md)

## 7. 建议实施与验收顺序

1. 更新 `weapp-vite` 到 `^6.25.0`，同步锁文件。
2. 把外部 Tailwind Vite 插件迁移为 `weapp.tailwindcss`，保持现有 `cssEntries` 与 `rem2rpx` 语义。
3. 对齐直接依赖的 `weapp-ide-cli@6.1.0` 和 `@weapp-vite/miniprogram-automator@1.2.16`；确认没有其他直接 API 使用后，移除多余的 `weapp-tailwindcss` 直接依赖。
4. 运行现有静态验证与全量构建；重点检查最终 `app.wxss` 不含 `@source` / `@plugin` 等 Tailwind 构建指令，作者 CSS 与 utility 都存在。
5. 运行现有 runtime verification，确认新版 automator 后再删除 `1.2.8` 专用兼容层。
6. 单独运行 `wv analyze --preload` 和 `wv analyze --glass-easel-check`；它们先作为报告，不自动改业务配置。
7. 在真实微信开发者工具中验证 `dev -o`、forward console、截图/元素查询、普通页面与分包页面；涉及 glass-easel WebView 的启用仍留给后续独立变更和真机验收。

升级验收重点来自本次上游变更面，而不是泛化检查：Tailwind 最终 WXSS、原生组件 npm ESM/CJS 转换、原子保存 HMR、输出目录监听、DevTools 会话复用、分包页面与局部构建 `app.json` 裁剪。

来源：[6.20.4...6.25.0 官方比较](https://github.com/weapp-vite/weapp-vite/compare/weapp-vite%406.20.4...weapp-vite%406.25.0)、[随包 AI workflow](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/ai-workflows.md)、[Getting Started 分析命令](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%406.25.0/packages/weapp-vite/docs/packaged/getting-started.md)
