# 数字码网页登录部署与验收

日期：2026-09-05。实现版本：`5f2fe89`。从已提交源码与本次登录变更组成的独立工作树验证、构建和部署；其他未提交工作未进入发布产物。

## 最终行为

- 未登录时右上角直接显示“登录”，内容区显示“请先登录”；登录后的权限判断继续由现有服务端权限模型决定。
- 网页只展示 5 分钟有效的 6 位数字码。打开有访问权限的 MIP 开发版或体验版，在“我的 → 现场工作台 → 确认网页登录”输入码并确认，网页轮询会话状态。
- 默认创建数字码不调用二维码上游；只有 `POST /api/auth/challenge?qr=1` 请求可选小程序码，失败时仍返回数字码。
- 云函数使用 `MIP_ADMIN_WEB_LOGIN_QR_ENV_VERSION=trial`。扫码目标可独立设为 `trial`、`develop` 或 `release`；当前 Web 不展示扫码入口。
- 保持现有 AppID allowlist、运营权限、用途隔离的 HMAC、浏览器 Cookie 绑定、限流、到期与单次消费。没有修改微信成员权限或重新发起 Device Flow。

## 本地验证

Node 22.23.1 / pnpm 11.14.0，隔离快照的 `pnpm verify:all` 退出码为 0，包含完整 `pnpm verify` 与 `pnpm admin:web:verify`：

- 小程序：205 个测试文件、1,042 项测试通过；类型、lint、构建、分包、源码和文档门禁通过。
- 服务端：607 个源码文件、261 个测试文件的服务端契约验证通过。
- Web：112 项 Node 契约测试、52 项 React 测试通过；类型、lint、生产构建、响应式源码契约通过。
- 首次独立 Web 全量运行出现 6 项测试超时；随后联合门禁中同一源码全部通过，没有放宽测试超时或修改断言。
- 登录专项 BFF 与二维码测试 34 项、会话与界面 React 测试 9 项通过。
- `git diff --check` 通过。

## 生产网站

Cloudflare Production 部署 `f41998f2-1ec8-43f6-b564-42c17fedcc0a`，版本 `5f2fe89`，控制面回读为 `success`。详见 [部署摘要](cloudflare-deployment.json)。

[生产接口摘要](production-smoke.json) 是无身份 smoke，仅创建临时登录请求，不伪造可信微信身份：

| 检查 | 实测 |
| --- | --- |
| 默认创建数字码 | HTTP 201，6 位数字，约 547 ms，无二维码和私密身份字段 |
| 持 Cookie 轮询 | HTTP 200 / PENDING |
| 错误 Origin | HTTP 403 |
| 未签名确认 | HTTP 400，随后仍为 PENDING |
| 退出 | HTTP 200，Cookie jar 清空 |
| 退出后运营会话 | HTTP 401 |
| 可选体验版小程序码 | HTTP 201，有效 JPEG 图片签名，约 4,631 ms，数字码同时可用 |

生产浏览器验证了右上角直接登录和实际数字码弹窗。1440×900、1280×720、390×844 三个视口均观察截图，根节点 scrollWidth 分别为 1440、1280、390，没有横向溢出。关闭弹窗后返回未登录页面，焦点回到登录按钮。截图仅保留在任务工具输出，仓库不存临时登录码。

## 云函数部署边界

`mip-admin-api` 代码和配置已更新，回读为 Active / Available，Nodejs20.19，更新时间为 2026-09-05 10:34:14（控制面原值），stage 为 staging，二维码目标为 trial。代码 SHA256：

```text
05e9a42d17f90f2be35245ec3d833cb8700cff4938e1f1cdbc26607596febc66
```

单函数部署脚本已完成代码与配置更新，但末尾健康检查没有通过：MCP `invokeFunction` 返回 `[Invoke] Cam authentication failed`，部署脚本将无健康响应表述为未证明 MySQL persistence。完整 `cloud:verify` 同样未拿到 invocation evidence。此前复用的 local daemon 也返回 CAM 错误；重新启动本次隔离工作树的 local 通道后显示当前未登录，没有重新发起设备授权。

因此，**云端全量健康门禁仍为 BLOCKED，不能声称所有云函数验收完成**。已通过生产 HTTP 路径生成真实小程序码，证明当前 admin 函数的签名、nonce 持久化和微信码生成路径可执行；这不替代完整云健康检查或真人确认登录。

## 扫码结论与真机待验收

部署前回读的实际云环境已经是 staging，原二维码目标也是 trial。不能把原扫码问题归因于生产码指向 release，更不能根据“尚未发布”断言体验版无法扫码。

微信官方 [getUnlimitedQRCode](https://developers.weixin.qq.com/miniprogram/dev/server/API/qrcode-link/qr-code/api_getunlimitedqrcode.html) 支持 `env_version=trial|develop` 与 `check_path=false`；[成员权限](https://developers.weixin.qq.com/miniprogram/dev/framework/quickstart/release.html) 要求访问者具有对应的体验者或开发者权限。目标版本也必须实际包含确认页面。图片生成成功不等于微信真机跳转成功。

目前缺少可信微信真机上下文，**目标运营账号从小程序确认到网页取得有效运营会话仍为 PENDING**。数据库只保存身份哈希，没有用用户 UUID 或哈希充当 OpenID，也没有把内部签名模拟响应记为真机结果。继续使用数字码时，只需打开当前已有确认入口的开发版或体验版；无需为本次 Web / 云端变更重新上传小程序。
