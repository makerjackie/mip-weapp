# 2026-10-09 管理后台域名绑定

入口：[admin.mip.cool](https://admin.mip.cool/#/overview)。本轮只给已有 CloudBase 后台追加自定义域名，运行源码沿用[同日发布](../admin-release-20261009/README.md)的 `d69d9b7336e2f41cd3a21d62e0449911f291b38f`。未重新部署运行代码；后续 Git 文档提交不改变后台运行版本。

## 绑定与配置

- 阿里云精确 `admin` CNAME 指向本轮平台回读的 `admin.mip.cool.tcbaccess.tencentcloudbase.com`，TTL 10 分钟。权威 DNS、阿里公共 DNS 与 Cloudflare 公共 DNS 均回读一致；使用 Cloudflare 公共递归 DNS 查询不代表网站经 Cloudflare 代理。
- CloudBase HTTP 网关使用 `DIRECT`、`HTTP_TO_HTTPS`，域名 `Status=SUCCESS`、`DNSStatus=OK`、`PlatformCnameDNSStatus=OK`。只追加 `/` 静态隔离前缀与 `/api`、`/assets` BFF 路由，旧域名及其路由逐项保持原配置；没有增加核心管理函数路径。
- BFF `MIP_WEB_ADDITIONAL_ORIGINS` 追加精确 HTTPS origin，保留默认 origin；平台安全域名追加对应 host 并回读 `ENABLE`。本机 `.env.local` 同步追加值，默认发布 origin 保留。完整环境回读、配置守卫及代码摘要/内存/公网对比通过，角色/VPC/超时/运行时未变。
- 免费单域名证书已签发并关联。真实 TLS 信任链与主机名校验通过，证书到期 **2027-01-07 16:59:59（Asia/Shanghai）**；需在到期前重新签发并更新网关关联，不将免费证书描述为自动续期。
- 证书待签发时，预检曾显示 `Cert=PASS`，正式创建仍返回 `certificate[...] content invalid` 并留下空的失败绑定。签发后仅移除本轮无 CNAME/路由的失败记录并重建，最终状态与实际 HTTPS 通过。该错误已写入发布 skill，防止把预检当作完成证明。

## 实际访问验收

| 检查 | 本轮结果 |
| --- | --- |
| HTTPS 首页、HTTP 强制跳转 | 200 / 307，跳转目标同域 HTTPS |
| 当前静态文件 SHA-256、大小与 MIME | 14/14 与同日构建清单一致 |
| HTML 与浏览器加载入口 | `/assets/index-CYFT5GuB.js` |
| 真实认证、Cookie、防护来源、只读模块、退出与重放拒绝 | 67/67 PASS，14 个读模块 |
| 缺失哈希资产 | 404，未回退成 HTML |
| 浏览器真实密码登录、非空概览、控制台 | PASS，控制台无 error |
| 实际 CSS 视口及横向溢出 | 1440×900、1280×720、390×844 PASS；临时视口恢复 |

[domain.json](domain.json)、[assets.json](assets.json)、[https.json](https.json)与[browser.json](browser.json)只保存公开配置、摘要、计数和验证状态。完整配置、认证与平台回读、DNS 及浏览器截图保留在本机忽略目录 `.tmp/domain-admin-mip-cool/`；不保存环境 ID、凭证、Cookie 或个人资料到 Git。

本轮没有购买付费证书/CDN、改根域/泛解析/邮件、下线 Cloudflare、微信上传或业务写入。新入口的页面/API/资产直连 CloudBase；旧 Cloudflare 别名和旧站保留。微信真机确认及支付仍沿用同日发布的未验收边界，原生 Invoke 健康探针的权限阻塞也未被本次域名验证取消。
