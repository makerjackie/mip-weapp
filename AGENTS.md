# AGENTS

这是 MIP 产品仓库。根目录仍是微信小程序主工程，`admin-web/` 是独立构建、独立部署的 React 管理后台；两端共同使用 `cloudfunctions`、`database/mysql` 和平台中立的服务端契约。

## 0. 问题与歧义必须提前确认

- 用户明确要求：发现明确缺陷、需求/原型/实现冲突、关键素材或定义缺失，以及其他不清楚的地方，必须尽早主动找用户确认；不能自行把问题降为“以后补充”后继续宣告完成。
- 提问前先查证可查的事实，一次说明具体缺项、证据、影响范围和推荐方案；不要只在长报告中埋一条备注，等用户追问。
- 未确认前暂停受该问题影响的取舍、替代、删减、补画或发布结论；可以继续不依赖该决定的工作。已确认方案中的常规实现细节由工程侧执行，不重复索要相同确认。
- 素材按实际用途逐项盘点，明确已找到/缺失数量；大型角色插画不能充当标签小图标，自制素材不能冒充原稿。
- 明确区分“已修复并验证”“待用户确认”“待素材”“待真机/外部验证”。测试通过、截图生成、开发版上传，不自动等于完整还原或验收完成。
- 需求澄清沿用 [澄清记录](docs/mip/REQUIREMENT_CLARIFICATIONS.md)：未决项在需求基线登记；用户确认后记录原话、覆盖边界并同步基线、术语及验收标准，不能把确认当成已实现或全部验收。

## 1. 定位

保留会员、活动、订单、支付和运营后台，方便改品牌后上线。

## 2. 技术栈

- 微信小程序：原生 WXML + TypeScript + weapp-vite + Tailwind CSS 4 + weapp-tailwindcss 5 + TDesign MiniProgram。`src/` 内不要引入 React/Vue/Taro/uni-app。
- Web 管理后台：`admin-web/` 使用 React + TypeScript + Vite + TanStack Router/Query + Ant Design；遵循 [admin-web/AGENTS.md](admin-web/AGENTS.md)。
- 平台中立共享契约：仅放在 `packages/`，不得为了复用展示代码提前拆包。

## 3. 目录地图

- `src/pages` 主 Tab
- `src/packages/member` 用户端二级页
- `src/packages/admin` 小程序现场工作台（仅 Web 登录确认、已授权活动、签到码与海报、名单与签到）
- `src/modules/mip-*` 用户与运营领域
- `src/modules/mip-admin` 运营领域
- `src/platform` / `src/shared` 平台原语（已从共享包内联）
- `src/config` 品牌、功能开关、运行时
- `admin-web` React Web 管理后台（独立构建；CloudBase 静态托管/云函数部署）
- `packages/admin-contracts` 两端共用的 AdminRequest v1 中立契约
- `cloudfunctions` 与 `database/mysql` 服务端事实
- `.agents/skills` 任务技能

## 4. 常用命令

`pnpm setup` · `pnpm dev:open` · `pnpm verify` · `pnpm admin:web:dev` · `pnpm admin:web:build` · `pnpm admin:web:verify` · `pnpm verify:all`

## 5. 改代码前先读

1. 本文件
2. [docs/README.md](docs/README.md)，按权威关系定位任务文档
3. 任务对应文档：界面 [DESIGN.md](DESIGN.md)，领域 [docs/MEMBERSHIP_DOMAIN.md](docs/MEMBERSHIP_DOMAIN.md)，支付 [docs/WECHAT_PAY.md](docs/WECHAT_PAY.md)，云 [docs/CLOUDBASE.md](docs/CLOUDBASE.md)

## 6. 边界

