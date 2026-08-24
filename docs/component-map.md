# 历史页面与组件映射（同行会 v0.2）

> 本文件用于追溯旧原型的视觉输入，不是当前 MIP 页面事实。当前页面职责以 [MIP 功能需求基线](mip/REQUIREMENTS.md)、`src/app.json` 和 `config/runtime-pages.json` 为准；旧路由名与当前页面职责不一致时，必须先修正当前路由和验收映射，不能按本表宣告功能完成。

本映射在全量 ImageGen 原型二次确认后冻结。它连接视觉来源、页面规格、共享组件、真实数据和允许的实现修正；页面不得绕过本表逐图猜 CSS。

## 组件层级

| 组件/模式 | 视觉来源 | 变体 | 负责内容 | 不负责内容 |
| --- | --- | --- | --- | --- |
| `app-section-header` | A1–A3 | 标题、说明、右侧动作 | 区块层级与统一间距 | 业务查询 |
| `app-event-card` | A1、A3、C4、v0.3 E1/E5 | hero、横卡、紧凑列表 | 图片比例、时间/地点/余位/状态布局 | 报名权限与价格计算 |
| `app-member-card` | A2（修正为单列） | 全宽资料行、锁定摘要；仅图片型场景允许精简网格 | 成员图片、身份摘要和标签 | 决定是否有会员权限；真实介绍和标签不能挤入半宽卡 |
| `membership-pass` 页面模式 | A1、A4、D2 | teaser、非会员、有效会员 | 深绿凭证面和权益入口 | 支付真实性 |
| `phone-login-sheet` | B1 v2 | 报名、会员购买、订单联系 | 一行用途、原生手机号按钮、协议和关闭 | OpenID 获取、手机号解密与绑定 |
| `profile-progress` | B2 v2 | 0–100%、已完成 | 我的页资料完成度和可选 CTA | 阻塞报名或支付 |
| `profile-form` 页面模式 | B3 v2、v0.5 I4–I5 | 初始、编辑、校验、保存中 | 头像、昵称、城市、职业、个人简介和兴趣标签 | 审核与服务端权限 |
| `member-detail-profile` 页面模式 | B4–B5 v2、v0.7 K4 | 完整、锁定、下线 | 适配微信头像分辨率的圆形头像、身份、标签和关于 | 客户端自行解锁隐私字段；把头像拉伸为整屏 hero |
| `event-detail` 页面模式 | v0.5 I1–I2（继承 v0.3 E2） | 可报名、需手机号、会员限制、已报名、截止 | 短 hero、摘要标签、紧凑时间地点、参与者预览、真实发起人、可展开介绍与固定 CTA | 报名资格计算、参与者权限或伪造发起人 |
| `event-participant-list` 页面模式 | v0.5 I3–I4 | 全部、玩家、嘉宾、搜索、分页、空态 | 全宽公开资料卡、身份筛选、头像、行业、职业与简介 | 暴露未授权成员、手机号、报名回答、OpenID 或完整票码 |
| `event-ticket` 页面模式 | C3 | 有效、已取消、已结束 | 凭证视觉、掩码号码、说明、取消入口 | 生成或验证凭证 |
| `confirm-sheet` | C5 | 取消报名、注销、退款确认 | 危险动作二次确认 | 直接执行服务端 mutation |
| `order-card` | D4 | 待确认、已支付、退款中、已退款 | 方案、时间、金额和状态 | 客户端推导最终订单状态 |
| `order-timeline` | D5 | 支付、权益、退款节点 | 用户可读时间线与售后说明 | 内部 ledger、函数或商户字段 |
| `status-result` | D3 | 确认中、成功、失败/超时 | 图标、标题、摘要和后续动作 | 根据 `requestPayment` 直接宣告成功 |
| `app-empty-state` | 设计系统推导 | 空、错误、无权限 | 可恢复说明和动作 | 用假数据填满页面 |
| `settings-list` 页面模式 | A5 | 普通、管理员入口 | 一致图标、行高、分组和箭头 | 业务权限判断 |
| `operations-task-list` 页面模式 | v0.4 G1 | 待审核、退款、异常、空待办 | 工作台任务优先级、数量与入口 | 自行计算服务端状态 |
| `admin-event-list-card` 页面模式 | v0.4 G2 | 草稿、已发布、已结束、已取消 | 封面、状态、时间地点、报名人数和单一入口 | 平铺下游操作或决定权限 |
| `event-operations-hub` 页面模式 | v0.4 G3 | 全局运营、负责人、管理员、现场工作人员 | 活动上下文、允许的任务入口和更多操作 | 绕过服务端活动权限 |
| `admin-event-context` 页面模式 | v0.4 G3、H1、H3、H4 | 紧凑、带封面、无封面 | 子页统一显示活动名、时间和状态 | 重复查询无关业务数据 |
| `roster-summary` 页面模式 | v0.4 H1–H2 | 待审核、候补、已报名、已签到 | 紧凑统计、筛选、单人摘要与展开详情 | 暴露 OpenID、完整票码或越权手机号 |
| `announcement-card` | v0.6 J1–J3 | 首页置顶、列表、历史 | 标题、摘要、状态、日期和详情入口 | 客户端判断可见窗口或发布状态 |
| `member-safety-sheet` | v0.6 J4 | 举报、屏蔽、解除屏蔽 | 简短风险动作与取消 | 客户端直接处罚或泄露举报结果 |
| `report-task-card` 页面模式 | v0.6 J6 | 待处理、处理中、已完成 | 举报原因摘要、对象、时间、状态和处理入口 | 展示内部账号标识或自动决定处罚 |

