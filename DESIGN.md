# DESIGN

以当前会员小程序实际视觉系统为准。品牌定制入口是 `src/config/brand.ts` 与 `src/app.css` 的 `@theme`。原型图只是设计输入，不得当作生产 UI 资源打包进页面。

## 设计目标

可信、克制、城市感、可参与。普通用户先浏览公开内容；身份资料只在「我的」或报名/支付时出现。

## 品牌气质

关键词：认真认识，真实连接。禁止在用户界面出现内部实现语言。

## 色彩 Token

Brand 级（改品牌时一起改，见 `src/config/brand.ts`）：

| Token       | 值        | 用途           |
| ----------- | --------- | -------------- |
| canvas      | `#F6F4EE` | 页面背景       |
| panel       | `#FFFEFA` | 卡片与表单     |
| ink         | `#1D2A23` | 主文本         |
| muted       | `#69726B` | 次级文本       |
| line        | `#DDD9CF` | 边框           |
| brand       | `#285E46` | 主按钮、选中态 |
| onBrand     | `#FFFFFF` | 品牌底上的字   |
| brandActive | `#1E4936` | 按压           |
| brandSoft   | `#E2EEE7` | 浅标签         |
| accent      | `#E77745` | 价格、余位     |

Semantic 级（不随品牌乱改）：danger `#B8453E`，success `#2F7758`。

## 字体与字号

微信稳定字体：`PingFang SC`、`Hiragino Sans GB`、`Microsoft YaHei`。主标题 `36–40rpx`，区块标题 `30–34rpx`，正文 `26rpx`，辅助 `22–24rpx`。

## 字重

标题 semibold/bold，正文 regular，辅助说明不要用过低对比度。

## 间距系统

基准 `8rpx`。页面水平边距 `32rpx`，紧凑列表 `24rpx`。同组 `12–24rpx`，区块 `32–48rpx`。

## 圆角

卡片 `20–28rpx`，会员卡 `30rpx`，输入 `16rpx`，主按钮 `18rpx`。

## 阴影

普通卡片只用 `1rpx` 边框。阴影仅用于支付结果等真正悬浮层。

## 页面安全区

底部主操作保留 `safe-area-inset-bottom`。自定义 TabBar 内容高度 `96rpx`（对应微信 48px），并开启底部安全区。

## 导航栏

主 Tab 使用原生导航栏标题。禁止 `navigationStyle: custom` 和 `disableSwipeBack`。

Tab 根页用 TabBar 离开，不要放返回按钮。

二级页必须能离开。有页面栈时走原生返回和侧滑；从编译条件、redirect 或 reLaunch 进入时栈深为 1，左上角原生返回会消失，页面必须提供明显的「返回」「完成」或「返回首页」，并回到 Tab 页。不要用 reLaunch 把用户扔到没有退出方式的二级页。

## TabBar

微信自定义 TabBar（`tabBar.custom: true`）：首页、认识、活动、我的。图标在上、文字在下。选中态由页面 `onShow` 同步 `selected` 索引。可见图标用 `t-icon`；`app.json` 的 `iconPath` 只作微信回退资源，不要在自定义组件里用栅格图。不要使用 TDesign `theme="tag"`。

custom-tab-bar 不是 `page` 的子节点，吃不到 `page {}` 上的 CSS 变量。必须用组件自己的 `index.wxss` 画不透明底色（hex，与 panel token 一致），并在 `.tab-bar` 上定义 `--color-brand` / `--color-muted`。`styleIsolation` 用 `isolated`。按微信文档用底部 `cover-view` 铺不透明底，避免页面内容透出来；可见图标仍用 `t-icon`，不要用栅格图。不要使用 `bg-panel` 当底。

## 卡片 / 表单 / 按钮 / 列表

- 卡片：封面比例固定，状态必须有文字。
- 表单：标签在输入框上方；全宽控件 `box-border w-full max-w-full`。
- 按钮：TDesign large，高 `92rpx`。
- 列表：`flex flex-col gap-*`，不要 `space-y-*`。

## Loading / Empty / Error / Disabled

- 全页加载用骨架，不用 `<t-loading>` 撑满。
- 空态用 `app-empty-state`。
- error 必须提供重试。
- 支付未配置时按钮 disabled，文案「会员服务即将开放」。

## 支付状态

支付中、待确认、成功、失败分开。客户端成功只表示调起完成。会员页、订单页、支付结果页必须能表示 pending。

## 成功和失败反馈

成功：toast + 页面状态。失败：保留内容并给出下一步。不要长时间全屏遮罩。

## 动效原则

克制。Tab 切换可使用轻微触感。不要为装饰加循环动画。

## 图标规范

只用已注册的 TDesign `t-icon`。颜色走语义 token，不在 WXML 写死十六进制。

## 可访问性

点击热区至少 `88rpx`。状态不只靠颜色。正文不低于 `24rpx`。

## 文案语气

对用户说人话。测试支付方案仍用正常产品名，例如「会员体验卡」。

## 组件复用

`event-card`、`member-card`、`phone-login-sheet`、`empty-state` 等见 `docs/component-map.md`。新页面先查映射。

## 业务页面视觉状态

- 会员：方案、有效期、下单中、待确认、已生效
- 活动：可报名、已满、已报名、已取消、已签到
- 订单：待支付、已支付、退款中、已退款
- 后台：loading、empty、forbidden、conflict

## 新页面检查清单

1. Token 来自 `app.css`
2. 有 loading/empty/error
3. 底部安全区
4. 无内部实现语言
5. 页面级自定义组件 `styleIsolation: apply-shared`；`custom-tab-bar` 用 `isolated` + 自有不透明 wxss
6. 不引用原型图当生产资源
7. 非 Tab 页保留侧滑返回，并有明显的返回/完成（编译条件入口也要能离开）
