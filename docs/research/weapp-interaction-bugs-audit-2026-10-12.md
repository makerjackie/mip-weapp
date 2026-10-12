# 小程序交互类使用 Bug 全量排查报告

- 日期：2026-10-12
- 基线：main @ `3a922466`（worktree `.worktrees/audit-interaction-bugs`，分支 `audit/interaction-bugs`）
- 范围：`src/` 微信小程序侧全部页面（4 个主 Tab + member/admin 二级页共约 60 页）与 `src/components` 全部自定义组件，及被页面直接调用产生 UI 副作用的 `src/modules/*` 客户端代码。不含 admin-web。
- 口径：只收录**交互类使用 bug**——一次用户操作触发两次/两次弹窗/双开页面/重复提交/按钮失灵/加载卡死等，不改产品需求、不涉设计决策。
- 方法：6 组并行深读（每组 TS+WXML 成对验证）+ 横切机制自查（导航封装、身份守卫、弹窗协调器、tabBar、定时器、WXML 冒泡结构全量扫描）。关键发现均已由主会话二次读码复核。
- 置信度：**确认** = 代码机制完整闭环，按机制必然发生；**疑似** = 机制确认，但显性症状依赖时序/基础库行为。

## 结论速览

| ID | 级别 | 一句话 | 置信度 |
|---|---|---|---|
| BUG-01 | P0 | `mip-detail-row` 一次点按 handler 执行两次，设置页 10 行单击即双开目标页 | 确认 |
| BUG-02 | P1 | 全局导航无防重锁：约 40+ 个纯跳转入口快速双击 → 目标页叠两层 | 确认 |
| BUG-03 | P1 | `page-exit`「返回/完成」双击连退两级 | 确认 |
| BUG-04 | P1 | 授权门禁异步窗口无锁（活动详情/机会页/订单支付/分会），双击双跳转或双弹窗 | 确认 |
| BUG-05 | P1 | 任务列表「完成」无防重锁，双击重复提交 | 确认 |
| BUG-06 | P1 | 活动列表 `loadingMore` 可永久卡死，分页失效 | 确认 |
| BUG-07 | P2 | 语音页：双击「录完」残留错误文案；AI 处理中「删除重录」无效仍被强制跳转；切后台计时冻结 | 确认 |
| BUG-08 | P2 | 保存锁在 300ms 延迟返回窗口提前释放（mip-profile / mip-card-edit） | 确认 |
| BUG-09 | P2 | 订单退款确认弹窗可双弹 + 错误文案误导；海报保存无锁反馈矛盾 | 确认 |
| BUG-10 | P2 | 列表竞态类：公告触底+下拉重复项、我的活动 append 不去重、合作伙伴页 onShow 整页闪骨架 | 疑似 |
| BUG-11 | P2 | 已成功正文被失败刷新整页替换成错误态（mip-card / 任务详情，违反 AGENTS.md §11） | 疑似 |
| BUG-12 | P3 | 其它低危：首页公告双请求、inviteRef 双请求、名片下载静默吞点击、城市选择双击连退、选择器受控回环丢更新、growth 无 seq | 疑似 |

## 修复记录（2026-10-12，本分支）

全部 12 类 bug 已修复并通过 `pnpm verify` + `pnpm admin:web:verify`（typecheck / eslint / vitest 1664 用例 / 构建 / 服务器契约 / 文档链接全绿）。改动仅涉及 `src/`（小程序侧）与 `tests/`，未触碰 admin-web、packages/admin-contracts、cloudfunctions、database。

