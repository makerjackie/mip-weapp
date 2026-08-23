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

1. [DESIGN.md](../../../DESIGN.md)
2. [docs/page-specs.md](../../../docs/page-specs.md)

## Steps

1. 品牌入口是 `src/config/brand.ts` 与 `src/app.css` `@theme`。
2. 会员、活动、订单、支付页沿用现有视觉状态，不要改成无关的展示皮肤。
3. TabBar 必须是微信自定义 TabBar：图标在上文字在下、`96rpx` + 安全区、页面 `onShow` 同步 `selected`。禁止 TDesign `theme="tag"`。custom-tab-bar 必须 `isolated`，并用自己的 wxss 画不透明 hex 底，不能依赖 `bg-panel`。
4. 需要的状态都要能看见：loading、empty、error+retry、未配置、支付关闭。
5. 不要用假数据把界面填满。
6. 非 Tab 页禁止关掉侧滑返回。编译条件入口会变成栈根，必须有明显的「返回」「完成」或「返回首页」（`app-page-exit` 或现有返回首页），不要只靠原生返回箭头。

## Scripts

`pnpm stylelint` · `pnpm build`

## Safety

页面级自定义组件必须 `styleIsolation: apply-shared`。`custom-tab-bar` 必须 `isolated`，并用自己的 wxss 画不透明底。

## Forbidden

拼接 Tailwind class、`space-y-*`、在自定义 TabBar 里用栅格图标、使用 `theme="tag"`、暴露 OpenID。

## Verify

`pnpm verify:source`

## Done

token 与代码一致；用户界面没有内部实现语言。

## Docs

[DESIGN.md](../../../DESIGN.md) · [RUNTIME_ACCEPTANCE.md](../../../docs/RUNTIME_ACCEPTANCE.md)