- 小程序页面 → modules → platform/cloud functions
- Web 页面 → React adapter → modules/services → 同源 BFF → `mip-admin-api`
- 完整运营界面只进入 `admin-web/`；小程序不得新增现场白名单以外的管理页面
- 页面不得直接 `wx.cloud.init` 或 `wx.requestPayment`
- 云函数不得依赖仓库外路径
- `admin-web/` 不得引用 `wx`、WXML、TDesign MiniProgram 或 `src/pages` / `src/packages`。
- 增删改查功能时必须双端联动排查：删除、下线或调整小程序功能时，不能只看小程序，还要检查 `admin-web/` 是否有对应的管理界面，以及 `packages/admin-contracts`、`cloudfunctions`、`database/mysql` 是否有需要一并处理的契约、云函数和数据结构；改管理后台时同样反向检查小程序侧。不得只改一端就收工。

## 7. 配置和密钥

可提交：`.env.example`、`src/config/brand.ts`、`touristappid`
仅本地：`.env.local`（普通开发配置）、`.env.secrets.local`（可选 owner/deployer 恢复副本）、`project.private.config.json`、商户证书、MySQL URI

### 微信代码上传

- 每次上传体验版或正式版本前，必须执行并通过完整 `pnpm verify:all`；测试、构建或预算失败时停止上传，不以专项测试或旧报告替代。即使使用开发者工具 CLI，也不得绕过此门禁。`pnpm wechat:upload` 自动执行该检查。

- 日常上传优先使用已登录的微信开发者工具登录态，通过仓库现有的 `weapp upload` 流程操作；不把登录态、二维码或凭证写入仓库。
- 微信开发者工具登录态不可用时，使用 `miniprogram-ci` 读取 `.env.local` 中的 `MIP_WECHAT_CODE_UPLOAD_KEY_PATH` 作为 `privateKeyPath` 上传；当前默认路径为仓库根目录下的本地微信私钥文件。
- 私钥只作为本地文件保存，并由 `.gitignore` 忽略；不得读取、打印、复制到源码、构建产物、云函数或日志，也不得修改包含它的文件夹权限。
- 上传前先构建 `dist/`；正式上传必须明确版本号和更新说明。微信开放接口凭证用于接口访问，不替代代码上传私钥。

## 8. CloudBase

推荐通道为 `config/mcporter.json` 及仓库现有脚本，不是唯一通道。已获授权的任务中，遇到能力缺失、接口限制或故障时，可使用官方 CLI、SDK 或已登录的微信开发者工具完成同一范围操作，不因切换工具本身重复请求批准。切换前核对目标环境、函数与源码，保留现有配置和权限边界，完成后回读验证；新增权限、扩大操作范围仍按实际授权处理。

默认使用 `.env.local` 中的环境级 `CLOUDBASE_API_KEY` 与 `CLOUDBASE_ENV_ID`；`pnpm cloud:status` 和 `pnpm cloud:auth` 只验证并加载 API Key，不发起设备码。

API Key 是日常通道，Device Flow 是部署高权限通道。只有创建、更新云函数等 SCF 控制面操作被 API Key 拒绝时，维护者才显式运行 `pnpm cloud:auth:device -- --allow-device-auth`，并以 `CLOUDBASE_AUTH_MODE=local` 执行该次部署。Device Flow 登录保存在本机并支持刷新，通常不需要每次部署重新授权；凭证过期、被撤销、主动退出、清理本机凭证或更换电脑/系统用户时才重新授权。

其他人使用本仓库时必须配置自己的 CloudBase 环境 ID 和 API Key；需要部署云函数时使用其有权访问目标环境的腾讯云账号完成 Device Flow。不得复制、提交或共享维护者的 API Key、Device Flow 登录文件或本机凭证。

不要给会访问 MySQL 的云函数挂高频定时触发器（例如每 5 分钟）。Serverless MySQL 大约空闲 10–30 分钟才会暂停；定时任务会一直把实例唤醒，按 CCU（核·小时）消耗资源点，个人版额度很快会被打满。通知 worker 只保留函数，默认不安装定时器。

## 9. 微信支付