- **BUG-01**：`mip-detail-row`、`mip-form-field-row`、`mip-order-card` 根节点改 `catch:tap`（无包装用法，安全）；`mip-tag-chip`、`mip-attend-pill` 有 13+ 处包装用法依赖原生冒泡，改为自定义事件改名 `select`（`triggerEvent('tap')` → `triggerEvent('select')`），案例编辑器热门城市绑定同步改 `bind:select`。守卫测试：`tests/mip-tap-single-fire.test.ts`。
- **BUG-02**：`caseNavigateTo`/`caseRedirectTo` 增加"同 URL 600ms 去重窗，失败清窗立即可重试"，返回类型改为 `Promise<void>`；15 处 tap 触发的裸 `wx.navigateTo` 收口到 `caseNavigateTo`（badges/tasks/growth/card-edit/两个编辑器/access/admin×4）。测试：`tests/navigation.test.ts`。
- **BUG-03**：`leaveSecondaryPage` 增加 600ms 防重窗，`navigateBack` 失败清窗。
- **BUG-04**：四处动作锁——活动详情复用 `busy`（授权往返前置位，主按钮 loading 生效）；机会页 `openProtected` 照抄 profile 的 `openingActionLock`（access 转交期间保持锁到 onShow）；订单详情支付补 `accessing` 闩锁（对照 mip-growth），退款锁提前到 `requestRefund` 入口覆盖身份检查与弹窗全程；分会 `selectingId` 提前到 `selectBranch` 入口。
- **BUG-05**：任务列表 `completingId` 闩锁（首个 await 前置位，finally 复位）。
- **BUG-06**：活动列表非追加加载发起时同步复位 `loadingMore`（supersede 在途 append 的三条竞态序列均有测试锁定）。
- **BUG-07**：语音页——`finishingRecording` in-flight 锁 + 进入确认态清 message；processing 态删除入口拦截（不弹窗）+ `confirmRecording` 跳转前复核 state；onShow 录音存活时重启计时器。
- **BUG-08**：保存成功后保持 `saving=true` 直到 `navigateBack` 真正执行，仅失败路径复位；`clearNavigationTimer` 取消定时器时兜底放开锁。
- **BUG-09**：退款弹窗全程持锁（含 onShow 恢复直达入口，抽 `runRefundConfirmation` 共用）；海报保存 `posterSaving` 锁 + 按钮 loading/disabled。
- **BUG-10**：公告列表 `requestSeq` 代际 + `refreshing` 门 + Map 按 id 去重；我的活动 append 按 registrationId 去重；合作伙伴页 ready 态保内容后台刷新；growth `loadMembershipActions` 补 seq 守卫；城市选择 `pickedLabel` 一次性锁；catalog/industry 选择器 `emittedSelectedIds` 镜像修复受控回环丢更新（对外 API 不变）。
- **BUG-11**：mip-card / 任务详情刷新失败保留已成功正文（仅 message 提示，空内容才整页 error）；名片下载按钮 `disabled` 绑定 `drawingShare`，分享图渲染中点保存给 toast 反馈。
- **BUG-12**：首页公告等身份"落地"后按最终口径只发一次（`loadSnapshot` 并发去重复用同一飞行，无串行等待）；inviteRef 进入只发一次 `loadEvent`（失败路径兜底加载 + 挡住 onShow 抢跑窗口）。

新增回归测试：`tests/mip-tap-single-fire.test.ts`、`tests/mip-interaction-bugfix-bug04.test.ts`、`tests/mip-interaction-bugfix-bug05-06.test.ts`、`tests/mip-interaction-bugfix-bug10-12.test.ts`、`tests/mip-profile-save-lock.test.ts`，并扩充 `navigation.test.ts`、`navigation-leave.test.ts`、`mip-ai-voice-page.test.ts`、`mip-card-edit-save.test.ts`、`mip-growth-task-return.test.ts`、`mip-case-editor-visual.test.ts`。

仍需真机验证（模拟器/单测无法覆盖真实转场与系统行为）：双击设置页各行（BUG-01）、双击列表卡/返回按钮（BUG-02/03）、双击报名/发布机会/继续支付/申请退款/设为主分会（BUG-04）、真机录音三项（BUG-07）、双击保存（BUG-08）。

---

## P0：单击必现的双触发

### BUG-01 `mip-detail-row` 组件双触发——一次点按，页面 handler 执行两次

- 位置：
  - `src/components/mip-detail-row/index.wxml:4` 根节点 `bind:tap="handleTap"`（未用 catch）
  - `src/components/mip-detail-row/index.ts:15-17` `handleTap` 无条件 `triggerEvent('tap', { label })`
  - `src/components/mip-detail-row/index.ts:6` `virtualHost: false`
