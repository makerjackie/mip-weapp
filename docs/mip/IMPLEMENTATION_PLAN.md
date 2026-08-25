# MIP 完整实施计划

更新日期：2026-08-25。

本文是当前长期开发目标的执行计划。检查点只用于控制风险、形成可测试版本和稳定并行 seam，不裁剪最终范围；目标仍是实现仓库内需求基线、Figma 页面映射和 WorkBuddy 管理功能中适用于当前小程序交付形态的全部工作。

## 目标结果

最终交付包含：

- 一套原生微信小程序，完整覆盖发现、活动、机会、我的、会员、订单、合作卡、超级案例、成长、任务、游戏化、知识内容和消息等需求；
- 一套保留在小程序管理分包中的正式运营产品，在手机微信负责现场操作，在 Mac/Windows 微信负责宽屏列表、筛选、表单、导出和审计；
- 一套微信和未来 Web 都能复用的中立管理合同；
- 一个仍按单函数部署的 `mip-admin-api`，内部拆成高 depth、低耦合的业务 module；
- 只使用 `mip_*` 表、`mip-*` 函数和 `mip/` 对象前缀的共享 CloudBase 隔离实现；
- 可重复 Demo 夹具、逐页 Figma 对照、静态门禁、开发者工具、Mac 微信、云端和真机/正式配置边界证据；
- 可单独复用、可回退、没有 WIP 的合理 Git commits。

当前不建设独立网页 UI、网页登录、Web session 或新的前端工程。服务端 seam 会为未来 HTTPS adapter 留好位置，但不会提前引入 React、Monorepo 或第二套业务状态机。

## 负责人和并行方式

主 Agent 负责：

- 维护本计划、领域词汇、架构决策和依赖顺序；
- 设计并冻结共享 interface、数据合同、错误、权限和响应式原语；
- 分配互不重叠的文件所有权；
- 审查 Agent 结果，解决跨域问题，运行门禁并创建提交；
- 维护需求覆盖矩阵和验收证据，禁止用文件数量冒充完成。

执行 Agent 负责边界清楚的纵向切片。Agent 默认不自行改变共享 interface、不修改其他切片文件、不创建最终 commit；主 Agent 集成后按一个行为一个 commit 提交。共享文件必须由主 Agent修改，或在任务开始时明确授予唯一所有权。

并行开发分两段：

```text
管理合同 + 身份/RBAC + 响应式壳层 + Demo/验收底座
                         ↓
          用户管理 + 免费活动端到端检查点
                         ↓
  支付会员 | 机会协作 | 成长任务游戏 | 知识消息 | 视觉验收
                         ↓
              主 Agent 集成、全量验收和收口
```

底座未稳定前只并行做只读审查、测试补强和互不重叠的准备工作。底座稳定后，最多同时启动三个执行切片，避免共享工作区和同一分支发生交叉覆盖。

## 架构方案

### 客户端管理 seam

页面不再学习 CloudBase 调用格式，只依赖一个小 interface：

```ts
interface AdminTransport {
  request<A extends AdminAction>(request: {
    contractVersion: 1
    action: A
    input: AdminInput<A>
    idempotencyKey?: string
  }): Promise<AdminResult<A>>
}
```

首期提供两个真实 adapter：

- `CloudBaseAdminTransport`：当前小程序生产 adapter；
- `InMemoryAdminTransport`：界面、合同和权限场景测试 adapter。

未来独立网页只增加 `HttpAdminTransport`，页面模型、DTO、错误码和业务状态不变。当前扁平 `{ action, ...data }` 请求存在路由 action 与业务字段同名覆盖的风险，必须通过兼容 adapter 渐进迁移到 `{ contractVersion, action, input, idempotencyKey }`，迁移期间服务端同时识别旧请求，全部调用点切换后再删除兼容层。资源的一个或多个 `expectedVersion` 仍属于对应 operation 的类型化 input，不塞进只能表达单版本的通用 control。

### 服务端管理 seam

CloudBase handler 和未来 HTTPS handler 只负责解析可信渠道身份、协议版本和 envelope，然后进入同一个 application interface：

```ts
interface AdminApplication {
  execute(
    principal: TrustedAdminPrincipal,
    operation: AdminOperation,
  ): Promise<AdminEnvelope>

  probe(): Promise<AdminHealth>
}
```

`TrustedAdminPrincipal` 只能由微信调用上下文或未来 Web session adapter 的私有 issuer 创建，不能只是调用方可伪造的结构类型。客户端提交的 AppID、用户 ID、role、capability 和 scope 永远不可信。health 只进入 `probe()`，不作为第 98 个业务 operation。

