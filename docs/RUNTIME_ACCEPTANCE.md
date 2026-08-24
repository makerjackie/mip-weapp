# Runtime acceptance

静态门禁通过后：

```bash
pnpm build
pnpm runtime:preflight
pnpm test:runtime
```

检查四个主导航：发现、活动、机会、我的；同时检查会员、订单和运营工作台等分包页面。`pnpm test:runtime` 必须让 `config/runtime-pages.json` 中的全部路由达到各自可执行的 `readyAssertion`，错误、无权限或冲突不能作为页面通过。

带查询参数的页面必须从对应列表页动态取得真实业务 ID 或 `profileRef`。来源页没有符合条件的记录时，报告记为 `external-wait`，不能使用通用 UUID、不能跳过后记为通过。

loading、empty、error、forbidden、conflict、disabled 代表状态除页面数据外，还必须命中合同配置的可见节点和关键文案。通过报告写入 `.tmp/runtime/report.json`；只有 `status=passed`、页面数等于合同路由数且代表状态全部通过，才构成开发者工具运行时证据。`runtime:preflight` 只证明登录、服务端口和路由配置可用。

完整验收时无需先执行 `pnpm dev:open`。当服务端口已配置但当前没有 DevTools 实例监听时，`pnpm test:runtime` 会先通过 CLI 打开隔离的本地 host，再重试预检；服务端口已监听时不额外打开项目。安全设置中的服务端口如果被关闭，仍需先手动开启。

运行时逐页打开和代表状态截图不代替关键业务流程交互、375px 长内容检查或 Figma 对照。未配置云环境或核心云函数不可调用时，数据页应清晰失败，不得连接原生产环境或把占位状态记为通过。未配置支付时不得假装支付成功。

## 真机能力清单

以下能力的开发者工具结果不能代替微信真机验收。具体页面以 `config/runtime-pages.json` 的 `deviceRequiredCapabilities` 为准：

- 微信手机号授权、头像选择与上传
- 微信支付、订单确认、退款状态与权益生效
- 订阅消息授权与送达
- 动态二维码出示、扫码、重复扫码、撤销签到
- 客服会话、拨打电话、视频号主页
- 微信分享面板
- 活动地图、系统日历、线上活动 `web-view` 业务域名
- 活动照片、任务附件、任务模板上传与图片内容安全
- 海报或图片保存到系统相册
- AI 录音权限、音频上传与语音整理
