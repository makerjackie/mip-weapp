# 微信小程序 Agent Skill、MCP 与代理规范生态调研

> 调研日期：2026-08-30
> 适用项目：MIP 小程序，原生 WXML + TypeScript + weapp-vite + Tailwind CSS 4 + weapp-tailwindcss 5 + TDesign MiniProgram + CloudBase
> 本文仅做选型，不执行安装。

## 结论

这次扩大关键词后，找到了两项真正适合当前仓库、可以项目级安装的 Skill，来源都是当前构建工具 `weapp-vite` 的上游仓库：

1. **推荐安装：`weapp-vite-best-practices`。** 它直接覆盖本仓库正在使用的 `weapp-vite` 配置、分包、包体预算、MCP、DevTools CLI、截图、日志与构建诊断，并明确要求先读取项目内 `node_modules/weapp-vite/dist/docs/`，不会拿固定旧版本示例覆盖当前依赖。[源码](https://github.com/weapp-vite/weapp-vite/blob/main/skills/weapp-vite-best-practices/SKILL.md) · [skills.sh](https://skills.sh/weapp-vite/weapp-vite/weapp-vite-best-practices)
2. **推荐安装：`weapp-devtools-e2e-best-practices`。** 它直接覆盖本仓库已有的 `miniprogram-automator`、共享 DevTools 会话、`reLaunch`、截图、日志、真实 DevTools 与 headless 证据边界。[源码](https://github.com/weapp-vite/weapp-vite/blob/main/skills/weapp-devtools-e2e-best-practices/SKILL.md) · [skills.sh 镜像条目](https://skills.sh/sonofmagic/skills/weapp-devtools-e2e-best-practices)

这两项应作为**上游工具知识**补充现有本地 Skill，不取代 [`weapp-development`](../../.agents/skills/weapp-development/SKILL.md)、[`weapp-design`](../../.agents/skills/weapp-design/SKILL.md) 和 [`weapp-runtime-qa`](../../.agents/skills/weapp-runtime-qa/SKILL.md)。本地 Skill 继续拥有 MIP 的架构、视觉、业务和验收约束。

可选的第三项是 `weapp-tailwindcss-troubleshoot`。它由 `weapp-tailwindcss` 维护者编写，适合样式未生成、动态 class、HMR、组件隔离等故障；但它不是日常页面规范，建议出现相关故障时再安装。[源码](https://github.com/sonofmagic/skills/blob/main/skills/weapp-tailwindcss/weapp-tailwindcss-troubleshoot/SKILL.md) · [skills.sh](https://skills.sh/sonofmagic/skills/weapp-tailwindcss-troubleshoot)

## 搜索范围

使用 Skills CLI 分别检索：

```text
wechat miniprogram
weapp
mini program performance
cloudbase
skyline
miniprogram devtools
weapp vite
weapp vite e2e
weapp tailwindcss
tdesign miniprogram
wechat devtools automation
miniprogram automator
```

搜索结果不能直接作为质量证明。候选进一步按 GitHub 源码、`SKILL.md`、最近维护时间、stars、安装量、技术栈冲突和执行权限复核。安装量和 stars 是 2026-08-30 快照。

## 推荐项

### 1. `weapp-vite-best-practices`

| 项目 | 结果 |
| --- | --- |
| 来源 | [`weapp-vite/weapp-vite`](https://github.com/weapp-vite/weapp-vite) |
| 仓库快照 | 468 stars；2026-08-30 仍有提交；MIT |
| Skill 安装量 | 48；属于较新的细分 Skill，安装量低于仓库实际采用度 |
| 当前项目匹配 | 极高：根项目当前使用 `weapp-vite@6.25.0` |
| 代码风险 | 低：Skill 本身是指令和 reference，不附带部署密钥或不透明安装脚本 |

适合当前仓库的内容：

- 先读取 `weapp-vite.config.ts`、`app.json`、`AGENTS.md` 和本地 `dist/docs`，避免凭旧记忆改配置。
- 覆盖 `srcRoot`、分包、npm、自动组件、TypeScript、HMR、MCP、包体分析、截图和日志。
- 明确 Web runtime 不能替代小程序真机证据。
- 先跑 `wv analyze` 再决定 chunk、分包或性能改动。
- 真实产物由 Vite/Rolldown 持有，避免脚本绕过构建器直接补写 bundle。

与现有本地 Skill 的分工：

- 上游 Skill 回答“`weapp-vite` 本身应该怎样配置和诊断”。
- 本地 `weapp-development` 回答“MIP 页面、模块边界、品牌配置和门禁怎样组织”。
- 冲突时以仓库 `AGENTS.md`、锁定依赖版本及本地文档为准。

建议安装命令，暂未执行：

```bash
npx skills add weapp-vite/weapp-vite@weapp-vite-best-practices
```

### 2. `weapp-devtools-e2e-best-practices`

该 Skill 在 `weapp-vite/weapp-vite` 和作者维护的 `sonofmagic/skills` 中内容完全一致；本次下载快照的 `SKILL.md` SHA-256 均为 `c19e7b870c1152b49c2424bec3462eb30af0bc19da0a2ab071ce1132185a7f8c`。建议从构建工具主仓库安装，减少来源数量。

| 项目 | 结果 |
| --- | --- |
| 来源 | [`weapp-vite/weapp-vite`](https://github.com/weapp-vite/weapp-vite/tree/main/skills/weapp-devtools-e2e-best-practices) |
| skills.sh 镜像安装量 | 211 |
| 当前项目匹配 | 极高：仓库已有 `@weapp-vite/miniprogram-automator`、runtime 脚本、截图与视觉差异检查 |
| 代码风险 | 低：安装 Skill 不会增加第二套自动化运行时；实际仍调用当前项目已有工具 |

值得采用的规则：

- 同一 suite 只启动一次 DevTools/automator，会话内通过 `reLaunch` 切页面。
- 先做页面、结构和日志断言，路由稳定后再截图。
- DevTools 与 headless 不一致时，以可复现的真实 DevTools 行为为准，不弱化断言。
- DevTools 登录、服务端口、AppID 和环境失败要与产品缺陷分开报告。
- E2E、DevTools、watch 进程互斥，避免端口争用和假失败。

建议安装命令，暂未执行：

```bash
npx skills add weapp-vite/weapp-vite@weapp-devtools-e2e-best-practices
```

### 3. `weapp-tailwindcss-troubleshoot`，按需

| 项目 | 结果 |
| --- | --- |
| 来源 | [`sonofmagic/skills`](https://github.com/sonofmagic/skills/tree/main/skills/weapp-tailwindcss/weapp-tailwindcss-troubleshoot)；作者主项目 [`sonofmagic/weapp-tailwindcss`](https://github.com/sonofmagic/weapp-tailwindcss) |
| 快照 | Skill 55 installs；Skill 集合仓库 2 stars，但主项目 1,853 stars，2026-08-30 仍维护 |
| 当前项目匹配 | 高：当前使用 `weapp-tailwindcss@5.4.1` 与 Tailwind CSS 4 |
| 建议 | 只在样式生成、HMR、动态 class 或组件隔离故障时安装，不设为日常强制流程 |

它的价值不在泛泛的“使用 Tailwind”，而是提供确定性的排障顺序：CSS 入口进入构建图、`cssEntries` 绝对路径、扫描候选、class 转译、产物和真实页面逐层确认；并明确禁止叠加第二套 Tailwind 生成器。

按需安装命令，暂未执行：

```bash
npx skills add sonofmagic/skills@weapp-tailwindcss-troubleshoot
```

不建议只安装 `sonofmagic/skills@weapp-tailwindcss` 路由 Skill：它主要负责把任务转交到 setup、migrate、troubleshoot、runtime 等子 Skill，单独安装的增量知识有限。

## 不建议安装或仅条件采用

| 候选 | 生态证据 | 不适合当前仓库的原因 | 结论 |
| --- | --- | --- | --- |
| [`gourdbaby/wechat-miniprogram-skill`](https://github.com/gourdbaby/wechat-miniprogram-skill) | 1.2K installs，但只有 9 stars、6 次左右提交 | 明确禁止 TypeScript；要求全部布局使用 `rpx`、默认 BEM、始终使用箭头函数解决 `this`。与当前 TS + Tailwind 技术栈冲突，且部分规则过度绝对化。[Skill 内容](https://skills.sh/gourdbaby/wechat-miniprogram-skill/wechat-miniprogram-skill) | 不安装 |
| [`joneqian/claude-skills-suite@wechat-miniprogram`](https://github.com/joneqian/claude-skills-suite/tree/main/skills/wechat-miniprogram) | 550 installs；仓库 31 stars；最近代码提交 2026-02-10 | 自动抓取式资料集合，示例含 `WeixinJSBridge`、旧用户字段和 `wmxl` 拼写错误；缺少工程门禁与版本路由。 | 不安装 |
| [`joneqian/claude-skills-suite@tdesign-miniprogram`](https://github.com/joneqian/claude-skills-suite/tree/main/skills/tdesign-miniprogram) | 360 installs；同一仓库 | 要求手动“构建 npm”、删除 `style: v2` 等通用步骤，不理解当前 weapp-vite 自动组件和 npm 构建链；容易破坏现有配置。 | 不安装 |
| [`TencentCloudBase/cloudbase-skills@cloudbase`](https://github.com/TencentCloudBase/cloudbase-skills) | 腾讯 CloudBase 官方；10.9K installs；30 stars；2026-08-28 更新；skills.sh 两项 Pass、一项 Warn | 资料丰富，但总 Skill 会引入 UI、认证、部署、数据库和 CLI 全套流程；其小程序 reference 默认纯文字自定义 TabBar，且工具优先级、认证和部署路径与本仓库固定的 mcporter/API Key/Device Flow 规范冲突。 | 不整包安装；遇到新 CloudBase 能力时审阅对应 reference |
| [`wechat-miniprogram/skyline-skills`](https://github.com/wechat-miniprogram/skyline-skills) | 微信官方；每个子 Skill 约 730–865 installs；51 stars；2026-06-03 更新 | 高可信，但只适用于 Skyline。当前 `src/app.json` 未配置 `renderer: "skyline"`，安装会给代理增加一套不适用的渲染规则。 | 确认迁移 Skyline 后安装 |
| [`wechat-miniprogram/ai-mode-skills`](https://github.com/wechat-miniprogram/ai-mode-skills) | 微信官方；约 191 stars；2026-07-28 更新 | 用于把业务能力暴露为小程序 AI 开发模式的原子接口和原子组件，不是普通小程序编码最佳实践。[README](https://github.com/wechat-miniprogram/ai-mode-skills#readme) | 产品决定接入 AI Mode 后再评估 |
| [`WaterTian/wechat-devtools-mcp`](https://github.com/WaterTian/wechat-devtools-mcp) | 380 Skill installs；125 stars；MCP v0.9.16；2026-08-28 更新 | 是相对成熟的第三方 DevTools MCP，但能执行上传、IDE 关闭、任意 runtime evaluate、文件读取等高权限操作；当前仓库的 weapp-vite 已内置 MCP、automator、截图、日志和 runtime harness，再装会重复占用端口并扩大供应链与权限面。 | 当前不安装；只有内置工具出现明确能力缺口时，隔离试用，禁止全量 auto-approve |
| [`yfmeii/weapp-dev-mcp`](https://github.com/yfmeii/weapp-dev-mcp) | 174 stars | README 已建议使用微信开发者工具官方 Skill；当前仓库也已有运行时工具。 | 不安装 |
| [`DoraemonHugU/miniprogram-browser`](https://github.com/DoraemonHugU/miniprogram-browser) | 9 installs、0 stars；`0.1.0-beta.7` | 语义快照和 `@eN` ref 设计有价值，但仍明确标注 beta，且重复当前 runtime harness。 | 暂不安装 |
| [`thisLiu/miniprogram-architecture-kit`](https://github.com/thisLiu/miniprogram-architecture-kit) | 3 installs、4 stars | 默认 uni-app + Vue 3 + Go + Gin + 阿里云 ECS，与当前原生小程序 + CloudBase 架构相反。 | 不安装 |
| `whinc/super-skills@miniprogram-automation` | skills.sh 仍显示 364 installs | 2026-08-30 检查仓库 HEAD 已找不到该 Skill，索引与源仓状态不一致，无法可靠锁定来源。 | 不安装 |

## MCP 选型

当前项目已经具备更短的可信链：

```text
weapp-vite@6.25.0
  -> 内置 MCP（weapp.mcp.enabled）
  -> @weapp-vite/miniprogram-automator
  -> 项目 runtime 脚本、截图与 visual diff
  -> .agents/skills/weapp-runtime-qa
```

因此不建议再并行安装 WaterTian MCP、`miniprogram-browser` 或旧 `weapp-dev-mcp`。第三方 MCP 与纯文档 Skill 的风险不同：它是长期运行、可读文件、可控制 DevTools、可执行上传或任意 JS 的代码。即使仓库 stars 较高，也应按可执行供应链处理，锁版本、限制目录、关闭默认上传权限，并禁止无条件 auto-approve。

上游 `weapp-devtools-e2e-best-practices` 的优势是只规范现有工具如何使用，不新增第二套服务进程。

## 值得参考的 AGENTS.md 写法

### `weapp-vite/weapp-vite`

[`AGENTS.md`](https://github.com/weapp-vite/weapp-vite/blob/main/AGENTS.md) 是本轮最值得参考的公开案例，优点是：

- 根文件负责目录路由，子目录可用更近的 `AGENTS.md` 覆盖。
- 明确“先跑最小验证，再按风险扩大”，而不是每次全仓测试。
- 把构建产物过期、E2E 进程互斥、跨平台路径和稳定断言写成确定性规则。
- 规则与实际脚本、测试、包结构相互对应，不只是“写好代码”一类口号。

它也说明一个反例：上游基础设施仓库的根规则非常长，包含 Rust、编译器、跨平台 CI 等内容；MIP 不应整段复制。应用仓库只需吸收与自身相关的“路由、最小验证、E2E 互斥、稳定证据”原则。

### `TencentCloudBase/CloudBase-AI-Toolkit`

[`AGENTS.md`](https://github.com/TencentCloudBase/CloudBase-AI-Toolkit/blob/main/AGENTS.md) 展示了另一种模式：`AGENTS.md` 作为真源，具体领域拆到 Skills 和 references，并维护不同 IDE 的兼容入口。这种“根文档只路由、详细知识按需加载”的方向值得采用；但它的实际根文件已经很大，不适合照搬到业务仓库。

### 对 MIP 的建议

当前 MIP 的结构方向是合理的：

- 根 `AGENTS.md` 保留架构边界、技术栈、秘密、验证入口和 Skill 路由。
- `weapp-development`、`weapp-design`、`weapp-runtime-qa` 保留项目级决定。
- 上游工具知识放在上游 Skill，不复制进根文档。
- 重要规则同时有脚本或测试门禁；例如自定义导航安全区不能只写在 Markdown 中。

## 推荐执行顺序

1. 项目级安装 `weapp-vite-best-practices`。
2. 项目级安装 `weapp-devtools-e2e-best-practices`。
3. 在根 `AGENTS.md` 的 Skill 路由表中增加：构建配置任务先用前者，DevTools E2E 任务先用后者；MIP 本地 Skill 仍需同时使用。
4. 不安装额外 DevTools MCP。
5. 只有发生 Tailwind 特定故障时，再安装 `weapp-tailwindcss-troubleshoot`。
6. 每次更新依赖后先读当前 `node_modules/weapp-vite/dist/docs/`；Skill 不替代版本化文档。

## 来源

- [weapp-vite 主仓库](https://github.com/weapp-vite/weapp-vite)
- [weapp-vite best practices Skill](https://github.com/weapp-vite/weapp-vite/blob/main/skills/weapp-vite-best-practices/SKILL.md)
- [weapp-vite DevTools E2E Skill](https://github.com/weapp-vite/weapp-vite/blob/main/skills/weapp-devtools-e2e-best-practices/SKILL.md)
- [weapp-tailwindcss 主仓库](https://github.com/sonofmagic/weapp-tailwindcss)
- [sonofmagic Skills](https://github.com/sonofmagic/skills)
- [微信官方 Skyline Skills](https://github.com/wechat-miniprogram/skyline-skills)
- [微信官方小程序 AI Mode Skills](https://github.com/wechat-miniprogram/ai-mode-skills)
- [腾讯 CloudBase Skills](https://github.com/TencentCloudBase/cloudbase-skills)
- [WaterTian WeChat DevTools MCP](https://github.com/WaterTian/wechat-devtools-mcp)
- [skills.sh](https://skills.sh/)
