# 2026-09-13 页面加载检查

## 验证边界

逐路由检查下表全部 70 个页面的有效原生背景、加载/错误标记、空态操作方法是否存在以及生命周期入口。此项为源码检查，不是逐页手机点击验收；“有方法”不代表业务重试已正确。未读取手机日志，白闪消除、冷启动耗时及所有返回数据兼容性仍需运行时验证。

## 本轮确认与修复

- 屏蔽列表：身份请求失败后 accessReady 为 false，原重试直接进入被 guard 拦住的 loadItems，确实不发送请求。心动记录也绕过身份恢复。与访客页统一使用 ensureProtectedPageAccess；身份锁只覆盖身份检查，失败清除就绪标记，列表 AUTH_REQUIRED/资料/协议/手机号错误后下次重试重新检查身份。权限仍由服务端决定。
- 知识列表：目录和内容 Promise.all 导致目录失败让成功正文变成整页错误，或目录慢时正文一直等待。现分别更新状态，目录可独立重试，内容请求及目录请求均忽略卸载后的结果。
- 深色加载：所有路由原生内容背景继承或覆盖为深色；成长页下拉背景保留既有品牌黄，作为显式测试例外而非误改设计；核对并保留已有全局 TDesign 骨架屏颜色，移除机会页重复声明，用自动测试防止后续丢失。消息、AI 草稿、成长、心动错误页展示现有 message，不再把所有错误归为网络。
- 前轮访客非空数据适配及测试继续保留，真实服务端响应与页面模型不一致的根因不再仅靠空列表测试覆盖。

## 重点链路复核

| 页面组 | 代码结论 | 后续边界 |
| --- | --- | --- |
| 发现 / 活动 / 机会 / 我的 | 分区加载、列表渐进图片、缓存与重试已存在；活动默认城市仍依赖身份及分会；我的仍先取身份再启动次要区块 | 不改变默认城市语义，需手机分段耗时定位；不宣称无云端延迟 |
| 活动详情 / 参与者 / 报名 / 签到 / 反馈 / 评论 | 详情首个 onShow 重复刷新已防护；参与者首次 onShow 有 hasShown；报名与扫码是服务端资格链路 | 不把资格/支付前检查当作可删除的延迟，仍需真机 |
| 合作卡 / 案例 / 机会列表和详情 | 列表与详情多数已有请求序号或卸载失效；编辑提交与身份恢复独立 | 本轮不全局绕过图片解析，避免把 cloud 文件 ID 直接送到原生图片 |
| 访客 / 心动 / 屏蔽 | 已统一身份失败恢复；心动服务端 person 嵌套及屏蔽平铺字段与当前页面一致 | 其他响应仍需非空合同覆盖，不能据类型声明视为验证 |
| 知识 | 已分离可选目录与正文，目录失败不阻塞内容 | 媒体及付费正文仍按原授权链路 |
| 会员 / 订单 / 支付结果 / 权益 | 有加载、错误或支付结果专用状态；权益加载有在途共享，支付结果有停轮询逻辑 | 支付与权益必须真机，不改服务端事实 |
| 游戏 / 数字分身 / 名片 / 成长 | 存在多数据组合加载，部分选择串行有前置依赖；不能仅凭 Promise.all 判为 bug | 仍需耗时记录后拆分独立区块，未声称本轮全面加速 |
| 服务入口 / 帮助 / 关于 / 协议 | 静态页面无需模拟 loading/error；服务入口仅次要未读数加载 | 不新增无意义骨架屏 |
| 现场工作台 | 基础背景/错误按钮合同覆盖；沿用现有身份与授权活动边界 | 未宣称现场扫码验收通过 |

## 逐页基础检查清单

所有行均完成源码级背景与错误按钮绑定检查；下列“声明”是状态标记存在，不代表真机通过。

