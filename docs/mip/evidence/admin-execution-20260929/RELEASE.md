# 同一 CloudBase 后台目标的发布记录

本文件记录 W21 的实际发布与回读，不新增验收标准。产品条件仍以 [ACCEPTANCE.md](../../../../admin-web/ACCEPTANCE.md) 为准。

目标为既有 CloudBase HTTPS 后台，环境阶段 `staging`、支付模式 `test`。静态前缀限 `mip-admin-console/`；BFF 为 `mip-admin-web-api`，业务入口为 `mip-admin-api`。没有将本次结果记为正式生产或真机验收。

## 已发布与验证

- 最终完整 `pnpm verify:all` 通过：主工程 259 个文件 / 1484 项，Web 合同 223 项，React 19 个文件 / 123 项。媒体函数完整回归 31 项通过；lint、类型、构建、生成一致性、隔离及响应式合同通过。`git diff --check` 通过。
- 兼容迁移 094 `20260929010000`、095 `20260929020000` 已应用，150 张 runtime 表权限准确回读，服务器重复名称组为 0。没有删除历史表或流水。
- 八个授权消费者和管理 API 共九个函数已部署。下载云端 ZIP 验证 SHA-256，逐个核对全部本地 JS 内容；均为 `Nodejs20.19`、Active、MySQL 健康通过。最终代码记录见 [deployed-code.public.json](deployed-code.public.json)。
- 前端使用真实数据模式，最终入口资源为 `index-BCN0QiWF.js`。所属前缀 12 个静态文件上传后下载核对 SHA-256；同源 BFF 已发布。真实 HTTPS 检查 64/64，通过登录、非空读取、来源/Cookie/退出后旧会话及资源 MIME/404。[HTTP 报告](live-http.public.json)与[静态核对](frontend-static.public.json)单列采集时间。
- 只在确认所有权后为 `/assets` 配置严格 BFF 处理器，缺失 JS 返回 404。保留 `/` 所属静态前缀及 `/api` 同源 BFF；未修改共享静态托管全局设置、Cloudflare 或 DNS。
- 所有授权消费者回读后，管理 API 的岗位模板入口已启用并再次回读。四个验收模板均 INACTIVE、绑定数 0；没有给真实用户授予权限。后续部署保留现有开关值，不能被默认配置复位。
- Web 图片安全检查改用微信服务端 HTTP 接口，与已工作的文字检查复用令牌缓存与失败关闭规则。共享客户端仅有一个编写源，各函数携带生成副本，完整门禁检查生成一致性；小程序调用继续使用其原有云调用通道。凭据只在服务端配置，检查失败不上传。
- 有效 128×128 自有图片真实上传及 HTTPS 预览通过。新建“验收媒体活动（未发布）”保持 DRAFT；封面绑定、全文/0/false 回读、文字检查及重复提交均通过。浏览器重新编辑显示完整正文及 128×128 封面；未发布、未报名、未收费。见[媒体上传](media-safety.public.json)、[绑定回读](media-binding.public.json)及[实际截图](event-media-bound-desktop-final.png)。此前云调用上游错误保留为历史诊断，不当作最终失败结果。
- 私有草稿、复制原对象不变、未绑定模板版本/幂等/停用以及六类非空 XLSX 下载全流程已通过；三个实际视口、双用户独立页面、演示机会全文保存/刷新/重开和恢复原文已验证。详细边界见 [README.md](README.md)。

## 备份、部署通道与回滚

发布前数据库备份位于维护者本机 `~/Backups/mip-weapp/admin-execution-20260929`：152 张表、2498 行，逐表行数核对完成。十个原有函数 ZIP 与私有配置位于 `~/Backups/mip-weapp/admin-functions-20260929`，下载校验全部通过。敏感备份、下载文件、原始响应及凭据没有进入仓库。

首次 SCF 健康调用被环境 API Key 拒绝，错误为 `Cam authentication failed`；当时停止发布。复用既有 Device Flow 登录态并重启保持连接的 MCP 进程后，同一目标健康检查通过；后续控制面显式使用 `CLOUDBASE_AUTH_MODE=local`，没有跳过健康检查或申请新的部署身份。

八个授权消费者为 `mip-identity-api`、`mip-events-api`、`mip-tasks-api`、`mip-media-api`、`mip-game-api`、`mip-banners-api`、`mip-opportunities-api`、`mip-outbox-worker`。未安装 MySQL 保活定时器。媒体函数只增加同一微信应用的既有服务端配置及接口出网能力，保留原有运行时、VPC、权限和调用方校验。

岗位模板入口已经启用：任何回滚都必须先重新确认当前绑定；一旦存在绑定，不能把消费者回退为忽略模板的旧代码。数据库优先向前修复，094/095 回滚脚本保留新增记录。恢复函数或前端必须使用私有备份并完成健康、来源、授权、静态资源和数据回读，不能只根据上传命令判断成功。

## 未通过本轮发布消除的边界

53 条场景仍逐条保留，18 条受 Q-ADMIN-01～09 的未确认规则影响；未决只阻塞相关步骤。跨角色绑定/撤权、完整状态旅程、用户端对应对象、受控消息接收和真机支付/扫码等缺口见[矩阵](../../COVERAGE_MATRIX.md#53-条场景当前记录)。没有以自动测试、部署、有限烟测或本机 Git 变更宣布全部产品验收完成。以上运行证据采集时尚未提交或推送；后续 Git 交付必须单独核对本地提交和远端 SHA，不能用这些运行结果替代。
