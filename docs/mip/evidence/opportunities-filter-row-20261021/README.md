# 机会页：移除「地区 + 清除筛选」行

按用户 2026-10-21 要求：「机会筛选和人才合作，都不需要这个地区的+清除筛选这一行。」（附人才合作 Tab 截图，红框标注「深圳 ｜ 清除筛选」行）。本轮只删这一行页面展示，不改筛选能力、服务端合同、数据库或后台。

## 改动

- `src/pages/opportunities/index.wxml`：删除 Tab 下方的「已选筛选 chips + 清除筛选」行。项目机会与人才合作两个 Tab 都不再出现。
- 地区继续由左上角系统 picker 常驻表达（MIW-120），选中即过滤；其余已选条件只在打开筛选面板后可见。
- 清除入口保留两处：筛选面板底部「清除」（`resetFilters`）和无结果空态的「清除筛选」按钮（`clearAppliedFilters`，仍一并把地区回到全国）。
- `appliedFilterChips` 的清单仍在页面脚本里计算，只用于 `appliedFilterCount / hasAppliedFilters` 区分「暂无数据」和「可清除筛选」两种空态；不再渲染。
- 过期注释同步：WXML 筛选按钮注释、脚本中 MIW-120 注释、`tests/mip-opportunity-figma-surfaces.test.ts` 注释。

### 背景核对

- 当前 main 在 2026-10-19（`eb008005`）已把这一行限制为仅项目机会 Tab 显示；用户截图的体验版（搜索占位仍为「搜索」）早于该提交，所以人才合作也看得到。本轮按用户要求两个 Tab 全部移除。
- 该行最初来自 figma 1768_37534 / 2917_4875 的「已选事实由 chips 行表达」实现注释，不是原型中的独立元素；人才合作原稿（1768_37534）本身没有这一行（见 `bugfix-20261019/reference-sources.json` 的 talent finding）。本次为用户明确的产品决定，不涉及新原型，因此不列原型列。

### 双端排查

- `admin-web/`：无对应的筛选 chips 行或管理界面，无需改动。
- `packages/admin-contracts`、`cloudfunctions`、`database/mysql`：筛选参数、列表查询和响应结构未变；没有需要联动的契约、云函数或迁移。

## 测试

- `tests/mip-opportunity-figma-surfaces.test.ts` 新增契约：WXML 不再含 `wx:for="{{appliedFilterChips}}"` 与 `aria-label="清除筛选"`，两处空态 `action-text="清除筛选" bind:action="clearAppliedFilters"` 保留，`hasAppliedFilters` 仍由 `appliedFilterCount` 驱动。对旧 WXML 验证会失败（红），改后通过（绿）。
- 相关 4 个文件 61 用例通过：`mip-opportunity-figma-surfaces`、`mip-opportunity-review-fixes`、`mip-region-switcher`、`mip-cooperation-discovery`。
- 完整门禁见下方「交付状态」。

## 真实开发工具对照

微信开发者工具模拟器（iPhone 系列 390×844 逻辑视口，2x 输出 632px 宽整页长图），连接**测试环境**（画面左下「测试环境」角标为真实环境标识），同一台机器、同一宿主项目、同一 fixture。修改前用 `main@96491685` 原样构建的 dist，修改后用本轮源码构建的 dist；两次都由 `scripts/fullpage-shot.mjs` 在页面 `state` 就绪后注入相同样本数据再截图。

样本数据说明：Banner 来自测试环境真实配置；列表卡片、昵称「示例玩家 A/B」、头像、勋章与地区「深圳」为注入的本地样本（见 `fixtures/`），用于让两个 Tab 都处于「已选地区=深圳」的筛选态，不是真实用户或真实机会，也没有写入任何云端数据。

| Tab | 修改前 | 修改后 | 说明 |
| --- | --- | --- | --- |
| 项目机会 | [before-opportunities.png](shots/before-opportunities.png) | [after-opportunities.png](shots/after-opportunities.png) | 修改前 Tab 下有「深圳 ｜ 清除筛选」行；修改后状态行（招募中/已结束/我的项目/筛选/发布机会）直接接在 Tab 下，页面可滚高度 83→30 逻辑 px，差值与被删行（88rpx+16rpx 边距≈52px）一致。 |
| 人才合作 | [before-cooperation.png](shots/before-cooperation.png) | [after-cooperation.png](shots/after-cooperation.png) | main@96491685 已不显示该行（10-19 限制），修改前后画面一致；本轮保证两个 Tab 的渲染来源都已删除，不会因 `appliedFilterChips` 非空而重新出现。 |

截图 SHA-256 前 16 位：before-opportunities `45bbdceeab15961e`、after-opportunities `cb2cd8a9ce0a1ab8`、before-cooperation `edcbdbdb3f65292f`、after-cooperation `d8e9bb9993a809f0`。

## 交付状态

见 [verification.json](verification.json)。本轮未上传微信体验版/正式版，未部署云函数或后台，未修改数据库；真机画面待用户在下一次体验版上传后复核。
