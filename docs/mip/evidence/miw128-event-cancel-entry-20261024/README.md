# MIW-128 活动取消报名入口调整 — 证据（2026-10-24）

- 需求：活动详情页不显示「取消报名」；取消入口移至订单详情页（甲方要求，2026-10-24）。
- 代码：`62c87b71` feat(events): move cancellation entry from event detail to order detail (MIW-128)，分支 `MIW-128/supa-ai`。
- 环境：微信开发者工具（iPhone 12/13 (Pro)，390×844 逻辑视口），后端为 TEST 测试云环境；**未上真机**。
- 服务端：`mip-events-api` 已部署到 TEST（`myRegistration` 返回 `canCancel` / `canRetryRefund`，2026-10-24 19:11 部署，GetFunction 回读 Active）。

## 截图清单与真实性标记

| 文件 | 内容 | 真实性 |
| --- | --- | --- |
| `00-event-detail-before-with-cancel-simulated.png` | 修改前：详情页底栏含红色「取消报名」按钮（客服 + 分享 + 取消报名） | **旧版本真实 bundle**（父提交构建，页面方法 `cancelRegistration` 存在验证），底栏状态用 setData 置为已报名外观（真实已报名链路因环境阻塞未走通，见下） |
| `01-event-detail-unregistered.png` | 修改后：未报名状态底栏（客服 + 分享 + 立刻报名），无取消入口 | **真实**（新 bundle，`cancelRegistration` 方法已不存在验证；页面真实加载 TEST 数据） |
| `02-event-detail-registered-appearance-simulated.png` | 修改后：已报名外观底栏（客服 + 分享两个胶囊，无取消入口） | 新 bundle 真实界面 + **setData 模拟已报名状态**（`primaryAction` 置空，即 MIW-53 已报名口径的底栏形态） |
| `03-order-detail-cancel-entry-simulated.png` | 修改后：订单详情新增取消报名入口卡片与「取消报名」按钮 | 新 bundle 真实界面结构 + **setData 模拟订单数据**（无真实支付订单可加载，订单号 `SIM-MIW128-EVENT-ORDER` 为演示数据） |

## 运行时验证记录

- 新 bundle 渲染树中详情页无 `#mip-event-cancel-action` 节点（未报名与已报名外观两种状态下均不存在；dist wxml 中该 id 0 次出现）。
- 旧 bundle（父提交 `62c87b71^` 构建）中同节点存在并可渲染（用 `event.canCancel` 服务端裁决位演示，按钮实测渲染于底栏第三位）。
- 订单详情页 `#order-detail-page` 渲染文本包含「取消报名及关联退款的最终结果以订单状态为准。」与「取消报名」按钮（t-button 组件内）。
- 自动化验证手段：weapp-vite MCP（automator 桥），`cancelRegistration` 方法在新 bundle 详情页已移除（调用返回 `page.cancelRegistration not exists`）。

## 环境阻塞（真实已报名链路截图未能完成的原因）

1. TEST 环境用户侧图片安全检查通道不可用：头像上传服务端返回 `IMAGE_SAFETY_UNAVAILABLE`（2026-10-24 19:40–19:45 两次实测；2026-10-23 15:41 同通道曾成功，属环境级故障）。
2. 游客登录链需原生手机号授权（getPhoneNumber），automator 无法驱动原生授权面板。
3. 付费活动订单的取消入口需真实支付订单（微信支付需真机）。

因此「已报名真实链路」与「真实订单上的取消操作」待真机复测；测试库曾为本轮联调给两个历史测试用户预置了资料行（`mip_profiles` / `mip_profile_tags`，用户 `57f5132b` / `60beddcc`，TEST 库），不涉及业务订单与支付数据。