application 内使用 operation registry 固定 97 个现有业务 action。manifest 分散在各业务 module 内，registry 只负责汇总和完整性校验，避免产生新的巨型文件。每条 operation 统一登记：

- action、版本和所属业务 module；
- query 或 command；
- 输入校验与输出 schema；
- 所需 capability 和 scope 解析策略；
- 是否要求幂等和一个或多个 `expectedVersion`；
- 审计事件、outbox 唤醒和敏感字段投影；
- 可公开错误、重试属性和冲突恢复方式。

第一阶段不改 action 名称和页面 DTO，先固定兼容合同，再逐个迁移 implementation。服务端生成 `requestRef` 和执行时间；客户端只为 mutation 提供稳定的幂等键，不能决定审计主体或服务端请求标识。

### 内部深模块

`mip-admin-api` 保持一个部署单元，内部 module 按业务事实和事务归属拆分：

| Module | interface 后隐藏的行为 | 允许依赖 |
| --- | --- | --- |
| `access` | 有效用户、协议、手机号、资料、角色、capability、平台/分会/活动 scope、敏感字段授权、登录审计 | 用户状态只读投影 |
| `users` | 用户列表与详情、档案、主分会、账号控制、手机号投影和用户导出 | `access`、媒体只读端口、export 端口 |
| `events` | 活动、规则、复制、发布、报名审核、名单、签到/撤销、相册、反馈和提醒 | `access`、订单只读端口、messaging 端口、export 端口 |
| `orders` | 统一订单查询、服务状态、退款意图和财务导出 | `access`、payment ledger 端口、refund worker 端口 |
| `messaging` | 公告、消息活动、收件人快照、站内信/outbox 状态和重试事实 | `access`、目标资源只读端口 |
| `knowledge` | 来源、分类、内容、商品、评论、举报和显式采集 | `access`、媒体端口、订单只读端口 |
| `opportunities` | 机会、团队、审核、评论、举报、撮合设置和重算 | `access`、用户公开投影、messaging 端口 |
| `growth` | 等级、权益、经验、贡献、勋章、任务、赛季、排行、盲盒和游戏币管理 | `access`、用户/会员只读投影 |
| `operations` | 仪表盘、异常中心、导出任务和追加审计读取 | 上述 module 的只读投影 |

module 之间不能直接调用对方内部 repository。跨域使用窄端口或已有领域事件；需要原子事务时，由 application implementation 在一个数据库事务中编排，不能为了拆文件破坏当前一致性。

### 响应式管理产品

小程序启用 `resizable: true`，集中建立三档布局原语：

| 可用宽度 | 布局 | 主要用途 |
| --- | --- | --- |
| `< 600px` | 单栏卡片、页内操作、关键字段 | 手机现场处理 |
| `600–959px` | 双列或主从布局 | 窄电脑窗口和中等屏幕 |
| `>= 960px` | 管理侧栏、筛选区、数据表格、详情抽屉 | Mac/Windows 日常运营 |

断点、内容宽度、表格密度、侧栏和焦点样式集中在共享 token/module。优先使用 WXSS Media Query、Flex/Grid、`px`、百分比和 `min/max-width`；只有列测量或主从状态确实需要时才使用 `onResize`。同一路由、同一页面状态和同一业务 action 随宽度换布局，不复制业务逻辑。

会员端保持受控最大内容宽度，避免在桌面窗口按 `rpx` 无限放大。管理 UI 继续使用 MIP 黑黄 token；WorkBuddy 只提供功能、字段和信息架构，不复制蓝白视觉。

## 底座提交顺序

以下提交按顺序串行完成，任何一步都保持现有页面可运行：

1. `test(admin): freeze 97-action management contract`：固定 action、当前 envelope、分组、读写类别、敏感字段和错误，不改行为。
2. `fix(admin): isolate action routing from business input`：引入嵌套 wire envelope，修复业务 `action` 覆盖路由；旧扁平请求由兼容 adapter 接收。
3. `refactor(admin): introduce neutral admin transport`：建立单入口 `AdminTransport`、CloudBase/InMemory adapters，旧 `MipAdminGateway` 暂作兼容层。
4. `refactor(admin): add trusted principal application seam`：建立不可伪造 principal、`AdminApplication.execute` 和独立 health probe。
5. `refactor(admin): centralize operation policies`：由各 module manifest 汇总 capability、scope、版本、幂等、审计、错误 allowlist 和 outbox；旧 service 暂作为 legacy adapter。
6. `fix(admin-access): unify full-access authorization`：删除知识模块第二套协议/身份门禁，统一要求当前全部协议、手机号、资料和当前角色事实。
7. `feat(ui): add responsive mini-program shells`：启用大屏，建立会员端居中容器与管理端三档响应式原语。
8. `refactor(admin-access): deepen access administration`。
9. `refactor(admin-users): deepen user administration`。
10. `refactor(admin-events): deepen event administration`。
11. `refactor(admin-orders): deepen order administration`。
12. `refactor(admin-messaging): deepen messaging administration`。
13. `refactor(admin-knowledge): deepen knowledge administration`。
14. `refactor(admin-opportunities): deepen opportunity administration`。
15. `refactor(admin-growth): deepen growth and game administration`。
16. `refactor(admin-client): remove legacy gateway escape hatch`：页面全部改用领域 client module，删除重复 action/read/wakeup 清单。
17. `test(admin): verify transport contract parity`：同一 application interface 经 CloudBase 与 InMemory adapters 运行一致合同；未来 HTTP adapter 复用同一套测试。