- 机制：自定义事件 `tap` 与原生冒泡 tap **同名**。一次物理点按：① `triggerEvent('tap')` 送达宿主在组件标签上的 `bind:tap`（第一次）；② 原生 tap 继续冒泡穿越组件边界，再次命中同一绑定（第二次）。仓库实证：`src/components/mip-pill-button/index.wxml:1-4` 的 F1 审计注释（2026-10-09）记载了同款 bug 并以 `catch:tap` 修复；TDesign `t-button` 构建产物内部同样是 `catch:tap` + `triggerEvent("tap")`。
- 受害面（用户可见）：`src/packages/member/privacy/index.wxml:15,16,25,26,27,36,37,44,45,46` 共 **10 行**在组件标签上直接 `bind:tap`，处理器（`src/packages/member/privacy/index.ts:68-101`）全部是裸 `caseNavigateTo`。**单击任意一行（绑定手机/隐私设置/用户协议/帮助与客服/关于 MIP 等）目标页即入栈两份，需按两次返回，无需双击。**
- 同根因潜伏组件（当前无受害绑定，建议随修统一改 `catch:tap`，一改即炸）：
  - `src/components/mip-tag-chip/index.wxml:5` —— 唯一现网绑定 `mip-cases/editor/index.wxml:66-76`（`bind:tap="applyHotCity"`）靠 `event.detail.label` 空值早退（`mip-cases/editor/index.ts:283-290`）侥幸无害，第二次触发是空转。
  - `src/components/mip-attend-pill/index.wxml:4`、`src/components/mip-form-field-row/index.wxml:5`、`src/components/mip-order-card/index.wxml:1` —— 页面监听都在父容器或未绑定 tap，单次触发。
- 修复方向：五个组件根节点 `bind:tap` → `catch:tap`（对齐 `mip-pill-button` 的 F1 修复）。可加合同测试：同一标签上 `bind:tap` 与组件内 `triggerEvent('tap')` 共存即报错。

---

## P1：双击/异步窗口导致的重复动作

### BUG-02 系统性：所有「纯跳转」tap 处理器无防重锁，双击即把目标页压栈两次

- 根因：`src/platform/navigation/client.ts:16-18` `caseNavigateTo` 只做路径规范化，无任何重入锁；微信 `navigateTo` 无内建去重；页面转场动画期间旧页仍可接收第二次 tap。全 `src/` 无任何 tap 节流/导航锁（grep throttle/debounce/navigating 无命中），仅两处页面自己做了锁（`mip-received/index.ts:633-663` `openingKey`、`mip-notifications/index.ts:185-215` `openingMessageId`），证明本库认可该风险且已有修法。
- 受影响入口（handler 文件:行号）：
  - 主 Tab：`pages/index/index.ts:207-224`（openBanner）、`226-228`、`238-244`、`246-251`、`253-265`；`pages/events/index.ts:435-451`、`457-463`；`pages/opportunities/index.ts:365-381`、`993-999`、`1001-1006`；`pages/profile/index.ts:782`、`840-861`
  - 活动系：`mip-events/detail/index.ts:791-800`（互动卡/胶囊）、`863-868`（反馈）、`940-949`、`951-960`（guide 会再压一层 web-view）；`participants/index.ts:499-504`；`mine/index.ts:191-195`（卡片组件 `mip-activity-card/index.ts:34-37` handleSelect 同样无节流）；`check-in/index.ts:231-243`、`259-261`、`263-268`；`registration/index.ts:662-673`、`675-677`、`679-686`、`588-594`
  - 会员核心：`mip-growth/index.ts:347-352`、`355-357`；`mip-badges/index.ts:209-214`；`mip-tasks/index.ts:141-146`；`mip-hearts/index.ts:249-254`；`mip-public-profile/index.ts:616-621`、`701-706`、`709-714`、`754-756`；`mip-card/index.ts:291-293`；`mip-card-edit/index.ts:71-73`；`mip-access/index.ts:228-234`
  - 内容系：`mip-cases/detail/index.ts:72-76`（edit）；`mip-cases/editor/index.ts:225-231`、`265-281`；`mip-cooperation/detail/index.ts:222-226`；`mip-cooperation/editor/index.ts:111-117`；`mip-opportunities/detail/index.ts:152-154`、`156-162`；`announcements/index.ts:88-95`；`announcement-detail/index.ts:48-59`
  - 交易系：`orders/index.ts:145-150`（整卡）；`payment-result/index.ts:280-305`；`order-detail/index.ts:417-427`
  - admin 工作台：`dashboard/index.ts:73-75`；`managed-events/index.ts:152-159`；`event-console/index.ts:146-153`；`event-registrations/index.ts:254-261`
