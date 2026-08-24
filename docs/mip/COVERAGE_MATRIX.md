# MIP 需求与设计覆盖矩阵

本矩阵是完整实现的逐项验收入口。状态只使用：`implemented-local` 表示当前代码、迁移和聚焦测试形成了本地证据；`partial-local` 表示仍缺行为、字段、状态或入口；`external-wait` 表示源码链路存在，但能力本身仍依赖已部署 CloudBase、真机或正式配置；`unimplemented` 表示当前没有可触发实现。`implemented-local` 不代表真机或生产验收通过。

固定 PRD 的 1–81 项逐行状态见 [PRD_81_MATRIX.md](PRD_81_MATRIX.md)。本文件继续按业务闭环和 Figma 代表 frame 汇总，二者必须同时满足才能进入最终验收。

当前工程声明 83 条小程序路由、16 个核心 `mip-*` 云函数和 34 个锁定迁移。共享云环境已经应用全部 34 个迁移并收敛 83 张 MIP 业务表的精确 runtime 权限；完整函数部署仍为 `external-wait`。

## 来源

| 来源 | 固定证据 | 状态 |
| --- | --- | --- |
| GitHub 固定 PRD | [sources/github/PRD-v1.1.0.md](sources/github/PRD-v1.1.0.md)，外部 commit `a38bc48e4d85ceabf9adb1013fbd5e0842a8c4eb` | `implemented-local` |
| GitHub 用户流程 PRD | [sources/github/里程碑1-MIP_v1.1.0_待评审需求_用户流程梳理.md](sources/github/里程碑1-MIP_v1.1.0_待评审需求_用户流程梳理.md) | `implemented-local` |
| GitHub 需求澄清 | [sources/github/会议纪要_20260822_需求澄清.md](sources/github/会议纪要_20260822_需求澄清.md) | `implemented-local` |
| 后台 PRD | [sources/github/MIP后台PRD_V0.1_含表格.md](sources/github/MIP后台PRD_V0.1_含表格.md) | `implemented-local` |
| 飞书 AME | Wiki/Base `Hn5cwvTRYiHZATkr4m8cGIu4n5R`，table `tblXOCZImEJuDz6L`，view `vewJLhYC6O` | `external-wait` |
| Figma | file `qqkbdlh4c4Swubum8S3F2f`，代表 frame 见 [FIGMA_MAP.md](FIGMA_MAP.md) | `partial-local` |

飞书只采纳可读取且明确的条目；未取证内容不得补造。Figma 节点映射来自固定 PRD 和画板链接，但 MCP Starter 配额受限，尚未取得可复核的完整 design context、切图或同尺寸 frame 截图；当前只使用可替换的中性资产，并把精确视觉验收保留为 `external-wait`。

## GitHub PRD A–D

