# AGENTS

`admin-web/` 是 MIP 的 React 运营管理后台。它与根目录微信小程序独立构建、独立部署，但复用同一个 AdminRequest v1、Cloudflare Worker BFF、`mip-admin-api` 权限模型和服务端事实。

## 技术栈

- React + TypeScript + Vite
- TanStack Router：路由、筛选、分页和标签页 URL state
- TanStack Query：服务端状态、缓存和失效
- Ant Design + Design Token：布局、表格、表单、抽屉、弹窗和反馈
- Vitest + Testing Library：module interface、React adapter 与关键交互

不使用 Next.js、SSR/SSG、Redux、TanStack Start；第一阶段不引入 TanStack Table。

## 先读

1. [README.md](README.md)
2. [ARCHITECTURE.md](ARCHITECTURE.md)
3. [DESIGN.md](DESIGN.md)

## 依赖方向

`app/route-pages → features → modules/services → 同源 BFF → mip-admin-api`

- 页面不直接拼 AdminRequest，也不复制会员、活动资格、订单、支付、权限或状态机规则。
- `src/modules` 保持渠道中立；React 只通过 module interface 调用。
- mutation 保留原 action、顶层幂等键、`expectedVersion`、capability 和服务端错误。
- 浏览器不接触 CloudBase API Key、MySQL URI、HMAC、OpenID 或可信 principal 字段。
- 不引用 `wx`、WXML、TDesign MiniProgram、根目录小程序页面或小程序运行时 adapter。

## 设计

- Workbuddy 原型是 Web 视觉依据；实现通过 Ant Design Token 和 `shared/ui` 公共模块统一，不逐页硬编码。
- 文案朴素、中性、专业，不把内部开发说明放进 UI。
- 桌面端优先；390px 必须真正重排，不保留造成横向溢出的桌面侧栏。
- 图标使用 `@ant-design/icons`，不使用字符、emoji、手绘 SVG 或 CSS 图形模拟图标。

## 状态与权限

- 服务端状态：TanStack Query。
- 路由、筛选、分页、标签页：TanStack Router URL state。
- 表单：Ant Design Form。
- 页面局部状态：React state。
- 不增加全局客户端状态库。
- `PermissionGuard` 只控制入口展示和交互；服务端仍是最终授权者。
- 真实请求失败不得回退到 demo；demo 必须由 `VITE_MIP_ADMIN_DEMO_MODE=true` 显式启用并持续显示标识。

## 测试与完成

```bash
# 从仓库根目录执行
pnpm admin:web:verify
```

视觉变更另验收 1280×720、1440×900、390×844；检查键盘焦点、对比度、无横向溢出、加载/错误/空/无权限状态。生产登录、上传、导出、支付和 CloudBase 成功事实必须单独标注证据边界。
