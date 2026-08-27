# MIP 交付切片与并行任务图

> 文档状态：历史切片计划。2026-08-28 接受的 [ADR 0004](../adr/0004-independent-web-admin.md) 已取代本文“独立网页后台暂不建设”的决定。下文保留原始切片边界和当时数量，不伪装为当前状态；当前 Web 范围见 [ADMIN_WEB.md](ADMIN_WEB.md)。

当前目标是完整实现 MIP 小程序和手机/电脑双端自适应管理分包。下列“切片”只用于控制共享文件、验收和提交边界，不用于裁剪需求；独立网页后台暂不建设。

## 协作模型

- 根 Agent 负责总计划、领域边界、共享契约、任务拆分、代码审查、开发者工具、提交、部署与最终验收。
- 子 Agent 只拥有一个边界明确的纵向切片或只读审计；不得各自创建身份、权限、分页、错误或审计合同。
- `src/app.css`、`src/app.json`、`config/runtime-pages.json`、公共 DTO/错误合同、operation registry 和 `cloudfunctions/mip-admin-api/domain/repository.js` 由根 Agent 串行控制。
- 每个实现切片独立验证、独立 commit；不得笼统暂存工作区，也不得触碰 `docs/research/legacy-mip-app/`。
- 开发者工具只保留一个实例；运行验收期间冻结写入、关闭热重载、单次构建和编译，由根 Agent 串行截图。

## 已稳定的公共底座

以下能力已经实现，不再作为新 Agent 的重复开发任务：

1. `AdminTransport` 的 CloudBase/InMemory adapter。
2. v1 嵌套请求、DTO、错误与审计 envelope。
3. trusted principal、`AdminApplication.execute` 和 145-action operation registry。
4. 平台、分会、活动三级 scope 与 capability。
5. 事件复制和未保存草稿手机预览。
6. 消息模板、定时发送、发送失败复核与 outbox。
7. 会员端居中容器、管理端侧栏与手机/平板/桌面响应式原语。
8. 当前身份协议、档案、手机号和唯一 `PLATFORM_OWNER` 初始化。

## 串行底座任务

| 编号 | 范围 | 独占文件 | 验收门槛 |
| --- | --- | --- | --- |
| G0 | 文档与证据刷新 | `docs/mip/*.md` | 数量来自当前命令；旧 95 路由报告标为历史；代码缺口、外部等待和运行证据分开 |
| G1 | Demo 与运行验收底座 | `database/mysql/mip/seed.demo.json`、seed 脚本、`config/runtime-pages.json`、运行脚本 | 固定 ID、幂等、可清理、只写 `mip_*`；108 路由和 6 旅程一致 |
| G2 | 管理持久层继续拆深 | `cloudfunctions/mip-admin-api/domain/repository.js` 与新 `repositories/*` | 一次只抽一个领域；145 action 行为不变；全量服务端测试通过 |

G2 不与任何会修改同一 repository 的业务 Agent 并行。

## 当前执行顺序

下列顺序按共享契约依赖排列；每一项必须先通过聚焦测试、类型检查和运行验收，再开放下一项对同一公共模块的修改：

1. 对 108 条路由执行代表性手机与 960px+ 复验，并继续覆盖 6 个代表状态和 6 条交互旅程；真机或缺少资格事实的场景保留 `external-wait`。
2. 完成活动列表的开始时间、分会/城市、类型、价格和排序合同，并在管理页提供同一组筛选与清空行为。
3. 完成用户主分会变更闭环：只允许平台级用户编辑权限，事务内保留成员关系历史、更新主分会、校验版本并追加审计。
4. 完成用户影响力管理明细：邀请嘉宾、活动心动和访客事实使用独立只读投影，不暴露 OpenID 或越过用户隐私边界。
5. 完成活动标签目录和视频回顾目录；二者使用版本、启停、软归档和审计，不把品牌静态链接当作业务记录。
6. 完成统一权益时间线和受控人工会籍调整；人工调整必须写入独立 ledger，不直接覆写当前权益。
7. 完成仪表盘自定义时间/分会筛选、趋势、下钻和事实型待办；未追踪指标继续显式返回不可用。
8. 按冻结的 27 个 Figma frame 做同尺寸视觉复核，修复高置信度差异后再刷新交付矩阵与最终证据。

