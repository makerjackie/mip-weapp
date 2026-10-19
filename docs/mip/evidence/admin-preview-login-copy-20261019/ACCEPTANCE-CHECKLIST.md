# 管理后台活动高保真预览 + 登录链路文案合规 · 发布验收 Checklist（2026-10-19）

批次：MIW-122 + MIW-124（main 合并提交 `218e66c7`、`28a444d1`，推送范围 `22da8077..28a444d1`）
范围：MIW-122 = admin-web 活动表单高保真预览（纯 Web 前端，8 文件 +621/-64）；MIW-124 = 登录链路去「微信」品牌文案（小程序 5 个页面/组件 + 云函数 `mip-identity-api` 一行文案 + 测试同步，17 文件）。无数据库迁移。

## A. 代码合并与推送

- [x] MIW-122 分支工作补提交（`cd0e362e`，含 event-detail-preview 展示推导模块 + 预览容器重构 + 25 例单测）
- [x] MIW-124 分支已有提交并回 main（`703ee6c2` + 分支文档 `615b229d`）
- [x] 双分支 `--no-ff` 合入 main 零冲突（`218e66c7`、`28a444d1`）
- [x] `pnpm verify:all` 全绿后 `git push origin main`（admin-web 33 文件 237 测试含 MIW-122 新增 11 例预览测试；根工程门禁含 MIW-124 同步更新的 7 个文案断言套件）
- [x] notma 任务 MIW-122、MIW-124 置 done

## B. 云函数（mip-identity-api，本批一行文案改动）

- [x] 分支会话已完成双环境部署（PROJECT_STATUS 2026-10-19（夜）条目：`mip-identity-api` 与 `mip-t-identity-api` 各自重部署 + CodeSha256 回读取证）
- [x] 本轮独立回读复核：`GetFunctionAddress` 下载两函数线上包，`domain/handler.js` 与 main 工作树字节一致（sha256 相等，双环境 handlerMatchesMain=true），新文案命中、旧文案（「微信一键获取」）0 命中——无需重部
- [x] 小程序侧文案断言：dist 内「手机号快捷登录」命中登录弹层 wxml；「微信手机号授权 / 微信一键获取 / 绑定微信手机号 / 使用当前微信账号登录」全部 0 命中

## C. 管理后台双套部署（本批 MIW-122 为 Web 前端变更，按滚动发布流程）

- [x] 发布快照：verify:all 全绿后 `admin-web/scripts/build-cloudbase.mjs`（新入口 `index-Bybu-22a.js`）
- [x] 上一版不可变资产保留：9 个上一版 assets 中 4 个新版缺失项（旧入口 `index-D0iAwe4G.js`、旧 CSS、旧 overview-purchase-chart、旧 ant-design chunk）经 `admin.mip.cool` 与 `test.admin.mip.cool` 双域名下载并 sha256 对清单核验后并入新 BFF 包 `public/assets/`；同路径字节冲突 0
- [x] 测试 BFF `mip-t-admin-web-api`：Active、客户端禁直调、0 timer（envs/test 口径：upstream=mip-t-admin-api、auth schema=mip_test_admin_auth、origin=test.admin.mip.cool、前缀=mip-admin-console-test）
- [x] 测试静态 `mip-admin-console-test/`：15 文件 VERIFIED；真实测试账号登录 HTTPS 检查 68/68；`test.admin.mip.cool` 线上资产字节 15/15 一致，入口 `/assets/index-Bybu-22a.js`
- [x] 生产 BFF `mip-admin-web-api`：Active、客户端禁直调、0 timer（`--confirm-production`）
- [x] 生产静态 `mip-admin-console/`：15 文件 VERIFIED；HTTPS 检查 68/68；`admin.mip.cool` 线上资产字节 15/15 一致，同入口哈希
- [x] 过程留痕：`.tmp/admin-release-20261019-miw122/`（双环境 verified 清单、target、资产核验报告、双域截图，本机留存）

## D. 小程序最新代码重编译（微信开发者工具）