- 症状：任一入口快速双击 → 详情/编辑页叠两层，按一次返回仍停在同款页面。对照：三个编辑器保存按钮均有 `saving` 闩锁 + loading，说明不是刻意为之。
- 修复方向（推荐一处收口）：在 `caseNavigateTo` 内加短时导航闩锁（同 URL 或全部导航 400-600ms 内去重），`fail` 时复位；或按 `openingKey` 模式给高频列表卡补锁。注意 BUG-04 的授权窗口场景单靠导航锁不够，仍需动作级锁。

### BUG-03 `page-exit`「返回/完成」双击连退两级

- 位置：`src/components/page-exit/index.ts:36-42`（onExit）→ `src/platform/navigation/leave.ts:5-15`（裸 `wx.navigateBack()`，无锁）。组件几乎用于全部二级页（约 60 处）；`always` 模式如 `privacy/index.wxml:8`、`payment-result/index.wxml:24`。
- 机制：`navigateBack` 转场（约 300ms）完成前页面不出栈，`getCurrentPages().length` 未减，第二次 tap 仍通过 `canNavigateBack()` → 再弹一层。栈深 ≥3 时一次双击跳过一层页面。
- 修复方向：`leaveSecondaryPage` 加 300-600ms 重入锁（与 BUG-02 同一处收口）。

### BUG-04 授权门禁异步窗口无锁：双击双跳转 / 双弹窗 / 矛盾反馈

同一模式（`begin()` / `beginProtectedAction()` 要等一次身份快照网络往返，期间无锁、按钮无 loading）的三个实例：

1. **活动详情主按钮**：`mip-events/detail/index.ts:753-762`（handlePrimary 只查 `busy`，但 `busy` 在 `requireAuthIntent`（807-828）await 期间不置位）、`774-785`（openParticipants）。已登录用户双击 → 两次 `begin()` 双双 resolve ready → 报名页/参与人页叠两层。游客路径安全（`authToken` 短路成 'sheet'，弹层幂等）。
2. **机会页 `openProtected`**：`pages/opportunities/index.ts:1009-1016` 无锁直接 `await begin()`；对照 `pages/profile/index.ts:712-715` 同名方法有 `openingActionLock`——机会页漏了同样的锁。已登录双击「发布机会」→ 编辑器双开；游客双击产生两个身份会话 token（第二个覆盖第一个）。
3. **订单详情「继续支付」**：`order-detail/index.ts:264-297`（requestPayment），`paying` 只在 `performPayment`（304）内置位，`beginProtectedAction` 往返期间（275）无锁。身份不完整时双击 → 授权页（`mipAccessPageUrl`）双开。对照：`mip-growth/index.ts:441` 对同一窗口有 `accessing` 锁 + `mip-growth/index.wxml:157-159` `loading="{{paying || accessing}}"`——order-detail 没抄到这把锁。身份已就绪时 `paying` 闩锁有效，不会重复拉起支付。
4. **分会页「设为主分会」**：`mip-branches/index.ts:55-79`（selectBranch 守卫只查 `selectingId`，但它到 `applyPrimaryBranch:83` 才置位）+ `:81-100`。异步窗口内双击 → 并发两次 `setPrimaryBranch` → 先弹「主分会已更新」toast，随后又出现「版本冲突」失败横幅。
- 修复方向：统一补「动作进行中」闩锁并在首个 await 前同步置位（照抄 `accessing`/`openingActionLock` 模式），按钮 loading 同步绑定。

