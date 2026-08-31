# MIP 需求覆盖矩阵

本文件是需求覆盖状态的唯一矩阵，同时记录“实现状态”和“验证状态”。详细产品规则见 [REQUIREMENTS.md](REQUIREMENTS.md)，验收层级见 [ACCEPTANCE.md](ACCEPTANCE.md)。

状态定义见 [README.md](README.md)。`implemented` 不等于已通过运行时、staging、真机或生产验收；验证列可同时包含 `verified-local` 与 `external-wait`。

## 来源范围

- 固定 v1.1.0 PRD：[PRD-v1.1.0.md](sources/github/PRD-v1.1.0.md)
- 用户流程：[里程碑 1 用户流程](sources/github/里程碑1-MIP_v1.1.0_待评审需求_用户流程梳理.md)
- 需求澄清：[2026-08-22 会议纪要](sources/github/会议纪要_20260822_需求澄清.md)
- AME 增补：[2026-08-24 飞书快照](sources/feishu/MIP1.1.0需求看板-2026-08-24.md)
- 视觉：[FIGMA_MAP.md](FIGMA_MAP.md)

来源文件只用于追溯；源表状态和原型演示内容不直接成为实现或验收结论。

## 产品与服务端

| 领域 / 来源 | 范围 | 实现状态 | 验证状态 | 当前证据与缺口 |
| --- | --- | --- | --- | --- |
| 身份与协议 / A1–A4 | 微信身份、两份协议、拆分授权、会话恢复、补资料后恢复原动作 | implemented | verified-local + external-wait | `mip-identity-api`、全局门禁和身份流程测试已覆盖；正式协议、手机号、头像和昵称需真机 |
| 分会与档案 / N4 | 主分会、城市/行业目录、公司/组织经历、隐私 | implemented | verified-local + external-wait | 服务端档案与共用选择器已有测试；正式目录和隐私真机旅程待验 |
| 谁看过我 / N7 | 幂等访问、累计、最新优先、未读、本人可见 | implemented | verified-local + evidence-missing | 迁移、服务端合同和页面已存在；缺可提交运行时闭环 |
| 会员与邀请 / N1、#55 | 可配置方案、玩家权益、会员期邀请归因、续费 | implemented | verified-local + external-wait | commerce/ledger 和邀请 token 测试已覆盖；正式分享、扫码和支付待验 |
| 统一订单 / #56 | 会员、活动、内容订单及服务端使用状态 | implemented | verified-local + external-wait | `mip_orders`、商品快照、状态投影和退款边界已覆盖；正式支付/退款待验 |
| 活动目录 / B1–B8 | Banner、近期/往期、城市/日期/搜索、卡片、分享、详情入口 | implemented | verified-local + external-wait | 页面、服务端查询和日期范围测试已覆盖；正式素材、视频号、日历和分享待验 |
| 活动详情 / C1–C7 | 图文媒体、电话、地图、分享、参与人、邀请来源、报名恢复 | implemented | verified-local + external-wait | 富内容、媒体排序和恢复合同已覆盖；地图、拨号、相册、码图需真机 |
| 付费报名 / C8 | 订单意图、支付参数、ledger、报名确认和退款 | implemented | verified-local + external-wait | 本地事务与错误状态已覆盖；正式商户、回调、查单和真机支付待验 |
| 扫码签到 / D1–D4 | scene、登录/报名/支付恢复、资格复核、签到海报 | implemented | verified-local + external-wait | 服务端签名、过期和幂等合同已覆盖；真实码、扫码、Canvas 和相册待验 |
| 心动与反馈 / D5–D8 | 单关系、双列表、已签到反馈和通知 | implemented | verified-local + external-wait | 关系、反馈和站内 outbox 已覆盖；订阅模板和真机通知待验 |
| 机会目录与详情 / E1–E4 | 状态、筛选、人才范围、详情、发布和最多 8 人团队 | implemented | verified-local + evidence-missing | 页面、服务端列表、团队和 profile reference 测试已覆盖；缺当前完整运行证据 |
| 引荐与兴趣 / E5–E7 | 唯一关系、替换/取消、公开档案、站内通知 | implemented | verified-local + external-wait | 服务端关系和屏蔽复核已覆盖；微信补充通知待验 |
| 机会评论 / E8 | 评论、评价、打 call、举报、屏蔽和运营审核 | implemented | verified-local + evidence-missing | 评论域、内容安全、审计和管理能力已有测试；缺可提交端到端证据 |
| 合作卡与案例 / E9、F2–F3、N5 | 六角色、CRUD、雷达、预览前保存、AI 草稿、案例素材 | implemented | verified-local + external-wait | CRUD、软归档和草稿确认测试已覆盖；录音、媒体和真实 AI provider 待验 |
| 我的活动与相关机会 / F1、F4 | 当前/历史活动、票码、发布/被引荐列表和未读 | implemented | verified-local + evidence-missing | 页面与服务合同已覆盖；缺当前完整运行证据 |
| 成长与勋章 / H4、AME 106–108 | 等级、经验、贡献、游戏币、权益、流水、勋章与调整 | implemented | verified-local + external-wait | 权威账户、不可变流水、佩戴和管理测试已覆盖；正式数值与素材待验 |
| 任务 / H5 | 全员/指定成员、等级、模板、截止、完成和经验奖励 | implemented | verified-local + external-wait | 资格重验、单次完成和同事务奖励已覆盖；真机模板媒体待验 |
| 团队 PK / PRD 60–68、AME 95 | 赛季、队伍、周赛、四类排行和队伍大本营 | implemented | verified-local + external-wait | 服务端计分、快照和会员门禁已有测试；正式规则、数据和视觉待验 |
| 盲盒 / AME 54、56–58 | 目录、规则、概率、库存、抽取、背包和动画 | implemented | verified-local + external-wait | 事务扣币、防负、库存和幂等结果已覆盖；正式规则与视觉待验 |
| AI 机会撮合 / AME 93 | 人才/项目匹配、解释、反馈、设置、重算和 provider 降级 | implemented | verified-local + external-wait | 确定性本地 provider 和隐私边界已覆盖；外部 provider 待验 |
| 知识内容 / AME 94、96–101、103 | 来源、分类、计划、采集、审核、免费/会员/单内容访问和商品 | implemented | verified-local + external-wait | knowledge/community/commerce/ledger 合同已覆盖；正式来源、内容、价格、域名、视频号和支付待验 |
| 跨域评论 / AME 102 | 知识、活动、机会的评论设置、审核和举报 | implemented | verified-local + evidence-missing | 共用规则和各域 adapter 已实现；缺统一端到端证据 |
| 消息与偏好 / G1–G2、AME 104–105 | 站内信、未读、偏好、订阅/客服/服务号 adapter | implemented | verified-local + external-wait | outbox、站内信和偏好重查已覆盖；正式模板、窗口、端点和回执待验 |
| 消息排期 | 模板、活动、收件人快照、定时、撤回和失败复核 | implemented | verified-local + external-wait | 管理领域和独立滚动 scheduler 已实现；对应环境的 CAM/canary/激活读回待验 |
| 知识采集排期 | 每日计划、到期领取、失败计数和滚动单次 timer | implemented | verified-local + external-wait | `mip-knowledge-scheduler` 与管理端 HMAC 合同已实现；云端角色与 timer 读回待验 |