> 当前代码已有 `app-event-card`、`app-member-card`、`app-section-header` 和 `app-empty-state`。只有两个以上页面共享且行为一致时才新增真实组件；其余“页面模式”通过 token 和规格复用，不为抽象而抽象。

## 页面映射

| 路由 | 原型来源 | 主要组件/模式 | 数据来源 | 必要实现修正 |
| --- | --- | --- | --- | --- |
| `pages/index/index` | A1、v0.7 K1 | brand header、announcement card、featured event、membership pass、member avatar row | overview | 首次公开浏览，不展示登录卡；品牌图为本地压缩资产，活动与公告来自数据库 |
| `pages/explore/index` | A2 | member card、segmented filter | member list | 筛选条件不伪造数据库结果 |
| `pages/events/index` | v0.3 E1（继承 A3） | event card、范围 tabs、时间筛选、搜索 | event list、registrations | 仅此主页面显示活动 TabBar；筛选不伪造服务端数据 |
| `pages/membership/index` | A4、D1–D2 | membership pass、plan selector、phone login sheet | plans、entitlement、orders | 手机号缺失时原地登录；系统支付 UI 不自绘 |
| `pages/profile/index` | A5、B2 v2 | profile progress、full-width service rows、settings list | profile、entitlement、counts | 手机号与资料完成度分开；活动/订单入口使用统一图标行 |
| `packages/member/access/index` | B1 v2 的降级形式 | phone login sheet 内容 | profile | 非正常主路径，不展示清单或两步解释 |
| `packages/member/profile-edit/index` | B3 v2、v0.5 I4–I5 | profile form | profile | 原生头像/昵称控件，个人简介最多 300 字，所有输入不越界 |
| `packages/member/member-detail/index` | B4–B5 v2、v0.7 K4 | member detail profile、locked card | member detail | 权限由服务端过滤，锁定不是错误；头像限制在 `160–192rpx` |
| `packages/member/event-detail/index` | v0.5 I1–I2、B1 v2 | event detail、event participant list、phone login sheet | event detail、profile、registration、event owner、participant preview | 缺手机号原地弹层；有凭证直接进入凭证；报名人数可进入参与者页；分享与日历使用微信原生能力 |
| `packages/member/event-participants/index` | v0.5 I3–I4 | event participant list、member card、line tabs | event participant page | 报名总数与公开人数分开；只呈现审核通过且为本场明确授权的公开资料 |
| `packages/member/registration-confirm/index` | v0.7 K3（继承 v0.5 I5） | compact event identity、field renderer、privacy switch、sticky CTA | event detail、profile、own registration | 不重复活动封面/地点/时间/须知；新报名公开资料默认开启且可关闭，编辑时沿用已保存选择；提交幂等 |
| `packages/member/ticket/index` | v0.3 E4（继承 C3） | event ticket、confirm sheet | registration、event | 凭证号掩码；动态二维码首屏可见；取消二次确认 |
| `packages/member/registrations/index` | v0.3 E5（继承 C4） | segmented filter、event card | registrations | 二级页不显示 TabBar |
| `packages/member/orders/index` | D4 | order card、line tabs | orders/refunds | 二级页不显示 TabBar；主动收敛待确认订单 |
| `packages/member/order-detail/index` | D5 | order timeline、after-sales actions | order/refund/entitlement | 不显示内部订单 ID；退款能力由服务端决定 |
| `packages/member/payment-result/index` | D3 | status result | reconciled order、entitlement | 二级页不显示 TabBar；可信确认后才显示成功 |
| `packages/member/benefits/index` | D2 | membership pass、benefit list、return action | entitlement、plan benefits | 保留原生返回；直接进入时也可返回“我的” |
| `packages/member/privacy/index` | A5 推导 | settings list、confirm sheet | profile/account policy | 最少数据说明；注销为危险二次确认 |
| `packages/member/help/index` | A5 推导 | task-based FAQ accordion、service action | code-owned FAQ | 只回答真实用户任务，不解释授权架构或内部术语 |
| `packages/member/about/index` | A5 推导 | brand header、policy links | code-owned product copy | 不写 Harness/CloudBase 等工程语言 |
| `packages/member/announcements/index` | v0.6 J2 | announcement card、分组列表 | published announcements | 公开浏览；仅显示当前展示窗口内的数据 |
| `packages/member/announcement-detail/index` | v0.6 J3 | article layout、related action | announcement detail | 二级页不显示 TabBar；服务端过滤草稿/撤回内容 |
| `packages/member/blocked-members/index` | v0.6 J4 推导 | member card、settings list、confirm sheet | current user's blocks | 只允许解除自己的屏蔽，不展示目标私密资料 |
| `packages/admin/dashboard/index` | v0.4 G1 | operations task list、compact metrics、settings list | admin dashboard | 待办先于累计指标；不做桌面报表 |
| `packages/admin/managed-events/index` | v0.4 G2 | line tabs、search、admin event list card | managed events | 唯一活动列表；每卡只有进入管理 |
| `packages/admin/event-console/index` | v0.4 G3 | admin event context、event operations hub、settings list | managed event | 只显示当前角色允许的任务入口 |
| `packages/admin/events/index` | v0.4 G4 | grouped form、sticky actions、confirm sheet | event list/detail、save/status mutations | 只做编辑；取消放在更多操作并保留冲突保护 |
| `packages/admin/event-registrations/index` | v0.4 H1–H2 | admin event context、roster summary、line tabs、expandable attendee card | roster page | 真实统计；手机号和导出服从活动权限 |
| `packages/admin/event-feedback/index` | v0.4 H3 | admin event context、评分筛选、反馈分页 | event console | 反馈正文仅反馈查看权限可见；不返回用户标识、手机号或报名回答 |
| `packages/admin/event-managers/index` | v0.4 H3 | admin event context、role summary、settings rows | event managers、approved profiles | 使用用户可懂角色文案，不展示 RBAC |
| `packages/admin/exports/index` | v0.4 H4 | activity-scoped export actions、short-lived result state | export tickets | 只创建参与者和活动订单短期导出，不承载相册审核 |
| `packages/admin/opportunities/index` | v0.6 J5 | search、status filters、opportunity cards | moderated opportunities | 查看发布状态并按版本下架机会 |
| `packages/admin/growth-levels/index` | v0.6 J5 | level list、configuration form、related navigation | growth levels | 等级门槛和基础等级约束由服务端事务校验 |
| `packages/admin/growth-rules/index` | v0.6 J5 推导 | fixed rule list、value configuration form | growth rules | 奖励行为、来源事件和成长类型由服务端固定，运营只能调整数值、每日上限和状态 |
| `packages/admin/growth-entries/index` | v0.6 J6 | ledger list、user search、adjustment confirmation | growth entries | 人工调整和导出分别服从独立 capability 与审计 |