| 编号 | 需求 | 状态 | 本地证据与外部边界 |
| --- | --- | --- | --- |
| A1 | 首开协议门禁 | external-wait | 全局门禁、协议页停留保护和版本校验已本地实现；正式协议正文与版本待配置 |
| A2 | 微信登录及手机号、头像、昵称 | external-wait | 拆分授权、首登引导和会话恢复已本地实现；手机号、头像和昵称授权待真机验收 |
| A3 | 更换手机号 | external-wait | 本地已做微信验证、快照刷新和重复绑定服务端拒绝；真机换绑流程待验收 |
| A4 | 补资料后返回原上下文 | implemented-local | 受保护动作、冷启动持久化、返回层级和安全 fallback 有本地测试 |
| B1 | 可配置 Banner 轮播及文章跳转 | implemented-local | 配置、轮播、页面/文章跳转已实现；正式素材与目标地址待配置 |
| B2 | 往期回顾进入视频号 | external-wait | 配置化视频号入口已实现；正式视频号账号待配置并真机验收 |
| B3 | 近期/已结束筛选 | implemented-local | 页面与服务端状态筛选已覆盖 |
| B4 | 城市和日历日期筛选 | external-wait | 默认主分会城市、单日/区间/单侧日期、日期标签和无效区间校验已覆盖；正式城市和真机日历待验收 |
| B5 | 标题模糊搜索 | implemented-local | 防抖输入、服务端模糊查询和空状态已覆盖 |
| B6 | 完整活动卡 | implemented-local | 封面、时间、地点、状态、人数、限制、类型和 `nextCursor` 分页已覆盖 |
| B7 | 活动卡直接分享 | implemented-local | 列表分享按钮、邀请 token 和分享路径已覆盖 |
| B8 | 活动详情入口 | implemented-local | 活动卡、深链、返回和错误状态已覆盖 |
| C1 | 图文详情、主办方、须知和介绍媒体 | external-wait | 富文本及最多 12 张介绍图片的上传、排序、说明、预览、移除已本地实现；真机媒体和内容安全待验收 |
| C2 | 联系电话 `13798316515` | external-wait | 支持电话配置、详情展示和拨号入口已实现；正式号码和真机拨号待验收 |
| C3 | 地图/地址 | external-wait | 坐标打开地图、无坐标复制地址和错误恢复已实现；真机地图与授权拒绝待验收 |
| C4 | 卡片、链接、二维码、文案分享 | external-wait | 分享卡、复制文案/链接、邀请 scene、海报和二维码链路已实现；真实小程序码及相册权限待验收 |
| C5 | 玩家/嘉宾参与人搜索和档案 | implemented-local | 玩家/嘉宾筛选、关键词搜索、分页、公开字段和 opaque profile reference 已覆盖 |
| C6 | 显示邀请人 | implemented-local | 锁定的活动邀请来源返回公开邀请人信息；自然流显示“MIP 平台”，不泄露用户标识 |
| C7 | 登录补资料后继续报名 | implemented-local | 登录、协议、手机号、档案补全后恢复报名上下文，包含冷启动 fallback |
| C8 | 支付确认后完成报名 | external-wait | 订单意图、支付参数、回调 ledger、查单和退款代码已覆盖；正式商户和真机支付待验收 |
| D1 | 扫码登录签到闭环 | external-wait | scene 解析、身份恢复、服务端资格与时间窗校验已实现；真实小程序码和真机扫码待验收 |
| D2 | 未报名扫码后报名再签到 | external-wait | scene 可跨登录、报名或支付保留并恢复；真机串联待验收 |
| D3 | 无效扫码恢复指引 | implemented-local | 无效、过期和资格不符场景提供重新扫码或返回活动详情的恢复入口 |
| D4 | 管理员生成/下载签到海报 | external-wait | 仅管理端可触达的生成、预览和保存相册链路已实现；真机 Canvas、码图和相册授权待验收 |
| D5 | 每人每场最多一个心动 | implemented-local | 服务端唯一关系、不可选自己、取消和改选已覆盖 |
| D6 | 我点过/对我心动两份列表 | implemented-local | 两个本人可见分页列表和公开档案跳转已覆盖 |
| D7 | 已签到用户活动反馈 | implemented-local | 已签到资格、每场一份、修改和运营读取已覆盖 |
| D8 | 签到/心动订阅消息 | external-wait | 站内 outbox 和微信 adapter 路由已实现；模板、逐次授权和外部投递待验收 |

## GitHub PRD E–H 与澄清纪要