### BUG-05 任务列表「完成」无防重锁：双击重复提交

- 位置：`src/packages/member/mip-tasks/index.ts:163-185`（completeTask）；触发点 `mip-tasks/index.wxml:59`（无 disabled/loading）。
- 机制（已复核）：仅校验 `task.status !== 'AVAILABLE'`，读的是旧 `this.data.tasks`；首次点击后直到 `await this.loadTasks(true)` 回包前 status 仍为 AVAILABLE，第二次点击再次通过并发起第二次 `mipTasksModule.mutation.completeTask`（`src/modules/mip-tasks/module.ts:91-95` 直接透传，无并发去重）。对照：detail 页 `submitTask` 有 `submitting` 锁（`mip-tasks/detail/index.ts:100-121`）。
- 症状：先「任务已完成」toast，随后红色「任务提交失败」错误条（服务端拒绝第二次）；服务端幂等宽松时可能重复奖励。
- 修复方向：加 `completingId` 锁（首个 await 前置位，finally 复位）。

### BUG-06 活动列表 `loadingMore` 永久卡死：分页失效

- 位置：`src/pages/events/index.ts:150-152`（loadingMore 是唯一闸门）、`:156`（append 置 true）、`:170-172` 与 `:176-177`（requestSeq 不匹配 `return` 不复位）、`:179-183`（非追加失败且有缓存只写 message）、`:193-199`（applyFeed 才复位）；按钮 `events/index.wxml:62`。
- 机制（已复核）：点「加载更多」（loadingMore=true, seq=N）→ 在途时切筛选/搜索/下拉（seq=N+1 非追加）→ 新请求失败且本地有缓存 → 只写 message；旧 append 回包因 seq 不匹配被丢弃且不复位 loadingMore。此后按钮永远显示「加载中」、点击被闸门吞掉，分页彻底失效。
- 修复方向：seq 失配路径与 catch 全路径统一复位 `loadingMore`（或改为在 finally 里按最新 seq 复位）。

---

## P2：可复现但触发条件更窄

### BUG-07 语音录制页（`src/packages/member/mip-ai/voice/`）三个确认问题

1. **双击「录完」：确认页残留错误文案「当前没有进行中的录音」+ 状态闪跳**
   - `index.ts:160-179`（finishRecording，已复核：`this.recording` 要等 `await recorder.stop()` 返回才置 false，第二次 tap 仍过守卫）+ 根因 `src/modules/mip-ai/voice-recorder.ts:225-229`（state≠recording 时 stop 同步 reject）。第二次 stop 立即 reject → catch 置 `state:'ready'` + 错误文案；随后第一次 stop 回包又切回 `state:'review'` 但 message 未清。按钮 `index.wxml:44` 无 disabled。
2. **「AI 整理中…」期间点「删除重录」：删除无效，仍被强制跳转编辑器**
   - `index.wxml:66-71`（仅 aria-disabled+opacity 降级，tap 仍可触发）；`index.ts:216-231`（删除不检查 `state==='processing'`）；`index.ts:233-254`（上传+建草稿 Promise 不可取消，完成后无条件 `wx.redirectTo` 编辑器）。用户明确点了删除却被拽去编辑器带着已「删除」的草稿；间隙内新录的内容也会被 onUnload 的 `recorder.cancel()` 静默丢弃。
3. **onHide 停止计时器后 onShow 不恢复**（疑似）：`index.ts:64-76`、`:126-137`。录音跨前后台存活时计时冻结；recorder 自愈后页面无感知，点「录完」报「当前没有进行中的录音」，整段录音在 UI 层丢失。
- 修复方向：录完/删除入口按 state 拦截（processing 中禁用）；redirectTo 前复核 state；onShow 恢复计时器。

### BUG-08 保存锁在 300ms 延迟返回窗口提前释放（mip-profile / mip-card-edit）

