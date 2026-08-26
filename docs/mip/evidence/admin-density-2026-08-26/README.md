# 管理端响应式密度验收

验收页面：`packages/admin/event-catalogs/index`。

| 视口 | 结果 | 证据 |
| --- | --- | --- |
| 375×724 | 保持移动端单栏布局；目录 key 单行显示，无横向溢出 | [mobile-375x724.png](mobile-375x724.png) |
| 1024×1302 | 固定侧栏和双列卡片正常；88rpx 控件收敛为 44px；目录 key 单行显示 | [desktop-1024x1302.png](desktop-1024x1302.png) |

两张截图均来自同一个微信开发者工具窗口，使用当前共享 CloudBase 环境的真实目录数据。桌面密度规则仅在 `min-width: 960px` 且 `.mip-admin-page` 内生效；未使用 `zoom` 或 `transform`。

SHA-256：

```text
d999f57ec60031f99d0dbc6b72acf620d6852baebc1a1d8ae2eeeaa31d4a84db  mobile-375x724.png
22c9a90f740e38d82749fa491e7eb410fea1be5317db5857204dd17ab96e318d  desktop-1024x1302.png
```