Web 登录账号、固定九队、三种会员角色、固定一年会籍、物理删除和任务审批不在该序列中；它们分别属于已延期能力或与当前已确认领域规则冲突。

## 第一波并行切片

| 切片 | 主要范围 | 共享依赖 | 完成门槛 |
| --- | --- | --- | --- |
| A 身份/用户/权限 | dashboard、profiles、branches、roles、audit 及 access/users/governance | trusted principal、Owner、Demo 用户 | 平台/分会/活动权限正反例、脱敏、审计、375px/960px+ 正常态 |
| B 免费活动闭环 | 管理活动、用户活动、`mip-events-api` 和 admin events domain | 身份、媒体、消息、Demo 活动 | 创建/复制/预览/发布、浏览/报名、名单、签到/撤销、心动/反馈/评论、审计和仪表盘；扫码真机单列 |
| C 机会与协作 | 机会、人才、合作卡、案例、评论与管理治理 | 用户可见性、媒体、消息 | 发布、组队、引荐、感兴趣、评论、撮合、屏蔽和审核闭环；375px/960px+ 正常态 |

## 第二波并行切片

第一波公共 seam 稳定后再并行：

| 切片 | 主要范围 | 共享依赖 | 完成门槛 |
| --- | --- | --- | --- |
| D 成长/任务/游戏 | growth、tasks、game、blind-box 用户端和管理端 | 真实会员资格、成长账户、Demo 数据 | 服务端计分、任务资格、排行快照、游戏币防负、盲盒幂等 |
| E 知识与内容 | knowledge 用户端/管理端、community/commerce/ledger | 媒体、订单、业务域名 | 免费/会员/单内容访问、评论、采集审核、首次访问与退款边界 |
| F 消息与运营 | notifications、Banner、公告、campaign/templates/reviews、scheduler | outbox、跳转白名单、目标资源 | 站内闭环与失败复核本地通过；scheduler 部署/canary 单列外部证据 |
| G 支付与会员 | membership、orders、payment-result、admin orders、commerce/pay/ledger/refund | 正式商户、回调、真机 | disabled 不伪造；TEST/LIVE 隔离；真实支付、退款和权益只以外部证据关闭 |

## 第一条业务验收闭环

第一条交给业务方测试的闭环采用免费线下活动：

1. Owner 或授权分会管理员创建、复制、预览、编辑并发布活动。
2. 用户按城市浏览、搜索并查看活动详情，完成协议、档案和免费报名。
3. 管理端查看/导出报名名单，执行签到与撤销；扫码部分保留真机证据。
4. 已签到用户完成心动、反馈和活动评论。
5. 审计、消息和事实型仪表盘反映同一条业务事实。
6. 平台管理员可跨分会，分会管理员只看授权分会，现场角色只看指定活动。

这条闭环不等待正式支付，但不会删除或降级付费链路。付费活动继续由订单、ledger、回调和正式商户验收。

## 每个切片的验收包

- 聚焦客户端与服务端测试。
- 375px、600–959px 和 960px+ 布局合同；代表页面取得 375px 和 960px+ 正常态截图。
- 与 [FIGMA_MAP.md](FIGMA_MAP.md) 对应 frame 的同尺寸差异检查。
- loading、empty、error、forbidden、conflict 和 disabled 状态。
- `pnpm verify`、`git diff --check` 和精确暂存范围。
- 涉及数据库时只追加迁移；涉及 CloudBase 时复核只写 `mip_*` 且不安装高频 timer。
- 手机号、支付、订阅消息、扫码、相册、地图、日历和 AI 录音明确保留真机/正式配置边界。

## 明确不做

- 不推倒重写现有小程序或 Cloud Functions。
- 不删除小程序管理分包。
- 不在页面复制服务端资格、金额、权限和状态机。
- 不在桌面小程序被证明无法满足运营需求前建设独立 Web UI、网页登录和 Session。
- 不把 WorkBuddy 原型中与 MIP 事实冲突的账号、服务器或会籍规则直接写入数据库。
- 不用空页面、模拟支付或错误尺寸截图宣布产品完成。