- 位置：`mip-profile/index.ts:246-264`（成功后 300ms 定时 navigateBack）+ `:269-271`（finally 立即 `saving:false`）；`mip-card-edit/index.ts:307-312` + `:317` 同款。
- 机制（已确认）：finally 先于定时器执行，页面可见且按钮 loading 已解除，再点「保存」通过校验发起第二次真实保存（`expectedVersion` 已更新故也会成功）。
- 症状：连点保存多次写请求、toast 闪两次；无数据损坏（乐观锁）。
- 修复方向：延迟返回窗口内保持 saving=true（在 navigateBack 后再复位），或锁改为「成功即单向」。

### BUG-09 弹窗/保存类双触发与矛盾反馈

1. **订单详情「申请退款」确认弹窗可双弹**：`order-detail/index.ts:352-393`（requestRefund 在 `beginProtectedAction` 往返期间无锁，`submittingRefund` 弹窗确认后才置位）+ `:380-415`。双击 → 两个 `wx.showModal`；第二个 fail 被 catch 吞掉后显示与事实不符的「身份状态暂时无法确认」。退款本身有 `refundKey` 幂等，不会重复提交。
2. **admin 签到海报「保存到相册」无锁**：`event-console/index.ts:284-295`（guard 只查 posterPath/posterBusy/posterExpired，保存全程无 busy）+ `event-console/index.wxml:40`。双击 → 并发两次 `wx.saveImageToPhotosAlbum`，先「已保存到相册」toast 又出红色「保存失败，请检查相册权限」，反馈矛盾。

### BUG-10 列表竞态类（疑似，机制确认）

1. **公告列表触底 + 下拉刷新交错 → 重复项**：`announcements/index.ts:56-82`（loadMore 仅 `loadingMore` 自锁，返回后直接拼接）与 `:97-104`（onPullDownRefresh 不检查 loadingMore，整表重置）。loadMore 用旧 cursor 在途时下拉刷新重置列表，旧结果追加到新首页尾部，`wx:key="id"` 重复。
2. **「我的活动」append 不去重**：`mip-events/mine/index.ts:174` 直接拼接；对照 `participants/index.ts:198` 显式按 id 去重。游标窗口重叠时同一 registrationId 出现两份，`wx:key` 撞 key 渲染错乱。
3. **合作伙伴名单页每次 onShow 强制整页骨架屏**：`mip-opportunity-cooperators/index.ts:51`（onShow → load）+ `:62`（无条件 `state:'loading'`）。从公开档案返回时整屏闪骨架、滚动位置重置；对照 orders（`:88` ready 保内容）和 order-detail（`:109-111`）的保内容模式。
4. **mip-growth `loadMembershipActions` 无序列守卫**：`mip-growth/index.ts:200-269`（对比 loadGrowth/loadTasks 均有 seq），onShow 与下拉刷新可并发双跑，极端时序文案回跳 + 并发 `createMembershipInvitation`。
5. **城市选择页双击 chip 连退两级**：`mip-cases/city-selector/index.ts:105-114`（onPickCity 无锁，emit 后立即 navigateBack），第二次 back 可能把编辑页一起弹掉。
6. **选择器受控回环丢更新**：`catalog-selector/index.ts:63-77`、`mip-industry-selector/index.ts:48-57`——toggle 基于异步回写的 props 计算，快速连点两个 chip 时第一次选择被旧集合覆盖丢失（机会筛选行业多选 `opportunities/index.wxml:112,246`）。

### BUG-11 已成功正文被失败刷新整页替换（疑似，违反 AGENTS.md §11）

1. **mip-card**：`mip-card/index.ts:252-257` catch 无条件 `state:'error'`；onShow（203-205）每次重载，从编辑页返回时身份服务抖动 → 已展示的名片整页消失变错误态。对照 mip-hearts/mip-received/mip-badges 的「保留上次结果」模式。
2. **任务详情**：`mip-tasks/detail/index.ts:77-79` catch 无条件 error；`submitTask` 成功 toast 后 `loadTask` 失败 → 整页变「暂时无法加载任务」，用户误判提交失败而重复操作。
3. **名片「下载名片」静默吞点击**：`mip-card/index.ts:344-347`（`drawingShare` 时 `createPoster` 返回空串）+ `:553-568`（savePoster 空串无提示）+ `index.wxml:69-75`（disabled 不绑 drawingShare）。进页/切样式约 1 秒内点下载无任何响应。

