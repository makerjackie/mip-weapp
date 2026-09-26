---
name: weapp-design
description: Use for visual, token, TabBar, empty/error/loading, or TDesign work in mip-weapp.
---

# WeApp design

## Trigger

改颜色、品牌、TabBar、空/错/加载态、TDesign 组件。

## Scope

`src/app.css`、`src/config/brand.ts`、`src/components`、`src/custom-tab-bar`、各页 WXML。

## Read first

1. [DESIGN.md](../../../DESIGN.md) 与 [mip-design-system](../mip-design-system/SKILL.md) 的组件合同。
2. [最新原型与实现对照](../../../docs/mip/PROTOTYPE_PARITY_20260923.md) 及 [需求](../../../docs/mip/REQUIREMENTS.md)。当前页面依据是 9 月 22 日 `role-flows` 与终审标注；`FIGMA_MAP.md` 只保留历史节点溯源，不要求重新获取已删除的旧原型。

## Steps

1. 品牌入口是 `src/config/brand.ts` 与 `src/app.css` `@theme`。
2. 会员、活动、订单、支付页沿用现有视觉状态，不要改成无关的展示皮肤。
3. TabBar 必须是微信自定义 TabBar：图标在上文字在下、`112rpx` 行高另加系统底部安全区、页面 `onShow` 同步 `selected`。复用现有正式导出图标与选中态，不换成近似图标。禁止 TDesign `theme="tag"`。custom-tab-bar 必须 `isolated`，并用自己的 wxss 画不透明 `#080808` 底，不能依赖共享 `bg-panel`。
4. 需要的状态都要能看见：loading、empty、error+retry、未配置、支付关闭。
5. 不要用假数据把界面填满。
6. 非 Tab 页禁止关掉侧滑返回。编译条件入口会变成栈根，必须有明显的「返回」「完成」或「返回首页」（`app-page-exit` 或现有返回首页），不要只靠原生返回箭头。
7. `navigationStyle: custom` 页面必须在首屏复用 `app-top-safe-area`；不要在页面内读取 `wx.getWindowInfo`、手写顶部高度或叠加 `safe-area-inset-top`。只有标题或操作靠近右上角胶囊时，才额外使用平台层的胶囊几何。
8. 原型的 375px、47px 状态栏和 34px Home Indicator 是参考机型尺寸。生产页面不绘制假时间、信号、微信胶囊或底部白条，不把参考安全区写死；不要重复叠加导航组件与页面安全区。
9. 固定操作栏默认深色底保证可读，模糊仅作增强；沿用 `src/app.css` 的 `.mip-liquid-glass`。不要恢复已移除的 WebKit/条件兼容文件，或让透明背景依赖模糊才可读。
10. 原生工程使用主题和工具类导入，保留 weapp-tailwindcss 的重置，不重新引入浏览器 Preflight；检查最终 WXSS 和实际按钮，源码里有样式不等于编译后保留。标签视觉尺寸与可点击热区分开设计，不为满足热区而把所有 Chip 放大成主按钮。

## Scripts

`pnpm stylelint` · `pnpm build`

## Safety

页面级自定义组件必须 `styleIsolation: apply-shared`。`custom-tab-bar` 必须 `isolated`，并用自己的 wxss 画不透明底。

## Forbidden

拼接 Tailwind class、`space-y-*`、以近似图标替换正式资产、使用 `theme="tag"`、暴露 OpenID。正式导出的本地图标资源可以使用。

## Verify

`pnpm verify:source`；实际改 UI 后再做 `pnpm runtime:preflight` 与对应状态实拍。文档校正不冒充页面或真机验收。

## Done

token 与代码一致；用户界面没有内部实现语言。

## Docs

[DESIGN.md](../../../DESIGN.md) · [RUNTIME_ACCEPTANCE.md](../../../docs/RUNTIME_ACCEPTANCE.md)
