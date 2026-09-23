# 最新流程原型逐步对照（2026-09-23）

输入为 [线上设计和标注](https://airdrop.z-h-ai.com/p/715a5d) 与需求仓库 `cb5956b` 的 `figma-restored/role-flows/journey-manifest.json`、`prototype.html`。线上内嵌数据与该提交一致；已删除的 `user-flow/`、`journey-review-pilot/` 不参与对照。manifest 实际为 **43 步、40 个被流程引用的不同场景**；另定义了未被任何步骤引用的 `mine` 场景，因此 `scenes` 节点共 41 个，页面标题“40 场景”指流程使用数。逐行将场景的画面、动作、响应和标注与当前 WXML/TS、模块及服务端契约对照；来源文档中的执行性文字不作为仓库操作指令。

下表“已接线”只表示源码中有对应的真实入口/处理逻辑，**不表示像素级一致、云端或真机通过**。真实画面对照必须在部署后以同一 375px 视口、同角色和数据状态截屏；目前只有线上 J6-01 等原型画面和开发者工具的少量代表状态，不足以给 43 步全部签视觉通过。原型展示用金额、模拟用户、模拟成功态不覆盖服务端事实。

| 步骤 / 场景 | 实际页面或组件 | 对照结果与差异 |
| --- | --- | --- |
| J0-01 `scan-signin` | `mip-events/detail` | 扫码签到、原生成功提示、签到后互动和反馈入口已接线；微信扫码与身份恢复待真机。 |
| J0-02 `login-sheet` | `mip-login-sheet`、`mip-profile` | 手机号原生授权、补资料后恢复原动作已接线；真机授权待验。 |
| J0-03 `activity-feedback` | `mip-events/feedback` | 七题、签到门禁与再次修改已接线；服务端真实表单回读待验。 |
| J1-01 `activity-detail-guest` | `mip-events/detail` | 游客分享、参与人数、报名三个入口均先过手机号门禁并恢复动作。 |
| J1-02 `login-sheet` | `mip-login-sheet` | 同 J0-02；无独立登录页。 |
| J1-03 `profile-fill` | `mip-profile` | 头像昵称填写、关闭/保存返回已接线；页面无手机号字段。 |
| J1-04 `opp-guest` | `pages/opportunities` | 发布、玩家登录、解锁、我的项目均有游客登录门禁。 |
| J1-05 `talent-guest` | `pages/opportunities` 人才 tab | 游客列表隐藏，筛选/登录/成为玩家走登录门禁。 |
| J1-06 `member-benefit` | `mip-growth` | 已按最新画布调整首屏：权益区自适应高度、成长任务直接衔接、可执行任务黄底按钮、成长数据后置；等级、经验、后台权益和开通入口仍用服务端事实。本轮开发者工具已重拍付费玩家 Lv.1，但原型为新玩家加入 Lv.2，**不能作为同状态视觉验收**；测试环境权益与任务配置尚不足以复现原型。会费由真实商品决定。 |
| J1-07 `join-order` | `membership-order` | 独立会员订单与支付入口已接线；支付调起后先进入结果页回读账本状态，比原型直接回“我的”多一步安全反馈。真实支付/权益仍待真机。 |
| J1-08 `mine-guest` | `pages/profile` | 游客仅登录头、黄卡、活动/名片/订单/设置；六入口先登录。 |
| J2-01 `activity-detail` | `mip-events/detail` | 已登录详情直接进入参与人和报名；签到升级由服务端事实决定。 |
| J2-02 `participants` | `mip-events/participants` | 嘉宾/玩家/我的心动/对我心动四 tab、单场单票与取消已接线。 |
| J2-03 `profile-player-visitor` | `mip-public-profile` | 普通用户可看档案，互动与名单入口由原生解锁弹窗拦截。 |
| J2-04 `unlock-dialog` | `mip-public-profile` | 原生 `wx.showModal` 固定文案；确认与取消均留原页。 |
| J2-05 `opp-member-open` | `pages/opportunities` | 普通用户可切状态和发布；平台机会按服务端角色返回空态。 |
| J2-06 `opp-mine-empty` | `pages/opportunities` 我的项目 | 空态、发布入口与顶部 Banner 均有对应状态。 |
| J2-07 `talent-member` | `pages/opportunities` 人才 tab | 非玩家空态显示成为玩家入口；需用服务端非玩家账号验数据边界。 |
| J2-08 `order-confirm` | `mip-events/registration` | 活动报名订单、价格与支付依据服务端活动；特殊活动可能有附加报名字段，优先遵守活动实际配置。 |
| J3-01 `opp-member` | `pages/opportunities` | 嘉宾机会浏览、Banner、类型标签及详情入口已接线。 |
| J3-02 `talent-member` | `pages/opportunities` 人才 tab | 嘉宾人才空态与 J2-07 共用；玩家可见性由服务端控制。 |
| J3-03 `profile-player` | `mip-public-profile` | 感兴趣与名单沿最新终审标注，嘉宾不显示玩家专属操作条。 |
| J3-04 `mine-member` | `pages/profile` | 四统计、心动/访客红点、铃铛站内信与账号设置已接线。 |
| J3-04b `inbox-list` | `mip-notifications` | 列表和已读接口已接线；原型无正式页面稿，按设计系统承接。 |
| J3-05 `invite-list` | `mip-received?scope=influence&category=GUEST` | 邀请次数与最近签到排序按服务端数据；无搜索。 |
| J3-06 `interacted-list` | `mip-received?scope=influence&category=INTERACTION` | 同场签到次数、最近同场排序及搜索已接线。 |
| J3-07 `heartbeat` | `mip-hearts` | 我的心动/对我心动两 tab 与未读态已接线；列表只读。 |
| J3-08 `visitors` | `mip-received?scope=influence&category=VISITOR` | 每次访问单条记录、倒序、清红点；卡片无访问时间。 |
| J3-09 `opp-detail-visitor` | `mip-opportunities/detail` | 类型标签、四行信息和“我想合作”按钮可见；**按钮当前仍是占位提示**。原型也未定义可执行的合作流程，不能将档案感兴趣或指定对象引荐偷换为合作意向。 |
| J4-01 `talent-player` | `pages/opportunities` 人才 tab | 玩家搜索、能力/行业筛选与档案跳转已接线。 |
| J4-02 `profile-player` | `mip-public-profile` | 玩家“我感兴趣”表态与名单入口已接线；服务通知需模板授权和真实送达证据。 |
| J4-02b `interested-list` | `mip-profile-interests` | 已实现名单、分页与隐私过滤；此前 staging 因旧函数/迁移停在 blocked，本轮云端部署通过，页面运行时仍待重验。 |
| J4-03 `member-renew` | `mip-growth` | 开通/续费同页，续费按钮仅到期前三个月出现。 |
| J4-04 `opp-edit` | `mip-opportunities/editor` | 三种机会类型、三态状态、默认封面及多行描述已接线；真实保存/回读需部署后验。 |
| J4-05 `opp-detail-publisher` | `mip-opportunities/detail` | 发布人编辑、分享和类型标签已接线；微信分享面板待真机。 |
| J4-06 `opp-detail-publisher-disabled` | `mip-opportunities/detail` | 已下架分享置灰不可点，已结束仍可分享。 |
| J5-01 `account-settings` | `privacy` | 绑定手机、隐私和协议分组；小程序无 APP 专属“绑定微信”。 |
| J5-02 `bind-phone` | `bind-phone` | 微信号一键换绑与其他号码短信验证码双路径已接线；真实短信配置缺失，发送/回调待外部验。 |
| J5-03 `privacy-settings` | `privacy-settings` | 两个开关持久化到服务端并约束人才/机会展示。 |
| J5-04 `user-agreement` | `user-agreement` | 页面层级已接线；正式协议内容应由权威协议替换原型占位文案。 |
| J6-01 `mine-coop-list` | `pages/profile` 合作卡 tab | 本轮补齐本页长按删除、原生确认、成功 toast、整块添加卡和分页。 |
| J6-02 `mine-case-list` | `pages/profile` 超级案例 tab | 本轮补齐月份时间轴与黄色节点、本页长按删除、原生确认、成功 toast、整块添加卡和分页；未发布草稿以“未发布”代替月份。 |
| J6-03 `mine-opp-list` | `pages/profile` 相关机会 tab、`mip-opportunities/mine` | 档案页内已改为“发布机会 / 引荐机会”原位切换，分别加载已发布和收到的引荐，均可分页；发布卡片保留长按删除、确认和 toast。开发者工具已实际点按并重拍引荐空态。服务端列表为游标分页，未提供精确总数，故暂不显示原型的数量；原型 2+1 条的同数据视觉仍待验。 |

## 未闭合的设计/验收项

1. **视觉逐帧**：仍需使用已部署环境与可复现的游客、普通用户、嘉宾、玩家数据，逐步截取 375px 真正渲染态，与线上原型同场景比对。现有 `figmaLayout` 是测试夹具，不代表生产页面；不能拿夹具截图冒充已还原。
2. **机会合作按钮**：J3-09 的原型只给出按钮和演示反馈，缺少合作意向的数据、撤销、通知及列表口径。现有 `setReferral` 是“引荐指定对象”，`setProfileInterest` 是“对档案感兴趣”，两者都不是可直接复用的“我想合作”。在产品定义与服务端契约补齐前保留明确缺口。
3. **真机与外部能力**：手机号、短信、微信支付、扫码签到、分享及微信服务通知不能用开发者工具或本地测试代替。
4. **玩家等级配置与同状态实拍**：J1-06 的本地玩家账号为 Lv.1、0 项权益、1 项任务，原型为 Lv.2、4 项任务且底部为加入按钮；原型权益标题写“可享 2 项权益”，画面却有 4 个礼物图标，设计本身需要明确口径。页面结构已修正，仍需官方等级/权益/任务配置或可复现的验收账号，再按同角色、同数据重拍；不能把原型示例数据写死在客户端。
5. **相关机会精确计数**：J6-03 已在档案页内切换两类列表，但服务端仅有游标，没有总数。若数量为正式需求，应补服务端总数合同并同步到独立列表与档案页；不能把首屏已加载条数冒充总数。
