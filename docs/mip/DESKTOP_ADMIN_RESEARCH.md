# MIP 小程序管理端桌面化研究

更新日期：2026-08-25。

本文回答一个具体问题：MIP 是否可以暂不建设独立网页后台，先把现有小程序管理分包适配为手机和微信电脑端共用的主要运营工作台。资料范围只包括微信开放文档、微信官方 API 文档和当前仓库代码；在线原型只作为功能输入，不作为平台能力证据。

## 结论

**可以，推荐把“小程序管理端同时适配手机与电脑”作为当前阶段的主方案，但不应把它定义为永久取消网页后台。**

微信官方已经提供这条技术路径：在 `app.json` 启用 `resizable: true` 后，Windows、Mac 等大屏设备上的小程序默认窗口会变大，用户可以自由拉伸；页面可以使用 WXSS Media Query、`match-media`、页面 `onResize` 和组件 `resize` 响应显示区域变化。[响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html)｜[全局配置 `resizable`](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#resizable)

这意味着 MIP 可以先维护一套管理 UI 和一套业务逻辑，在手机端承担现场操作，在电脑端提供宽屏列表、筛选、表单和批量处理。与此同时，管理端接口仍应改造成渠道中立契约，后台服务仍应按用户、活动、订单、权限、消息和知识库拆成内部深模块。这样后续如果真实使用证明小程序电脑端不够用，再增加 Web adapter 和网页 UI，不需要重写服务端。

该方案成立有三个条件：

1. 首期运营人员都能使用已登录的 Windows 或 Mac 微信，不要求在普通浏览器直接访问后台。
2. 现场扫码签到等移动端能力继续由手机小程序完成，不强求电脑端覆盖全部设备能力。
3. 上线前使用真实 Windows、Mac 微信客户端完成宽屏、键盘、文件、权限和长列表验收，不能只看开发者工具模拟效果。

## 已证实的平台能力

### 1. 微信电脑端允许小程序窗口自由拉伸和最大化

- `app.json` 的全局属性 `resizable` 用于控制 PC 小程序是否支持用户任意改变窗口大小，包括最大化；默认关闭。[全局配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)
- 微信官方“大屏模式”说明明确覆盖 Windows、Mac、车机和安卓 WMPF；启用后默认窗口尺寸会变大，用户可以自由拉伸。[响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html#%E5%90%AF%E7%94%A8%E5%A4%A7%E5%B1%8F%E6%A8%A1%E5%BC%8F)
- 当前 PC 接入指南称，如果不启用大屏适配，PC 框架会缩放页面；窗口拉伸超过 `1.5x` 后，还可能把页面栈顶的两级页面自动分成左右两栏。[PC 小程序接入指南：自适应双栏模式](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_2-2-%E8%87%AA%E9%80%82%E5%BA%94%E5%8F%8C%E6%A0%8F%E6%A8%A1%E5%BC%8F)

微信官方另一份大屏设计指南仍称“未适配的小程序不能切换窗口尺寸”，并列出竖屏 `414 × 736`、横屏 `768 × 1024` 的固定显示规则，两份官方资料对未适配回退行为并不一致。[小程序大屏适配指南：未适配小程序体验](https://developers.weixin.qq.com/miniprogram/design/adapt.html#_1-2-%E6%9C%AA%E9%80%82%E9%85%8D%E5%B0%8F%E7%A8%8B%E5%BA%8F%E5%9C%A8pc%E7%AB%AF%E4%BD%93%E9%AA%8C)

因此，未适配模式在目标客户端的具体行为属于未知。MIP 若要把电脑端作为正式管理工作台，应主动启用 `resizable: true` 并自行实现响应式布局，不应依赖固定窗口、自动缩放或自动双栏等回退效果。

### 2. 小程序原生布局能力足以实现响应式管理界面

- WXSS 支持标准 Media Query，可以按显示区域宽度切换布局。[响应显示区域变化：Media Query](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html#media-query)
- `match-media` 可以按最小/最大宽高和横竖方向条件展示或隐藏 WXML 节点，官方标明支持 Windows 和 Mac，最低基础库为 `2.11.1`；当前组件文档只标明 WebView 渲染框架支持。[`match-media`](https://developers.weixin.qq.com/miniprogram/dev/component/match-media.html)
- 页面可以使用 `onResize`，自定义组件可以使用 `pageLifetimes.resize`，回调会返回新的 `windowWidth` 和 `windowHeight`。官方同时说明，全局 `wx.onWindowResize` 可用但不是推荐方式。[响应显示区域变化：尺寸事件](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html#%E5%B1%8F%E5%B9%95%E6%97%8B%E8%BD%AC%E4%BA%8B%E4%BB%B6)
- `wx.getWindowInfo()` 可读取可用窗口宽高、安全区域和状态栏信息，官方标明支持 Windows 与 Mac。[`wx.getWindowInfo`](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getWindowInfo.html)
- `wx.getDeviceInfo()` 能区分 `windows`、`mac`、移动客户端和开发者工具；但布局优先应按窗口尺寸判断，平台判断只用于确有平台差异的能力。[`wx.getDeviceInfo`](https://developers.weixin.qq.com/miniprogram/dev/api/base/system/wx.getDeviceInfo.html)

`pageOrientation: "landscape"` 用于屏幕旋转或固定横屏，并不是 PC 宽屏管理端的替代方案；PC 工作区仍应使用 `resizable` 和窗口宽度响应。[响应显示区域变化](https://developers.weixin.qq.com/miniprogram/dev/framework/view/resizable.html)

### 3. PC 端具有管理工作台常用的文件和键盘能力

- 微信官方 PC 指南提供 `wx.onKeyDown` 和 `wx.onKeyUp`，可以用于增强键盘操作。[PC 小程序接入指南：键盘事件](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_3-1-%E9%94%AE%E7%9B%98%E4%BA%8B%E4%BB%B6)
- `wx.chooseMedia`、`wx.chooseMessageFile` 和 `wx.openDocument` 官方均标明支持 Windows 与 Mac，可以覆盖素材选择、会话文件导入和文档预览。[`wx.chooseMedia`](https://developers.weixin.qq.com/miniprogram/dev/api/media/video/wx.chooseMedia.html)｜[`wx.chooseMessageFile`](https://developers.weixin.qq.com/miniprogram/dev/api/media/image/wx.chooseMessageFile.html)｜[`wx.openDocument`](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.openDocument.html)
- `wx.saveFileToDisk` 仅在 PC 端支持，可将导出文件保存到用户磁盘，适合名单、订单和统计导出。[`wx.saveFileToDisk`](https://developers.weixin.qq.com/miniprogram/dev/api/file/wx.saveFileToDisk.html)
- PC 微信支付存在官方二维码支付和推送至手机支付路径；项目仍必须以服务端支付 ledger 和异步回调作为权益事实。[PC 小程序接入指南：支付能力](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_4-pc-%E7%AB%AF%E5%B0%8F%E7%A8%8B%E5%BA%8F%E6%94%AF%E4%BB%98%E8%83%BD%E5%8A%9B)｜[`wx.requestPayment`](https://developers.weixin.qq.com/miniprogram/dev/api/payment/wx.requestPayment.html)

这些能力能支持运营后台的大多数高频任务，但不意味着每一个移动设备 API 都能在 PC 端使用。

### 4. Windows 与 Mac 的框架接近，但版本不能假定一致

微信官方称 Windows 与 Mac 的 PC 小程序使用同一套框架，平台侧兼容操作系统接口，接口能力和上层表现“几乎一致”；这不是完全一致的承诺。[PC 小程序接入指南：框架底层能力区别](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_1-2-%E6%A1%86%E6%9E%B6%E5%BA%95%E5%B1%82%E8%83%BD%E5%8A%9B%E5%8C%BA%E5%88%AB)

同一页面还提示 Mac 微信 `3.x` 最高支持基础库 `3.3.5`，体验更新能力需要 Mac 微信 `4.0`。因此，不能只按最新基础库开发后假定所有运营人员的 Mac 客户端都已支持；应固定项目最低客户端矩阵并进行真实客户端测试。[PC 小程序接入指南](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/)

`wx.setWindowSize` 虽然是 PC 专用接口，但已从基础库 `2.11.0` 停止维护，项目不应尝试用代码强制窗口尺寸；窗口拉伸交给用户，页面只响应实际尺寸。[`wx.setWindowSize`](https://developers.weixin.qq.com/miniprogram/dev/api/ui/window/wx.setWindowSize.html)

## 已证实的限制

### 1. `resizable` 是整个小程序的全局开关

`resizable` 位于 `app.json` 全局配置，不是页面或分包配置。[全局配置](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html)

当前仓库的 `src/app.json` 尚未启用该字段。因此开启桌面大屏后，变化会同时覆盖会员端与管理分包，不能只让管理页面进入大屏模式。项目需要：

- 会员端页面在宽屏下保持居中、受控最大宽度，避免手机视觉被无限拉大；
- 管理端页面按窗口宽度使用完整工作区；
- 对全部主 Tab 和公共组件做桌面回归，而不只是验收管理分包。

### 2. PC 大屏模式不支持自定义导航栏

微信官方明确说明，由于 PC 交互需要拖拽区域等原因，PC 大屏小程序不支持自定义导航栏。[PC 小程序接入指南：接入大屏适配能力](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_2-1-%E6%8E%A5%E5%85%A5%E5%A4%A7%E5%B1%8F%E9%80%82%E9%85%8D%E8%83%BD%E5%8A%9B)

当前管理分包页面使用系统导航栏，方向正确；但 `src/pages/opportunities/index.json` 单独配置了 `navigationStyle: "custom"`。启用全局大屏前，应把该页面恢复为系统导航栏或验证明确的 PC 降级行为。这个限制针对 navigation bar，官方资料没有说明自定义 TabBar 因此必然不可用，不能扩大解释。

微信关于电脑端自定义导航栏的官方公告还要求顶部保留窗口拖拽区域，并建议读取 `statusBarHeight`、`safeArea` 和胶囊位置，避免按 Windows/Mac 写死尺寸。[电脑端小程序导航栏优化公告](https://developers.weixin.qq.com/community/minihome/doc/0006842d5f02f0106192b552f66801?blockType=99)

### 3. 宽屏下不应继续大量依赖 `rpx`

微信官方说明 `rpx` 表示页面总宽度的 `1 / 750`，并明确提醒为了支持手机和 PC 等大屏设备，不建议滥用 `vw`、`rpx` 等按屏幕宽度缩放的单位；必要时应结合 Media Query。[WXSS：基于屏幕宽度比例的长度单位](https://developers.weixin.qq.com/miniprogram/dev/framework/view/wxss.html#%E5%9F%BA%E4%BA%8E%E5%B1%8F%E5%B9%95%E5%AE%BD%E5%BA%A6%E6%AF%94%E4%BE%8B%E7%9A%84%E9%95%BF%E5%BA%A6%E5%8D%95%E4%BD%8D)

MIP 现有页面大量使用 `rpx`。桌面适配不能只加一个 `resizable` 开关；管理端的字体、表格列宽、侧栏、筛选器和间距应改为 `px`、百分比、Flex/Grid、`min/max-width` 与 Media Query 的组合。会员端则使用受控内容宽度保留现有视觉比例。

### 4. 电脑端不能替代全部现场能力

`wx.scanCode` 官方 API 页面当前没有标注 Windows 或 Mac 支持，而同站点支持 PC 的 API 会明确列出“微信 Windows 版：支持”“微信 Mac 版：支持”。因此，在没有真实客户端证据前，扫码签到应视为手机端职责，不能把 PC 扫码列入验收承诺。[`wx.scanCode`](https://developers.weixin.qq.com/miniprogram/dev/api/device/scan/wx.scanCode.html)

这并不妨碍电脑端展示签到码、查看名单和处理异常；只是实际扫描动作继续由手机小程序完成。

### 5. 它仍然不是普通网页后台

官方把 PC 小程序定义为“在 PC 端运行的微信小程序”；网页、URL Scheme 等能力最终也是拉起 PC 微信中的指定小程序页面。[PC 小程序接入指南](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/)

因此该方案要求运营人员安装并登录微信，不具备普通浏览器后台的直接 URL、浏览器多标签页、独立 Cookie 会话或不依赖微信账号的登录方式。渠道中立契约仍值得建设，因为这些差异属于客户端 adapter，而不是业务规则。

## 对当前仓库的推断

以下结论是基于官方能力和当前代码结构作出的工程判断，不是微信官方承诺。

### 推荐形态

首期保留一个小程序应用和一个管理分包：

```text
手机管理端                       微信电脑端管理端
  → 移动卡片、现场操作              → 侧栏、表格、筛选、批量操作
        ↘                         ↙
          同一组渠道中立管理合同
                    ↓
         用户 / 活动 / 订单 / 权限 /
         消息 / 知识库内部深模块
                    ↓
          capability / scope / audit
```

- 手机端继续负责扫码、现场处理、快速审批和紧急操作。
- 电脑端负责用户、活动、订单、权限、消息、知识库、导出和审计等高信息密度任务。
- 两端使用相同页面路由和 module；只在布局复杂度确实不同的区域用 `match-media` 切换 WXML 结构。
- 业务状态、权限、金额、活动资格和审计不根据设备平台分叉。

### 推荐响应式分层

具体断点属于项目设计决策，不是微信平台规定。建议先以三档实现并通过真实窗口校准：

| 显示区域 | 管理端布局 | 主要交互 |
| --- | --- | --- |
| `< 600px` | 单栏卡片、底部或页内操作 | 手机现场操作 |
| `600–959px` | 双列卡片或主从布局 | iPad、窄电脑窗口 |
| `>= 960px` | 管理侧栏、筛选区、数据表格、详情抽屉 | 电脑运营工作台 |

断点应集中在设计 token 或响应式原语中，页面不得各自发明一套宽度。宽度变化优先通过 WXSS Media Query 处理；只有表格列策略、虚拟列表测量或主从状态确实需要 JavaScript 时，才使用页面 `onResize`。

### 推荐 UI 方向

- 沿用 MIP 的黑色、黄色、卡片、圆角、字体和状态色，不复制 WorkBuddy 原型的蓝白视觉。
- 参考 WorkBuddy 的信息架构、筛选项、表格字段和管理动作，但重新组织成 MIP 设计系统的桌面密度。
- 手机端避免塞入完整桌面表格；同一数据在手机端使用卡片或关键列，在电脑端显示完整列、批量选择和固定操作区。
- 键盘快捷键只能增强效率，所有关键操作仍保留可见按钮、明确确认和权限反馈。

这与微信官方大屏设计指南推荐的左右伸缩、换行、横向拓展、分层展示和侧边栏模式一致；官方也明确指出 PC 主要使用鼠标与键盘，移动端手势需要转换成稳定的 PC 交互。[小程序大屏适配指南](https://developers.weixin.qq.com/miniprogram/design/adapt.html)

## 当前未知，必须实测

以下事项无法从官方公开资料得出当前 MIP 的确定结论：

1. 目标运营人员实际使用的 Windows/Mac 微信版本和对应基础库分布。
2. TDesign MiniProgram 现有表单、弹层、日期组件在不同 PC 微信版本上的鼠标、焦点、Tab 键和滚动表现。
3. 当前自定义 TabBar 在开启 `resizable` 后的完整视觉与交互表现；官方文档只明确限制自定义导航栏。
4. 如果未来切换到 Skyline，`match-media` 的等价结构响应方案；当前官方组件文档只列 WebView 支持。
5. 微信 PC 窗口在不同系统缩放比例、显示器和最大化状态下的具体最小尺寸、字体渲染和性能。
6. 长列表、大量选择、批量导出、媒体上传和连续数小时运营使用的稳定性。
7. `wx.scanCode` 在特定 PC 客户端是否存在未文档化行为；在官方补充支持声明或真实验收前仍按手机端能力处理。

## 建议的首个验收切片

在投入全部管理页面适配前，先完成一个桌面化基础检查点：

1. 在独立变更中启用 `resizable: true`，同时建立会员端居中容器与管理端宽屏容器。
2. 处理自定义导航栏冲突，保证普通会员页面在手机、窄窗和最大化窗口下不变形。
3. 选择“活动管理”完成第一个双端纵向切片：活动列表、筛选、创建/编辑、报名名单、导出、审计；手机端另验扫码签到。
4. 同步完成一个高密度页面“用户管理”，验证表格列、搜索、分页、详情、权限脱敏和窄屏卡片降级。
5. 用开发者工具的 PC 自动预览拉起真实 PC 微信，再在 Windows 与 Mac 至少覆盖窄窗、普通宽窗和最大化。官方测试入口见 [PC 小程序接入指南：测试方法](https://developers.weixin.qq.com/miniprogram/dev/framework/pc/#_6-%E6%B5%8B%E8%AF%95%E6%96%B9%E6%B3%95)。
6. 通过后再并行适配订单、权限、消息、知识库、任务、机会和成长等管理模块。

首个切片的退出条件应包括：手机与 PC 读取同一业务事实；尺寸切换不丢状态；平台、城市分会和活动 scope 越权均被拒绝；编辑冲突可恢复；每个 mutation 留有审计；文件导出在 PC 可保存；移动扫码保持可用；真实 Windows/Mac 截图与操作记录齐全。

## 决策建议

| 方案 | 判断 | 取舍 |
| --- | --- | --- |
| **小程序管理端双端自适应，同时保留 Web-ready 契约** | **推荐** | 当前交付最快、业务事实只有一套；后续仍可低成本增加网页端 |
| 立即建设独立网页后台 | 暂缓 | 桌面体验上限更高，但当前会同时承担 Web 工程、登录、Session、CSRF 和双端 UI 成本 |
| 永久只做手机尺寸管理页，依赖 PC 自动缩放/双栏 | 不推荐 | 开发最少，但信息密度、导航和批量操作不可控，不适合作为正式运营工作台 |

最终建议是：先把小程序管理端建设为正式的手机与 PC 双端产品，WorkBuddy 只提供功能和信息架构参考，视觉继续遵循 MIP；渠道中立合同和服务端深模块仍按原计划实施。等第一批运营人员完成真实桌面试用后，再依据明确痛点决定是否建设网页 UI。
