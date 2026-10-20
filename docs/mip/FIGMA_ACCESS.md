# Figma 读取与对照

当前主要原型只在 [DESIGN.md](../../DESIGN.md) 定义。文件链接定位页面；后续任务优先提供具体画框的“Copy link to selection”，避免一次读取整页巨型画布。

## 已验证的通道

2026-10-19 已通过有权限的浏览器 Figma 原生 Export 下载六角色原始 SVG，来源画框 `4197:38017`（机会 / 标签在这里），原始路径、预览及 SHA-256 见[角色素材清单](../../.agents/skills/mip-design-system/assets/wechat/role-tags/manifest.json)。六个角色均已进入小程序人才卡，映射由服务端角色 key 经 `src/config/mip-catalogs.ts` 转为名称，再由 `talent-card` 选择对应矢量；未知角色保留文字。

这证明浏览器原生矢量导出可行，不代表当前会话已连接官方 MCP，也不代表新文件全部页面都已下载或完成视觉验收。本机自建 `figma-bridge` 是另一个通道，使用时须先检查 bridge 在线及插件待命状态；不要把它与官方 MCP 共用端口当作同一服务。

## 推荐连接方式

在 Codex 的 Plugins 安装官方 Figma 插件，使用可访问该设计文件的 Figma 账号完成 OAuth 授权；确保文件所有者允许查看及导出。连接后先用 `whoami` 核对账号、团队与 seat，再读取目标节点和导出一张原稿作为连通性检查。官方远程端点为 `https://mcp.figma.com/mcp`，不要求安装 Figma 桌面版。

CLI 备用：`codex mcp add figma --url https://mcp.figma.com/mcp`，按客户端提示完成 Figma 登录授权。无需把个人访问令牌、登录 Cookie 或密码发到聊天或仓库。官方配置说明：[remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)。

截至本次查询，官方只读工具限额：View / Collab 每月最多 20 次；Professional 的 Dev / Full 每天最多 200 次、每分钟 10 次。频繁比对可选该文件所属 Professional 团队的 Dev seat；需要编辑设计才考虑 Full seat。先验证免费连接，再决定购买。限额、权限以 [Figma 官方说明](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/) 为准，不把购买另一个团队的 seat 当作当前文件权限已开通。

## 每次对照保存什么

保存 file key、具体 node ID、读取时间、可获得的版本、原始截图/SVG、校验值与对应代码提交；下载 MCP 返回的短期资产时保留原文件，运行时代码不引用短期 URL。按真实页面的状态、权限和数据解释差异，不把原型演示值写死到业务代码。缺资产、冲突或功能定义不清时先找用户确认。真机仍由用户后续验收；用户已豁免本轮重新生成同状态四列截图。