长任务不先建设通用工作流引擎。现有导出继续作为受控 application workflow；只有出现第二类确实需要持久进度、领取和恢复的管理长任务时，才抽取通用 `jobs` module。

## 执行检查点

### 0. 基线收拢

- 把中断现场拆成 UI、活动刷新、CloudBase 单函数部署、Demo 夹具、Demo 退款保护和文档提交；
- 复核 `main`、未提交范围和本机后台进程；
- 使用 Node 22 运行聚焦测试和最终 `pnpm verify`；
- 不重复数据库备份，不修改非 `mip_*` 资源。

退出条件：工作区只保留当前检查点明确拥有的改动，每个既有行为有独立 commit 和验证记录。

### 1. 管理合同与身份底座

1. 固定 97 个业务 action 的版本化 manifest 和合同测试。
2. 引入嵌套 request envelope，修复路由 action 被业务字段覆盖的问题。
3. 建立客户端 `AdminTransport` 与 CloudBase/InMemory adapters。
4. 建立服务端 `AdminApplication.execute`、trusted principal 和 operation registry。
5. 把统一错误 envelope、capability/scope、幂等、版本和审计规则集中到 registry/application。
6. 统一 `knowledge` 与公共 full-access 的用户状态、全部当前协议、手机号、资料、角色和 capability 校验，删除知识模块的第二套访问门禁。
7. 固定 mutation 顺序：身份与准确 scope 二次鉴权 → 幂等回放/冲突 → `expectedVersion` → 状态机 → 业务事实、审计与 outbox 同事务 → 提交后唤醒外部 worker。幂等检查必须早于版本检查，保证“首次成功但响应丢失”的重试返回原结果。
8. 将 `CONFLICT` 明确投影为刷新事实后由用户重试，不做自动 mutation 重放。
9. 让旧页面经兼容 adapter 继续工作，逐步删除扁平 transport 和页面可见的 `.gateway` 逃生口。
10. 接受当前草案协议、完成真实手机号和档案后，只把当前真实微信身份初始化为 Owner；Demo 用户永远不能成为 Owner。

手机号通过微信 `getPhoneNumber` 真实授权，开发者工具不能代替真机。提供的手机号不写入仓库、日志或 Demo 数据，也不通过数据库直写绕过微信授权。

退出条件：旧 action 全部兼容；冲突 action 有回归测试；微信和 InMemory adapters 通过同一合同套件；无权限、范围越权、协议过期、幂等重放和版本冲突均失败关闭。

### 2. 响应式壳层与第一条真实闭环

1. 启用大屏模式，建立管理侧栏、顶部上下文、内容容器、筛选区、卡片/表格和详情抽屉原语。
2. 完成用户管理：搜索、筛选、分页、详情、档案字段、分会、账号控制、角色入口、脱敏和导出。
3. 完成免费活动：创建、预览、编辑、发布、列表、详情、报名、审核、名单、签到码、签到/撤销、相册、反馈、提醒、导出和审计。
4. 手机与 Mac 宽屏读取同一业务事实，尺寸变化不丢筛选、分页、草稿或选中项。
5. 通过平台、城市分会和活动 scope 的正向与越权矩阵。

退出条件：业务方可以用一条 2030 Demo 活动完成管理创建/发布、用户浏览/报名、管理名单和手机签到的闭环；开发者工具和 Mac 微信保留截图与运行记录。扫码和手机号仍按真机证据单列。

### 3. 底座稳定后的并行纵向切片