### BUG-12 其它低危重复请求（确认机制、用户影响低）

1. **首页首进公告接口双请求**：`pages/index/index.ts:53-60`（loadDiscover 并发跑 identity + 全城公告）+ `:92-104`（applyIdentity 拿到分会 id 后再拉一次分会公告）。设主分会用户冷启动请求两次，公告卡可能先闪全城再跳分会。
2. **活动详情 inviteRef 双请求**：`mip-events/detail/index.ts:266-269`（onLoad 无条件 loadEvent）+ `:358-377`（loadInvitationScene 内部又 `loadEvent({force:true})`）。首帧一致，仅浪费一次请求与云存储临时链接批取。

---

## 已排查、确认无问题的机制（修复时不必重查）

- **身份/弹窗横切**：`ensureProtectedPageAccess`（checkingAccess 并发锁）、全局运营弹窗协调器（presentingGeneration + sessionSnoozed）、游客登录弹层（busy + loginSheetOpen）、`consumePendingResume` 一次性消费——均无双弹/双恢复。
- **提交防重完备的页面**：活动报名 submit（busy+幂等键）、签到 confirmCheckIn、反馈 submitFeedback、心动 saveHeartTarget/toggleHeartVote、取消报名（busy/cancelingId 在 showModal 前置位）、三个编辑器保存（saving+loading）、mip-growth 购买（paying+accessing+幂等键）、bind-phone 三入口、mip-visibility-settings、徽章装备、屏蔽列表 unblock、公开档案长按删除、admin 签到/撤销（processingId+confirmationBusy）。
- **支付路径**：`wx.requestPayment` 全仓库仅 `src/modules/mip-commerce/client.ts:27` 一处封装；payment-result 轮询有 seq+单例 timer+onHide 挂起，无重复拉起；从授权页返回不会二次自动支付。
- **分页触底守卫**：opportunities/mip-tasks/mip-notifications/mip-experience-details/mip-profile-interests/mip-hearts/mip-received/announcements（单发）均有锁；活动列表 append 合并按 id 去重；服务端为 keyset 游标。
- **定时器清理**：payment-result、event-console 倒计时、mip-profile/mip-card-edit navigationTimer、mip-received searchTimer、bind-phone 倒计时均在 onHide/onUnload 清理；无 setInterval 叠加。
- **WXML 冒泡结构**：全仓库扫描无「父子节点都绑 bind:tap」结构，内部可点元素一律 catch:tap（参与者心形票、互动胶囊、取消按钮、tabBar 分享按钮等）。
- **无 `wx.showLoading` 使用**（各页自管 loading 态），无 loading 卡死路径（各 finally 复位，除 BUG-06 外）。
- 备注：`src/packages/member/mip-events/interaction/` 页面已无入口引用（详情/签到均跳 participants），属不可达死页面，其逻辑不在用户可感知路径。

## 修复与验证建议

1. **顺序**：BUG-01（组件 catch:tap，一次改 5 个组件）→ BUG-02/03（`caseNavigateTo`/`leaveSecondaryPage` 一处收口加导航闩锁，全局生效）→ BUG-04/05（动作级锁，照抄 `accessing`/`openingActionLock` 模式）→ BUG-06/07/08/09 → 竞态与状态类（BUG-10/11/12）。
2. 改动均在 `src/` 小程序侧，不触契约/云函数/数据库；无需双端联动。
3. 验证：`pnpm verify`（含 UI 合同测试）+ `pnpm runtime:preflight`；BUG-01/02/03/04 属真机可复现交互，需真机抽查（双击设置页各行、双击列表卡、双击返回按钮、双击报名/发布机会/继续支付）。语音页（BUG-07）需真机录音验证。