| 编号 | 需求 | 状态 | 本地证据与外部边界 |
| --- | --- | --- | --- |
| E1 | 招募中/已完成机会列表 | implemented-local | 发布时间倒序、状态筛选、分页和空状态已覆盖 |
| E2 | 六角色、行业、能力及玩家/全局搜索范围 | implemented-local | 机会页支持角色/行业/能力；找人才支持“只搜玩家/全局搜索”，默认全局；正式标签待配置 |
| E3 | 机会详情 | implemented-local | 发布时间、发布人、团队成员、标签、默认封面和交互状态已展示 |
| E4 | 发布机会及组队玩家 | implemented-local | 最多 8 名有效玩家，服务端按 profile reference 重查 |
| E5 | 我想引荐及通知 | implemented-local | 可见玩家/嘉宾目标、替换、取消、单关系、未读站内信已覆盖；微信补充通知为 `external-wait` |
| E6 | 我感兴趣及通知 | implemented-local | 每人对另一用户一条有效关系，可取消重加；微信补充通知为 `external-wait` |
| E7 | 机会参与者档案 | implemented-local | 发布人和团队成员进入公开聚合档案，服务端重查可见性和屏蔽关系 |
| E8 | 机会评论、项目评价与打 call | implemented-local | 身份/协议门禁、内容安全、参与人标识、分页、编辑/软删除、屏蔽、举报、幂等计数和后台范围审核已覆盖 |
| E9 | 合作卡浏览 | implemented-local | 合作卡列表、角色/行业/城市筛选、详情和人才档案入口已覆盖 |
| F1 | 我的全部活动 | implemented-local | 当前报名、历史活动、票码、取消状态和分页已覆盖 |
| F2 | 合作卡 CRUD + AI | external-wait | CRUD、软归档、预览前自动保存、多轮 AI 草稿与确认已本地实现；真实 AI 录音 provider 待配置和真机验收 |
| F3 | 超级案例 CRUD + AI | external-wait | CRUD、素材、软归档、多轮 AI 草稿、确认和首次发布成长事件已本地实现；真实 AI 录音 provider 待配置和真机验收 |
| F4 | 我发布及收到/被引荐机会 | implemented-local | 分组列表、分页、未读和独立被引荐人事实已实现；云端运行时验收仍待完成 |
| F5 | 开始前可配置 X 小时取消 | implemented-local | 活动覆盖优先，否则使用平台默认 24 小时，范围 0–720 小时；真实退款为 `external-wait` |
| G1 | 站内信及全局未读红点 | implemented-local | 站内信、分类未读、全局未读缓存、“我的”和自定义 TabBar 红点已覆盖 |
| G2 | 订阅/客服/服务号 adapter | external-wait | 站内 outbox、订阅授权映射和通知 worker 已实现；正式模板、客服和服务号配置待接入 |
| H1 | 用户组合筛选、详情、名单、导出 | implemented-local | 组合筛选、用户聚合详情、超级案例/机会/报名/订单明细与跳转、脱敏/授权原文和受控导出已覆盖；CloudBase 导出运行时待验收 |
| H2 | 活动 CRUD、参与人、订单、导出 | external-wait | 活动状态、无业务事实草稿归档、报名审核、单场及跨活动参与者筛选/分页/导出、订单组合筛选、会员权益有效期、退款动作和相册已本地实现；正式支付退款和云端导出待验收 |
| H3 | 多范围角色、敏感权限、登录审计 | implemented-local | 平台/分会/活动七类角色、窄化委派、独立敏感 capability 和管理端进入审计已覆盖 |
| H4 | 等级、权益、规则、流水、调整 | implemented-local | 等级显式顺序/展示标识、独立权益实体与等级关联、经验/贡献/游戏币权威余额与流水、固定规则、受控人工调整和业务 producer 已覆盖；正式数值待配置 |
| H5 | NPC 任务配置、指定成员派发、模板与截止 | external-wait | 全员/指定成员、成员搜索、批量派发与软撤销、模板上传下载、截止状态、幂等完成、经验奖励和迁移已完成；云函数部署及真机媒体保存待验收 |
| 固定 PRD #60/#61 | 团队 PK 每周赛况、历史与规则 | external-wait | 有效会员门禁、每周对阵、服务端成长流水结算、胜方成员固定游戏币奖励、历史快照、用户可见规则和迁移已完成；草稿赛季快照仅管理端可见，`mip-game-api` 部署及正式 PK 规则待验收 |
| 固定 PRD #62/#63 | 队伍大本营与成员 | external-wait | 赛季队伍、成员历史、城市分会、经验值和四档中性大本营状态已本地实现；正式阈值、视觉和云端运行时待配置/验收 |
| 固定 PRD #64/#65 | 个人赛季排位与规则 | external-wait | 个人赛季快照、等级投影和规则展示已本地实现；客户端分数被拒绝，正式赛季规则和云端运行时待验收 |
| 固定 PRD #66–#68 | 团队半年/年度榜、个人累计榜与城市筛选 | external-wait | 团队榜按 6/12 个月独立周期生成，个人榜按赛季/累计经验事实生成，四类服务端快照、城市分会筛选和 `029` 迁移已完成；游戏币作为独立钱包不参与排名，`mip-game-api` 部署待验收 |
| N1 | 会员期邀请归因固定 | implemented-local | 微信分享、复制邀请文案/路径、签名 scene 小程序码海报和权益期锁定邀请来源已覆盖；正式 AppID 的 wxacode 权限、扫码和相册为 `external-wait` |
| N2 | 嘉宾按活动邀请归因 | implemented-local | 活动邀请 scene 锁定到报名事实并在详情展示公开邀请来源 |
| N3 | 自然流显示 MIP 平台及默认头像 | implemented-local | 自然流 DTO 显示“MIP 平台”，头像缺失时使用平台默认呈现 |
| N4 | 行业/城市两级共用选择器 | implemented-local | 注册、档案、机会和人才共用分组/可选标签，支持“不限”和热门配置 |
| N5 | 六合作角色字段和六维雷达 | implemented-local | 六个稳定角色、专属字段、自评能力和详情雷达已覆盖 |
| N6 | 玩家为有效付费会员，嘉宾非会员 | implemented-local | 玩家身份只由服务端有效权益窗口投影，退款、到期或撤销后为嘉宾 |
| N7 | 谁看过我：访问记录、累计、最新优先、未读红点、仅本人可见 | implemented-local | `mip_profile_visits`、opaque profile reference、重复访问累计、最新优先、本人读取和访客未读分类已覆盖 |