- [x] main 最新代码 `pnpm build`（测试包：mip-t-identity-api 命中 1、mip-identity-api 0 命中；嵌套 tdesign vendor 树在；主包 1.10MB / member 1.02MB / admin 85.8KB，主包 < 2048KB 预算）
- [x] `pnpm runtime:preflight` 全绿（DevTools 已登录、服务端口 62842、路由契约完整）
- [x] DevTools 自动化重编译并真实装载（`pnpm test:runtime` 全量轮：构建→装载→逐页捕获，42 页 PASS，含本批改动面 `bind-phone`、`mip-card-edit` 均 ready）

## E. 本批变更端到端测试（部署后）

- [x] 管理后台 UI E2E（Playwright，部署后）：测试后台 5/5、生产后台 5/5（登录/活动列表/详情参与面/390 无溢出/无 console 错误）
- [x] 活动写路径 E2E：测试后台 12/12、生产后台 12/12（建标签、建活动、富文本持久化回读、编辑、列表检索、三项服务端校验边界、QA 对象清理归档）
- [x] MIW-122 预览探针（部署后真实浏览器，只读）：测试后台 14/14、生产后台 15/15——预览弹层渲染、类型角标（活动/MIP 早会）、真实活动标题、同日时间折叠「10月17日 12:00-16:00」与跨日「10月15日 10:00 至 10月16日 12:00」双口径、仅玩家权益角标、活动介绍/主办方/报名须知三区 Tab 切换、390px 无横向溢出、截图留档
- [x] MIW-124 文案：7 个单测套件随 verify:all 全绿 + dist 烘焙断言（见 B）+ DevTools 运行时 `bind-phone` 页 ready
- [x] 小程序运行时全量轮：42 PASS / 5 FAIL / 13 WAIT——5 项 FAIL 全部为既有基线或服务端数据态（managed-events「运营服务返回了无效的活动列表」、mip-access 既有身份门基线、mip-growth「成长等级尚未配置」、mip-card「暂无可用名片模板」、mip-ai/voice 既有基线），与两批改动面无交集；13 WAIT 均为依赖真实 fixture 的既有口径；console 仅 10 条 DevTools 框架级深拷贝警告（既有类型），0 error / 0 exception
- [x] 已知非阻塞项（记录不阻塞发布）：预览弹层富文本图片的 cloud:// 稳定引用在媒体地址异步解析窗口期会有一次裸 `cloud://` 绘制，浏览器记录 ERR_UNKNOWN_URL_SCHEME 控制台噪音；最终 DOM 已全部替换为可显示地址或诚实占位（探针断言 0 残留），后续可在媒体地址就绪前门控富文本渲染以消除噪音

## F. 体验版发布（正式 MP 平台 · 按 Runbook 锁定为测试环境包）

- [x] `pnpm release:trial -- --version 0.2.0.20261019.2 --desc "管理后台活动高保真预览（对齐小程序详情页展示口径）+ 登录链路文案去微信化合规修复"`
- [x] 内置门禁：verify:all 全绿 + 烘焙断言（trial 包仅含 mip-t-*）+ dist 平铺上传 → **体验版 0.2.0.20261019.2 上传成功**（主包 1.7MB / member 1.2MB / admin 134.5KB）
- [ ] MP 后台「体验版」指向确认 + 真机扫码走查（人工边界：真机项外部等待）
- [ ] MIW-124 审核复核项：mp.weixin.qq.com 重新提交代码审核，以真机原生授权弹窗核对「手机号快捷登录」文案（人工阶段）
- [ ] 说明：体验版按仓库红线指向测试后端（mip-t-*，支付已切正式商户）；正式环境发版走 `release:prod`（提审阶段人工执行）

## G. 真机边界（外部等待，非本机可验）

- [ ] 体验版真机：登录弹层/绑定手机号弹层/换绑弹层文案目检（手机号快捷登录、一键获取、手机号授权需在手机上完成）
- [ ] 体验版真机：真实微信支付一笔（live 扣款 + 到账 + 可退）
- [ ] 正式版提审后：审核复核以真机原生授权弹窗为准
