# React Web 管理端线上验收

验收日期：2026-08-28。

## 发布对象

- 生产地址：`https://mipmini.01mvp.com/`
- Cloudflare Pages deployment ID：`22429e0f-344a-49af-8fb8-e76a75f86507`
- 生产源码：`c21b3b4`
- CloudBase：核心函数及本轮修复函数均已部署，`pnpm cloud:verify` 通过

本文件不记录 challenge、Cookie、AppID、环境标识、OpenID、数据库地址、HMAC、导出 token、资源 ID 或个人信息。

## 身份与线上只读

真实管理员通过微信侧确认网页登录，浏览器进入 `AUTHENTICATED`。当前 React 管理端 14/14 个已认证一级路由均完成生产真实只读验收：

1. 网站概览
2. 用户管理
3. 活动管理
4. 订单管理
5. 任务管理
6. Banner 管理
7. 素材上传
8. 战队管理
9. 机会与内容
10. 成长与勋章
11. 权限管理
12. 消息管理
13. 知识库
14. 运营记录

该结论证明当前路由通过真实会话读取服务端事实，不代表所有写 action、外部 provider 或敏感字段均已生产验收。真实请求失败时仍进入错误态，不回退 demo 数据。

## 最小生产写入闭环

本次只使用可识别、可软删除的测试对象验证媒体和 Banner 链路：

1. 真实 JPEG 通过同源媒体入口上传成功。
2. 该素材用于保存状态为 `INACTIVE` 的 Banner。
3. 保存结果由服务端响应确认。
4. Banner 通过现有服务端 action 软删除成功，未执行物理删除。

该证据只覆盖 Banner 用途 JPEG，不外推为其他 7 类媒体用途、正式运营素材、视频或 AI/provider 能力通过。

## 敏感导出闭环

用户导出采用最小敏感范围：

- `exportType=USERS`
- `includesPhone=false`
- 使用唯一无匹配条件，服务端结果 `rowCount=0`
- 通过 HTTPS 临时下载读取导出文件
- ZIP magic、实际字节数和 SHA-256 均与服务端声明一致
- 完成确认后 ticket 状态为 `CONSUMED`
- 校验与完成后清零验收进程内文件字节，不在本证据保存导出内容或 token

该结果证明零行、不含手机号的用户导出链路，不证明非空导出、手机号字段、订单导出或其他敏感数据权限。

## 小程序运行时

微信开发者工具最终报告 `.tmp/runtime-evidence/2026-08-28-final-r6/report.json` 的结果为：

- 路由：110/110
- 代表状态：6/6
- 交互旅程：6/6
- 运行时与 IDE diagnostics：0

该结果证明当前开发者工具运行时闭环，不替代手机号、支付、扫码、订阅消息和文件/相册等真机能力，也不替代 Mac 或 Windows 微信客户端兼容性验收。

## 响应式与对照截图

- [React 概览 1280×720](../../../../admin-web/docs/screenshots/react/overview-1280x720.jpg)
- [React 概览 1440×900](../../../../admin-web/docs/screenshots/react/overview-1440x900.jpg)
- [React 概览 390×844](../../../../admin-web/docs/screenshots/react/overview-390x844.jpg)
- [Workbuddy 与 React 1280×720 左右对照](../../../../admin-web/docs/screenshots/comparison/workbuddy-vs-react-1280x720.jpg)

## 术语与剩余边界

“服务器”是产品 UI 对城市分会的习惯称谓。服务端模型、数据库表和契约继续使用 `branch` / city branch，不新增通用服务器或租户模型。

以下仍为独立等待项：

- 正式支付、退款回调和会员权益的生产闭环
- 手机号、扫码签到、订阅消息和小程序上传等真机能力
- AI/provider、外部内容安全或采集服务的正式结果
- 外部消息投递、回执与失败重试
- Mac 与 Windows 微信客户端兼容性
- 其他媒体用途、非空导出和含敏感字段导出

此前较小范围的身份与只读证据仍保留在 [2026-08-28 历史 Web 验收](../admin-web-live-2026-08-28/README.md)。历史证据用于说明演进过程，不覆盖或代替本文件的当前 React 生产结论。