## Figma 代表 frame

| Frame | 页面 | 状态 | 本地证据与外部边界 |
| --- | --- | --- | --- |
| `1770:38871` | 我的 | implemented-local | 真机 ready-state 截图和同尺寸视觉对照待验收 |
| `1723:16217` | 我的活动 | implemented-local | 真机取消、退款和票码状态待验收 |
| `1723:16988` | 我的订单 | external-wait | 正式支付/退款订单和真机状态待验收 |
| `1732:20291` | 编辑档案 | external-wait | 多公司/组织、字段状态已实现；微信资料和手机号待真机验收 |
| `2004:2227`、`2571:34139` | 合作卡 | implemented-local | 预览前自动保存、保护动作和表单状态已实现；运行时视觉对照待验收 |
| `1987:30162`、`2173:42605` | 超级案例 | external-wait | 素材与表单已实现；真机媒体和 AI provider 待验收 |
| `2172:42168` | AI 语音填写 | external-wait | 草稿、多轮补充和确认已实现；真机录音、转写和 provider 待验收 |
| `1948:14079` | 玩家等级 | implemented-local | 正式等级、权益和规则数值待配置 |
| 固定 PRD #36/#54 | 我的勋章与公开佩戴 | external-wait | 收藏、最多 3 枚佩戴、公开档案投影、后台授予和 `028` 迁移已完成；Figma 勋章精确资产因工具配额/导出限制未取得，当前使用可替换中性占位，正式图片待验收 |
| `1819:17664` | 活动首页 | external-wait | 轮播、日期、视频号、分页、分享已实现；正式内容和真机能力待验收 |
| `1861:17860`、`1818:17142` | 活动详情 | external-wait | 图文、分享、电话、地图和邀请来源已实现；真机原生能力待验收 |
| `1818:17230` | 参与人 | implemented-local | 搜索、玩家/嘉宾筛选和公开档案已实现；运行时视觉对照待验收 |
| `2168:17419` | 互动 | implemented-local | 双向心动列表、反馈和保护状态已实现 |
| `1821:19274` | 活动报名 | external-wait | 摘要、字段错误、条款和恢复已实现；手机号及真实支付待验收 |
| `1766:36567` | 机会探索 | implemented-local | 范围、角色、行业、能力、城市和关键词筛选已实现 |
| `1766:36864` | 发布机会 | implemented-local | 组队成员、表单状态、身份恢复和发布生命周期已实现 |
| `1768:37414`、`1768:37369` | 机会详情 | implemented-local | 发布时间、团队、默认封面、引荐和感兴趣已实现 |
| `1768:37534`、`2917:4875` | 人才合作 | implemented-local | 玩家/嘉宾目录、范围和多条件筛选已实现 |
| `1769:38198` | 玩家档案 | implemented-local | 卡片、案例、机会聚合、直接感兴趣和访问记录已实现 |
| `1958:11897`、`2037:12261` | 超级案例详情 | external-wait | 素材预览和保护动作已实现；真机媒体待验收 |
| `2917:4785` | 行业筛选 | implemented-local | 两级分组、多选、“不限”和能力联动已实现；正式标签待配置 |

## 完成证明

一行只有同时满足下列证据才可从本地实现进入产品验收：入口/返回/深链和保护动作可触达；页面只经 module/platform；服务端不信任客户端事实；数据变更为 append-only `mip_*` 迁移；完整页面状态有运行证据；Figma 有同尺寸 ready-state 对照；`pnpm verify` 与 `git diff --check` 通过。手机号、支付、订阅消息、扫码、相册、地图、日历和 AI 录音必须保留真机或正式配置证据。

## 完整范围

本矩阵不再将固定需求标为范围外。尚未形成规则、代码或外部环境证据的能力保留为 `partial-local` 或 `external-wait`。
