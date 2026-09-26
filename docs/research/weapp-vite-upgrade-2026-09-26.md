# weapp-vite 7.3.0 升级评估（2026-09-26）

## 结论

**本轮不采用 7.3.0，保留锁定的 weapp-vite 6.25.0 / weapp-ide-cli 6.1.7。** 候选升级能通过原有完整本地门禁，但产物对比证明它会移除原生 WXSS 中的 iOS 毛玻璃前缀与不支持模糊时的深色背景。未找到无需自定义编译补丁的可靠配置，按“有风险就不强行升级、保持可维护性”的要求恢复依赖。

本轮保留的工程变更只有 `scripts/verify-build.mjs` 的兼容产物检查：检查所有导入 `styles/liquid-glass.wxss` 的消费端，确保编译后仍有 WebKit 模糊声明和条件降级背景。该检查已在 7.3.0 产物上实际失败；原始依赖恢复后完整验证通过。没有修改业务、布局、云函数或数据库，也没有上传小程序或部署云资源。

## 来源与风险范围

- [官方 7.3.0 发布说明](https://github.com/weapp-vite/weapp-vite/releases/tag/weapp-vite%407.3.0)及[完整 changelog](https://github.com/weapp-vite/weapp-vite/blob/weapp-vite%407.3.0/packages/weapp-vite/CHANGELOG.md)：本轮查询 npm 的 latest 为 7.3.0，发布于 2026-09-24。7.x 涉及 Tailwind 作者样式/增量构建、模块归属、HMR 与编译插件，也包含 Wevu Store 行为变更。
- MIP 是原生 WXML + TypeScript 的 Page/Component，没有使用 Wevu Store/Vue/JSX；这些框架迁移不直接影响当前业务。构建器和样式链仍需独立验证，不能仅凭“没用 Vue”判断无风险。
- 使用仓库 Node **22.23.1**、pnpm **11.14.0**；符合候选构建器和其内置 Tailwind core 的要求。保留 classic HMR 与现有配置。
- 候选直接依赖只变更 `weapp-vite 6.25.0 → 7.3.0`、`weapp-ide-cli 6.1.7 → 6.1.8`；实际 Tailwind 适配器解析为 `weapp-tailwindcss 5.5.9`。管理后台独立的 Vite 仍为 8.2.2。候选 lockfile 已撤回。
- 安装出现的 Babel ESLint parser / tsconfck peer 范围警告在旧锁文件中已有，不是本次新增故障。

## 可复现的样式回归

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

这证明兼容声明丢失；具体 iOS 设备的视觉影响尚未实测，不能据此声称所有 iPhone 必现。该层本身就是项目为兼容保留的独立 WXSS，删除它已不满足本次无害升级的条件。

排查候选已安装实现：新版内置集成在 bundle 阶段对所有 WXSS 调用 `compiler.transformCss`，没有用 `cssMatcher` 排除作者样式；其依赖的最终化逻辑会移除未列入保留名单的 WebKit 属性和 `@supports`。尝试公开的 `autoprefixer.remove: false` / `atRules` 配置后，WebKit 声明仍会被删除，因此仅关闭 Autoprefixer 清理不足以解决。没有提交 node_modules 修改、复制旧编译器代码或自行追加构建产物。

本地调试记录（均在 Git 忽略目录）：`.tmp/upgrade-20260926/build-before.json`、`build-after.json`、`build-comparison.json`、`styles.diff`。另外使用仍安装的旧编译器输出到独立临时目录，27 个旧 WXSS 哈希均与最初基线匹配，避免把源码变化误当成升级差异。

## 验证与运行时边界

- 候选的原有 `pnpm verify:all` **通过**：小程序 239 个测试文件 / 1317 个用例，服务端合同、类型、lint、构建与预算通过；Web 144 个 Node 用例及 63 个 React 用例通过。日志为 `.tmp/upgrade-20260926/verify-all.log`。
- 新增兼容检查在候选产物上 **按预期失败**，首个报错为 `Compiled liquid glass lost its iOS blur or opaque fallback: dist/components/sticky-actions/index.wxss`。这也是没有采用候选的直接原因。
- 候选运行时尝试：开发者工具可登录和连接，IDE 编译诊断为 0；6 类受控代表状态通过。记录了 25/70 路由，其中 23 通过、2 失败，随后身份 fixture 恢复失败中断；不是 70 路由验收通过。
- 失败现象：`pages/index/index` 长时间为 loading；`packages/admin/event-registrations/index` 显示“运营服务返回了无效的参与者名单”；身份 fixture 返回首页后未恢复预期页面。这些来自候选运行环境，**尚未归因**。JS/WXML 与基线相同不能单独排除自动化工具、会话、接口部署或运行环境因素。下一轮在保留版本上复现，再分别排查首页在途请求、非空名单 DTO 和身份 fixture 恢复。
- 原始运行证据仅保留本地 `.tmp/runtime-evidence/2026-09-26-weapp-vite-730/`；其中可能包含当前用户数据，不纳入提交。会话最终报告 `cleanup.status: closed`。

恢复版本后的最终验证：

- `pnpm install --frozen-lockfile` 成功；实际安装版本回到 6.25.0 / 6.1.7，`package.json`、`pnpm-lock.yaml`、构建配置与 HEAD 无差异。
- **`pnpm verify:all` 退出码 0**，包含完整小程序/云函数与 Web 检查；新增兼容门禁通过，测试数量与候选原门禁相同。最终日志为 `.tmp/upgrade-20260926/verify-restored.log`。
- 重新构建的 **1632 个文件、4,539,166 字节全部与原始基线哈希一致**，无新增、删除或改变的产物；比较摘要为 `.tmp/upgrade-20260926/build-restored-comparison.json`。
- `pnpm runtime:preflight` 退出码 0，配置、路由、实际开发者工具登录和服务端口检查通过。这是前置条件检查，未重跑完整路由验收，不覆盖上面列出的失败现象。
- `git diff --check` 通过。运行时或真机未过的范围继续保留，不由本地门禁替代。

## 后续升级条件

待上游支持保留该兼容层，或已有真实 iOS/Android 对照证据允许替换它之后再尝试。重跑完整门禁、8 个消费端产物检查和同条件运行/视觉检查。6.25.1 也涉及后置样式处理，本轮没有将它当作未经验证的替代升级。