## 管理端

| 领域 / 来源 | 范围 | 实现状态 | 验证状态 | 当前证据与缺口 |
| --- | --- | --- | --- | --- |
| 管理身份与 RBAC / H3 | 七类角色、capability、平台/分会/活动 scope、登录审计 | implemented | verified-local + verified-production | React Web 已有真实管理员登录态读取证据；完整越权矩阵和 Mac/Windows 微信仍待验 |
| 用户管理 / H1 | 组合筛选、详情、控制、分会、角色、脱敏和导出 | implemented | verified-local + verified-production + external-wait | 生产证据仅覆盖不含手机号的零行导出；非空与敏感字段需单独验收 |
| 活动管理 / H2 | CRUD、发布、名单、签到、相册、订单、退款、复制、预览和导出 | implemented | verified-local + external-wait | 本地 action 和测试已覆盖；正式支付、媒体、非空导出和现场操作待验 |
| 机会与用户内容管理 | 机会状态、评论、案例/合作卡治理、撮合设置 | implemented | verified-local + evidence-missing | 服务端 operation 与 Web 表单已接入；缺完整生产 mutation 证据 |
| 成长、任务、游戏管理 | 规则、流水、调整、任务派发、赛季、队伍、排行和盲盒 | implemented | verified-local + external-wait | 本地合同已覆盖；正式配置、媒体和生产写入待验 |
| Banner 与素材 | 上传、绑定、排序、启停和软删除 | implemented | verified-local + verified-production | [生产证据](evidence/admin-web-live-2026-08-28-react/README.md) 覆盖 JPEG、`INACTIVE` 保存和软删除；不能外推到全部用途 |
| 消息与知识管理 | 模板、活动、失败复核、来源、内容、商品、评论和计划 | implemented | verified-local + external-wait | Web 与小程序管理入口已接入；外部投递、真实采集和 scheduler 云端证据待验 |
| React Web 页面 | 一级页面、详情、响应式与真实 API | implemented | verified-local + verified-production | 已提交证据覆盖当时全部一级页面的登录态读取；全部 mutation 和详情旅程未全部生产验证 |
| 小程序管理分包 | 管理路由、手机现场能力和宽屏适配 | implemented | evidence-missing + external-wait | 本地代码与布局证据存在；缺当前可提交全路由报告及 Mac/Windows 微信验收 |

## 视觉映射

| 页面族 | 设计输入 | 实现状态 | 验证状态 | 当前边界 |
| --- | --- | --- | --- | --- |
| 我的、档案、名片、勋章、合作卡、案例、成长 | [FIGMA_MAP.md](FIGMA_MAP.md) 的个人中心与档案节点 | implemented | verified-local + evidence-missing | 设计截图已固定；需当前实现同尺寸对照 |
| 活动列表、详情、报名、参与人、心动 | [FIGMA_MAP.md](FIGMA_MAP.md) 的活动节点 | implemented | verified-local + external-wait | 媒体、地图、扫码、支付和相册仍需真机 |
| 机会列表、筛选、详情、人才、发布 | [FIGMA_MAP.md](FIGMA_MAP.md) 的机会节点 | implemented | verified-local + evidence-missing | 需当前实现同尺寸对照及真实数据旅程 |
| 小程序管理端 | `DESIGN.md` 与管理端代表证据 | implemented | verified-local + external-wait | 375px/1024px 证据不能替代 Mac/Windows 微信 |
| React Web | `admin-web/DESIGN.md` 与 WorkBuddy 信息架构 | implemented | verified-local + verified-production | 响应式读取已验；完整生产写操作仍按领域逐项验收 |

## 更新规则

- 新需求先进入 [REQUIREMENTS.md](REQUIREMENTS.md)，再在本矩阵新增或扩展一行。
- 只有代码和聚焦测试齐全时才能标记 `implemented`。
- 只有可定位证据满足 [ACCEPTANCE.md](ACCEPTANCE.md) 的层级要求时才能提升验证状态。
- 同一能力同时存在本地通过和外部等待时，两个状态都保留。
- 不再创建 PRD、WorkBuddy、Figma 或阶段计划的第二套状态矩阵。