客户端只提交订单意图。金额、发货、退款由 ledger 与回调决定。`requestPayment` 成功不是权益生效。

## 10. 设计

[DESIGN.md](DESIGN.md)。其中指定的当前 Figma 是后续原型主要来源，不以旧 mip-dev 或旧 Figma 覆盖；发生冲突遵循第 0 节先确认。品牌入口 `src/config/brand.ts`。

### 原型开发交付规范（小程序与 Web 后台通用）

- 每次依据原型新增、还原或调整界面，默认交付三列对比：**左：修改前的真实界面；中：修改后的真实界面；右：当前权威原型原图**。保留原始截图，标注页面、来源链接/节点、版本、环境和时间；整理到本批 `docs/mip/evidence/` 的可浏览报告。用户本次明确豁免时记录范围，不延伸为后续默认豁免。用户2026-10-20补充长期呈现规则：不涉及UI原型的功能迭代不列原型图或占位列；有原型的UI还原仍保留三列。
- 三列尽量使用相同视口、数据、筛选、角色和业务状态；无法一致时明确标出差异，不通过伪造数据、隐藏功能或拼图冒充一致。各端按自己的权威设计文档定位原型，不混用旧稿或另一端设计；原型有更新或定义冲突时先确认。
- **业务与数据正确优先于视觉相似**：原型示例文案不能硬编码成业务事实。数据必须走真实服务、权限、配置与状态机；测试样本只进明确测试环境，并能通过正常流程保存、刷新回读。金额、资格、历史引用、空/错误/长内容等状态要正常处理，不能为凑截图破坏功能。
- 开工前盘点实际用途所需素材及数据来源；图标逐一核对“角色→原型节点→导出文件→代码映射”，列明已找到/缺失数量。类似六枚标签图标仅找到两枚时，必须提前说明缺四枚、影响与推荐方案并找用户确认；不得拿大型角色插画、自制图或其他图标代替后宣称还原。
- 需要用户配合时，尽早一次说明已查证的缺项、影响、推荐方案和全部操作步骤。仅暂停依赖该确认的工作，继续独立事项；常规技术实现自行完成。不得把未确认、未验证的问题埋在报告中当作完成。
- 对比图同时附关键功能证据与未验收项：真实非空列表、交互、保存后新页面/新请求回读；小程序检查实际画面与目标手机视口，Web 检查桌面和手机。区分本地夹具、真实测试库、生产、真机；二维码注明开发预览/体验版、目标环境和入口，保存在忽略目录或仓库外，不提交二维码或凭证。

## 11. 测试和验收

`pnpm verify` 只验证微信小程序与 CloudBase；`pnpm admin:web:verify` 独立验证 Web；`pnpm verify:all` 顺序执行两者。小程序 UI 还要 `pnpm runtime:preflight`；Web UI 要按 `admin-web/AGENTS.md` 验证桌面和手机视口；支付/手机号要真机。