## 状态和交互映射

| 状态 | 统一表现 | 缓存/数据规则 |
| --- | --- | --- |
| cold loading | 与目标内容同形的 skeleton | 仅在没有 ready cache 时出现 |
| background refresh | 保留当前内容，不出现整页 Loading | 同 key 去重，失败不清空内容 |
| empty | `app-empty-state` + 一个可恢复动作 | 不能回退本地假数据 |
| error | 简短原因 + 重试；已有内容时用非阻塞提示 | 不显示堆栈、函数名或请求 ID |
| phone required | 当前页面 `phone-login-sheet` | 成功绑定后恢复原动作 |
| member locked | 公开摘要 + 紧凑会员 CTA | 服务端已过滤受限字段 |
| submitting | 仅触发按钮 Loading、禁止重复点击 | mutation 幂等并失效相关 cache |
| payment confirming | 自动重试、可安全离开 | 回调或权威查单共同收敛 |
| completed | 明确结果与下一步 | 使用服务端读回的数据 |
| blocked relationship | 成员不可见或“已屏蔽”管理行 | 服务端在成员推荐、详情和公开参与者查询统一过滤 |
| report pending | 提交成功提示 + 可安全离开 | 幂等写入，不能展示内部处理人或处罚承诺 |

## 验收映射

- 四张 ImageGen 总览板是视觉输入；DevTools 截图是实现证据。
- 每个视觉板至少选一个主页面和一个纵向流程页面做同尺寸并排比较。
- 比较必须覆盖字体、间距、颜色、图片质量、文案和交互层级。
- ImageGen 的逻辑错误以 `prototypes/full/v0.2/logic-review.md` 为预先批准的偏差；其他偏差必须回写本表。