| 路由 | 加载/错误声明 | 缓存或请求防护线索 | 错误操作数 |
| --- | --- | --- | --- |
| `pages/index/index` | loading/error/empty | 缓存、请求序号、卸载处理 | 2 |
| `pages/membership/index` | loading/error/empty | 缓存 | 1 |
| `pages/events/index` | loading/error/empty | 缓存、请求序号、卸载处理 | 1 |
| `pages/opportunities/index` | loading/error/empty | 请求序号 | 3 |
| `pages/profile/index` | loading/error/empty | 缓存、在途共享 | 7 |
| `packages/member/mip-access/index` | loading/error/empty | 缓存 | 2 |
| `packages/member/mip-profile/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-visibility-settings/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-services/index` | 静态或专用状态 | 缓存 | 0 |
| `packages/member/mip-card/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-card-edit/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-avatar/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-people/index` | loading/error/empty | 请求序号 | 2 |
| `packages/member/mip-public-profile/index` | loading/error/empty | 缓存、卸载处理 | 2 |
| `packages/member/mip-blocked/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-branches/index` | loading/error/empty | 缓存 | 1 |
| `packages/member/mip-events/detail/index` | loading/error/empty | 缓存、请求序号、卸载处理 | 1 |
| `packages/member/event-album/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-events/participants/index` | loading/error/empty | 请求序号 | 3 |
| `packages/member/mip-events/registration/index` | loading/error/empty | 缓存、卸载处理 | 2 |
| `packages/member/mip-events/mine/index` | loading/error/empty | 请求序号、卸载处理 | 2 |
| `packages/member/mip-events/check-in/index` | loading/error | 缓存 | 0 |
| `packages/member/mip-events/interaction/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-events/feedback/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-events/comments/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-opportunities/detail/index` | loading/error/empty | 缓存、卸载处理 | 1 |
| `packages/member/mip-opportunities/editor/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-opportunities/mine/index` | loading/error/empty | 卸载处理 | 3 |
| `packages/member/mip-opportunity-matching/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-opportunity-settings/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-cooperation/list/index` | loading/error/empty | 缓存、请求序号 | 3 |
| `packages/member/mip-cooperation/detail/index` | loading/error/empty | 缓存、卸载处理 | 1 |
| `packages/member/mip-cooperation/editor/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-cases/list/index` | loading/error/empty | 请求序号、卸载处理 | 2 |
| `packages/member/mip-cases/detail/index` | loading/error/empty | 缓存、卸载处理 | 1 |
| `packages/member/mip-cases/editor/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-growth/index` | loading/error/empty | 缓存 | 1 |
| `packages/member/mip-badges/index` | loading/error/empty | 请求序号 | 1 |
| `packages/member/mip-badge-detail/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-game/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-game/team/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-blind-box/index` | loading/error/empty | 缓存 | 2 |
| `packages/member/mip-blind-box/detail/index` | loading/error/empty | 缓存、卸载处理 | 1 |
| `packages/member/mip-blind-box/backpack/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-blind-box/coin-entries/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-tasks/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-tasks/detail/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/mip-notifications/index` | loading/error/empty | 缓存、请求序号、卸载处理 | 1 |
| `packages/member/announcements/index` | loading/error/empty | 缓存 | 1 |
| `packages/member/announcement-detail/index` | loading/error/empty | 缓存 | 1 |
| `packages/member/mip-received/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-hearts/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/member/mip-ai/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/member/mip-knowledge/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-knowledge/detail/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/member/mip-knowledge/web/index` | loading/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/orders/index` | loading/error/empty | 请求序号 | 1 |
| `packages/member/order-detail/index` | loading/error/empty | 缓存、请求序号 | 1 |
| `packages/member/payment-result/index` | 静态或专用状态 | 缓存、请求序号、卸载处理 | 0 |
| `packages/member/benefits/index` | loading/error/empty | 缓存、在途共享 | 1 |
| `packages/member/privacy/index` | loading/error/empty | 需结合具体加载方法判断 | 1 |
| `packages/member/privacy-policy/index` | 静态或专用状态 | 需结合具体加载方法判断 | 0 |
| `packages/member/user-agreement/index` | 静态或专用状态 | 需结合具体加载方法判断 | 0 |
| `packages/member/help/index` | 静态或专用状态 | 需结合具体加载方法判断 | 0 |
| `packages/member/about/index` | 静态或专用状态 | 需结合具体加载方法判断 | 0 |
| `packages/admin/dashboard/index` | loading/error/empty | 需结合具体加载方法判断 | 2 |
| `packages/admin/web-login-confirm/index` | loading/error/empty | 需结合具体加载方法判断 | 0 |
| `packages/admin/managed-events/index` | loading/error/empty | 请求序号、卸载处理 | 1 |
| `packages/admin/event-console/index` | loading/error/empty | 卸载处理 | 1 |
| `packages/admin/event-registrations/index` | loading/error/empty | 请求序号、卸载处理 | 2 |

## 自动化验证

- 新增全路由深色背景与错误操作绑定测试，以及统一身份恢复、知识目录失败/延迟、卸载旧响应的行为测试。
- 最终完整小程序测试 221 文件 / 1191 项通过；类型检查、lint、stylelint、源码合同、构建、包体与构建合同通过。最终专项基础背景/操作合同 71 项通过；此前测试对成长页品牌黄的误判已明确修正，不修改既有设计。最终 `pnpm verify:all` 退出码 0：服务端合同通过（608 源文件、262 测试文件、46 种 outbox 事件），Web Node 117 项测试、React 11 文件 / 56 项测试、lint、类型检查、生产构建及响应式源码/产物合同通过。未调整测试超时或跳过测试。
- runtime:preflight 因开发者工具配置的服务端口未监听而失败；未另开项目窗口，未取得逐页运行时画面或手机耗时。本轮未上传或部署。