- 排查列表加载问题时，必须包含非空服务端响应到页面展示的合同测试；TypeScript 类型声明、空列表和重试成功不能代替真实字段结构校验。
- 受保护页面的身份检查锁只覆盖身份决策，不覆盖后续列表；身份失败后的重试必须重新确认身份。可选目录或装饰性请求失败不得让已成功的正文变成整页错误。
- 构建后检查 dist 健康：嵌套依赖树 `dist/miniprogram_npm/tdesign-miniprogram/miniprogram_npm/` 必须存在（`pnpm build` 已内置断言，缺失即失败）。若构建失败提示缺树，删 `node_modules/weapp-vite/.cache` 再 `pnpm build`——npm 缓存命中会跳过 emit，缺树时全部 TDesign 组件内联渲染（按钮变裸文字、弹层印在页面上，2026-10-13 MIW-79，详见 PROJECT_STATUS.md）。上传前用平台体积报告确认主包 < 2048KB。
- 体验版上传用 dist 平铺临时工程，不要从根工程（`miniprogramRoot: dist/`）直传——直传报 800059 假缺文件。平铺工程会原样继承 dist 的好坏，上传前必须先做上一条的 dist 健康检查。
- 保存验收不能只看 handler 返回或页面缓存：记录服务端版本/关键字段变化，确认真正离开页面，再打开新页面等待 ready 后回读。DevTools 重建后若黑屏、路由不切换或保存锁仍在，先完整编译、重连并核对实际画面；撤回失真的旧结论，再重做验收。
- 富文本图片必须核对实际 `rich-text` 节点和选中标签的画面：`img` 只使用网络图片，不能复用普通 `image` 的 `wxfile://`/`http://tmp/` 缓存。`wx.getImageInfo` 解码成功不等于富文本已显示；分别验证介绍、主办方、报名须知、报名确认和签名到期后的标签重建，缺少真机证据时明确待验收。稳定云文件引用留在服务端事实，短期签名仅用于读取，不写回业务数据。
- 写请求遇到非标准响应时，先回读核对是否已生效，保留原幂等键；不得自动重复提交或把一次重试成功记作根因已修复。发布前逐键对比云端配置，保留本次未要求变更的登录回调、分流和权限，不用本机默认值覆盖既有有效配置；核对客户端与依赖服务的环境，专项通过不能替代完整门禁。

## 12. Skill

| 任务               | Skill                   |
| ------------------ | ----------------------- |
| 页面/工程          | `weapp-development`     |
| 视觉               | `weapp-design`          |
| 云开发             | `weapp-cloudbase`       |
| 支付               | `wechat-pay`            |
| 会员领域           | `mip-membership-domain` |
| 部署运营           | `mip-operations`        |
| Web 后台更新与发布 | `mip-admin-release`     |
| 运行时验收         | `weapp-runtime-qa`      |

## 13. 禁止

案例馆、跨仓库相对脚本、提交密钥、用客户端决定服务端事实。只允许经过审查的平台中立契约使用 workspace package；页面、样式和运行时 adapter 不得为共享而抽包。

## 14. 完成前

### 对外验收报告站（用户长期规则）

- `https://miptest.01mvp.com` 专用于测试和客户验收。实际修复并验证后，每次任务必须更新该站；流程与命令见 [验收站维护规则](docs/mip/acceptance-site/README.md)。只生成本地文件不算已更新网站，发布后须检查真实 HTTPS、资源和桌面/手机画面。
- 用户 2026-10-21 补充：当日报告先写原始需求与本日目标，再展示实现结果、逐项验收标准及实际验收结果；未完成/待真机分开写。站点使用压缩预览，保留原始截图及原图查看，不重写历史冻结证据。
- 首页按最近更新时间倒序，以日期时间线每天合并为一条验收记录；点击直接查看当天全部改动，正文简明列出主要变化、必要证据和待复测事项。精确时间与代码SHA等追踪信息保留源数据，不堆入客户页面。只在涉及UI且有对应原图时展示原型列；无原型不放占位列，纯功能/性能优化无需截图。不伪造截图或把旧稿当现稿。
- 同一需求仍在当前对话反馈、用户尚未定稿或外发时，更新同一草稿，保留首次提交时间。用户明确说已定稿/已发给客户后冻结该版本和图片；后续变更新增版本并链接上一版，不能覆盖已外发内容。冻结摘要由 `scripts/acceptance-site.mjs` 校验。
- 真实业务、模拟、开发者工具、真机和生产分别标记；未验收内容不得写成已修复通过。公开站只发布经过检查的脱敏材料，二维码、身份/订单编号、凭证和原始云日志留本机。

```bash
pnpm verify
pnpm admin:web:verify
pnpm verify:all
git diff --check
```

涉及支付或云资源时，写明哪些仍需真机/生产环境。

## 领域额外规则

- 会员、订单、活动资格不能由客户端计算
- 改数据库必须追加迁移
- 手机号、支付、订阅消息、扫码签到必须真机验证
