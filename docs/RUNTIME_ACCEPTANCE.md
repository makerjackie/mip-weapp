# Runtime acceptance

静态门禁通过后：

```bash
pnpm build
pnpm runtime:preflight
pnpm test:runtime
```

检查四个主导航：发现、活动、机会、我的；同时检查会员、订单和运营工作台等分包页面。`pnpm test:runtime` 必须让 `config/runtime-pages.json` 中的全部路由达到各自可执行的 `readyAssertion`，错误、无权限或冲突不能作为页面通过。

loading、empty、error、forbidden、conflict、disabled 代表状态除页面数据外，还必须命中合同配置的可见节点和关键文案。通过报告写入 `.tmp/runtime/report.json`；只有 `status=passed`、页面数等于合同路由数且代表状态全部通过，才构成开发者工具运行时证据。`runtime:preflight` 只证明登录、服务端口和路由配置可用。

运行时逐页打开和代表状态截图不代替关键业务流程交互、375px 长内容检查或 Figma 对照。未配置云环境或核心云函数不可调用时，数据页应清晰失败，不得连接原生产环境或把占位状态记为通过。未配置支付时不得假装支付成功。

必须真机：手机号、微信支付、订阅消息、扫码签到。开发者工具结果不能代替这些能力。