| 切片 | 用户端 | 管理端 | 服务端重点 |
| --- | --- | --- | --- |
| 支付与会员 | 方案、下单、待确认、权益、订单、取消/退款状态 | 方案、订单、退款和财务导出 | ledger、回调、幂等、TEST/LIVE 隔离 |
| 用户与协作档案 | 档案、合作卡、案例、公开档案、访客、感兴趣 | 用户、角色、勋章和敏感字段 | 隐私、opaque reference、媒体 |
| 机会与撮合 | 搜索、筛选、发布、团队、引荐、评论、评价、匹配 | 审核、归档、评论举报、阈值和重算 | 可见性、屏蔽、候选匿名化 |
| 成长、任务与游戏 | 等级、经验、贡献、任务、赛季、排行、盲盒 | 规则、任务派发、赛季、队伍、库存和调整 | append-only 流水、非负游戏币、会员资格 |
| 知识与内容 | 分类、搜索、阅读、评论、单内容解锁 | 来源、采集、审核、商品和举报 | SSRF/内容安全、权益、首次访问 |
| 消息与运营 | 站内信、偏好、Banner、视频回顾 | 公告、消息活动、收件人、失败事实和异常中心 | outbox、授权 reservation、无高频 timer |
| 系统运营 | 我的管理入口和范围上下文 | 分会、角色策略、审计、导出和仪表盘 | trusted principal、scope、指标口径 |

每个切片同时交付用户页面、管理页面、服务端行为、数据合同、测试、Figma 对照和文档状态，不把“接口已有”和“页面存在”当成完成。

### 4. 全量 Figma 与需求验收

- 逐项核对 `REQUIREMENTS.md`、`COVERAGE_MATRIX.md`、`FIGMA_MAP.md` 和 WorkBuddy 模块地图；
- 每个目标 frame 使用真实数据或明确空/错/禁用状态完成同尺寸截图对照；
- 补齐 loading、empty、error、forbidden、conflict、disabled 和长内容；
- 检查安全区、返回路径、TabBar、字体放大、对比度、88rpx 点击热区、键盘焦点和窄窗降级；
- 原型演示人物、金额、订单号和素材不进入生产事实；
- 差异必须记录业务/平台原因，不能悄悄标成完成。

### 5. 集成与发布准备

- 每个代码检查点运行聚焦测试、`git diff --cached --check` 和对应构建；
- 每个集成检查点运行 Node 22 的 `pnpm verify` 与 `git diff --check`；
- UI 检查点运行 `pnpm runtime:preflight`、目标路由交互和截图对照；
- 云函数只用 `--only=<exact mip-* function>` 最小部署，回读函数状态、调用权限、环境和 timer；
- 不给 MySQL worker 安装高频 timer，不触碰共享环境其他项目函数、表、账号和对象；
- 支付、手机号、订阅消息、扫码、媒体、地图、日历、录音和外部内容按真机/正式配置单列；代码完成但没有真实证据时状态保持 `external-wait`。

## Git 提交规范

每个 commit 只表达一个可独立理解和复用的行为：

1. 先分类当前 diff，保留无关改动；
2. 只暂存该行为拥有的路径；
3. 运行聚焦测试；
4. 运行 `git diff --cached --check` 并复核 staged 文件；
5. 使用 `feat(domain):`、`fix(domain):`、`refactor(domain):`、`test(domain):`、`docs(mip):` 或 `chore(tooling):`；
6. 不提交 WIP、密钥、真实 AppID、EnvID、OpenID、手机号、商户信息或临时授权产物；
7. 重构 commit 不混入产品行为，行为变更必须有独立测试和提交；
8. 云端部署只针对已提交代码，部署事实记录在本地脱敏产物或文档证据中。

适合后续复用的提交顺序是：合同与 adapters → 响应式原语 → 单个业务深模块 → 单个纵向页面闭环 → 验收证据。其他小程序可以只选择需要的层级。

## 完成判定

只有同时满足以下条件，能力才从 `partial-local` 进入完成状态：

- 需求与 Figma 节点有明确映射；
- 用户端和管理端所需入口、正常态和适用状态齐全；
- 服务端资格、金额、权限、版本、幂等和审计有测试；
- 真实数据 DTO 不泄露敏感字段，不从客户端推导服务端事实；
- Node 22 静态门禁和构建通过；
- 微信开发者工具达到页面 ready state 并完成关键交互；
- 涉及外部能力时有对应真机或生产证据，否则明确为 `external-wait`；
- 代码和文档已经进入一个范围清楚的 commit。

CloudBase 额度不足不降低代码完成标准：仍完成客户端、服务端、迁移或配置代码、测试、禁用态和部署脚本；无法获得的云端运行证据明确记录为 `external-wait`，不能伪造成功。

## 当前不阻塞开发的外部输入

以下输入都已经有可替换默认配置，当前不阻塞编码：正式 AppID、支付商户、通知模板、AI provider、正式城市/行业目录、会员价格、成长规则、勋章、赛事规则、知识内容和运营素材。

发布前仍必须由业务方提供或确认真实配置，并完成微信真机、Mac/Windows 微信和生产回调验收。正式配置替换应只修改配置、目录或部署 secret，不重写业务 module。
