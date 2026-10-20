import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('event registration experience', () => {
  it('keeps the first event-detail frame dark while the subpackage is loading', () => {
    const detailConfig = JSON.parse(read('src/packages/member/mip-events/detail/index.json')) as Record<string, unknown>

    expect(detailConfig).toMatchObject({
      navigationBarBackgroundColor: '#080808',
      navigationBarTextStyle: 'white',
      backgroundColor: '#080808',
      backgroundColorContent: '#080808',
      backgroundColorTop: '#080808',
      backgroundColorBottom: '#080808',
      backgroundTextStyle: 'light',
    })
  })

  it('uses the MIP event detail as the registration-page fact source', () => {
    const events = read('src/pages/events/index.ts')
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')

    expect(events).toContain('/packages/member/mip-events/detail/index?eventId=')
    expect(detail).toContain('/packages/member/mip-events/registration/index?eventId=')
    expect(registration).toContain('mipEventsModule.getEvent(this.data.eventId)')
    expect(registration).toContain('event.registrationSchema.map(field => initialField(field, answers[field.key]))')
    expect(registration).not.toContain('membershipModule')
    expect(registration).not.toMatch(/amountCents\s*:/)
  })

  it('keeps registration task-focused without the removed share-profile switch', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    // MIW-91（DEF-02/DEF-05）：「公开给参与人」开关已整体下线——页面不再持有
    // shareProfile 状态、处理器、payload 与草稿字段；服务端写路径默认公开（opt-out）。
    expect(registration).not.toContain('shareProfile')
    expect(registrationView).not.toContain('shareProfile')
    expect(registrationView).toContain('wx:for="{{fields}}"')
    expect(registrationView).toContain('event.coverUrl')
    expect(registrationView).not.toContain('event.address')
    expect(registrationView).not.toContain('报名资料')
    // MIW-85：报名页「邀请来源」按客户口径下线（MIW-53 详情页同款删除）；服务端字段保留，仅展示移除。
    expect(registrationView).not.toContain('邀请来源')
    expect(registrationView).not.toContain('invitationAttribution')
  })

  it('shows registration failures in the current viewport and keeps the message near the form start', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('showErrorFeedback(error, \'报名提交失败，请稍后重试。\')')
    expect(registrationView).toContain('id="event-registration-feedback"')
    // 生产布局里反馈条位于活动信息卡之后、订单ID 行之前（fixture 像素块不含该 id）。
    expect(registrationView.indexOf('id="event-registration-feedback"'))
      .toBeLessThan(registrationView.indexOf('{{orderNumberText}}'))
  })

  it('prefills editable registrations by field key without selecting the first option', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('selectedIndex,')
    expect(registration).toContain('selectedLabel: selectedIndex >= 0')
    expect(registration).toContain(': -1')
    expect(registration).toContain('mipEventsModule.getMyRegistration(this.data.eventId)')
    expect(registration).toContain('fieldsFromAnswers(event, editing || resumingPayment ? registration?.answers : undefined)')
    expect(registrationView).toContain('{{editing ? \'修改报名信息\' : \'报名信息\'}}')
    expect(registration).toContain('payLabel: editing ? \'保存修改\' : needsPayment(event) ? \'立即支付\' : \'提交报名\'')
    expect(registrationView).toContain('{{item.selectedLabel}}')
    expect(registration).toContain('selectedIndex >= 0 ? field.options?.[selectedIndex] || \'请选择\' : \'请选择\'')
  })

  it('uses optimistic update recovery and keeps the edit entry off my registrations', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')

    expect(registration).toContain('mipEventsModule.updateRegistration')
    expect(registration).toContain('expectedVersion: registration.version')
    expect(registration).toContain('idempotencyKey: this.submissionIdempotencyKey')
    expect(registration).toContain('recoverUpdateConflict(answers)')
    expect(registration).toContain('{ ...(registration?.answers || {}), ...draftAnswers }')
    expect(registration).toContain('当前填写内容已保留，请确认后重新保存')
    // figma 3591_36185 我的活动：卡片上没有修改报名入口，编辑只从活动详情页进入。
    expect(mine).not.toContain('editRegistration')
    expect(mineView).not.toContain('data-action="edit"')
    expect(mineView).not.toContain('修改报名')
  })

  it('uses server-filtered activity tabs, server counts, and server-authorized cancellation', () => {
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')

    expect(mine).toContain('listMyRegistrations(undefined, category)')
    expect(mine).toContain('history: result.counts.history || 0')
    expect(mine).toContain('mipEventsModule.cancelRegistration')
    expect(mine).toContain('!Number.isInteger(version) || version < 1')
    expect(mine).toContain('await this.loadRegistrations()')
    expect(mineView).toContain('data-version="{{item.version}}"')
    expect(mineView).toContain('待参加({{counts.upcoming}})')
    expect(mineView).toContain('已参加({{counts.attended}})')
    expect(mineView).not.toContain('历史(')
    expect(mineView).toContain('event="{{item.card}}"')
    expect(mineView).toContain('wx:if="{{item.canCancel || item.canRetryRefund}}"')
    expect(mineView).toContain('data-refund-retry="{{item.canRetryRefund}}"')
    expect(service).toContain('category === \'UPCOMING\'')
    expect(service).toContain('canCancel: canCancelRegistration')
    expect(service).toContain('canRetryRefund: canRetryRegistrationRefund')
    expect(service).toContain('registrationVersion: Number(row.registration_version)')
  })

  it('reuses the same cancellation orchestration for refund retry on both activity pages', () => {
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')

    expect(detail).toContain('currentEvent?.canRetryRefund === true')
    expect(detail).toContain('currentEvent.registrationVersion')
    expect(detail).toContain('error instanceof MipEventsError && error.code === \'CONFLICT\'')
    expect(detail).toContain('await this.loadEvent({ force: true })')
    expect(detailView).toContain('event.canRetryRefund')
    expect(detailView).toContain('继续处理退款')
    expect(mine).toContain('dataset.refundRetry === \'true\'')
    expect(mine).toContain('mipEventsModule.cancelRegistration')
    expect(mineView).toContain('data-refund-retry="{{item.canRetryRefund}}"')
    expect(mineView).toContain('{{item.canRetryRefund ? \'继续处理退款\' : \'取消报名\'}}')
  })

  it('keeps the design-styled cancel pill as the only registration action', () => {
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')

    // figma 3591_36185：黄色胶囊「取消报名」放卡片 footer 行（提示居左、按钮居右），
    // 不得绝对定位悬浮——悬浮会遮挡时间/地点文字（MIW-43）。整卡点击进详情，无其他按钮。
    expect(mineView).toContain('data-action="cancel"')
    expect(mineView).toContain('catch:tap="cancelRegistration"')
    expect(mineView).not.toContain('absolute bottom-[16rpx] right-[16rpx]')
    expect(mineView).toContain('items-center justify-end gap-3 border-t border-line px-3 py-2')
    expect(mineView).toContain('h-[56rpx] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-brand px-[24rpx]')
    expect(mineView).toContain('rounded-full bg-brand')
    expect(mineView).toContain('text-canvas')
    expect(mineView).toContain('{{item.canRetryRefund ? \'继续处理退款\' : \'取消报名\'}}')
    expect(mineView).not.toContain('data-action="edit"')
    expect(mineView).not.toContain('data-action="order"')
    expect(mineView).not.toContain('editRegistration')
    expect(mineView).not.toContain('openOrder')
    expect(read('src/components/mip-activity-card/index.ts')).not.toContain('handleCancel')
  })

  it('carries optimistic versions for cancellation and first or subsequent feedback saves', () => {
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const feedback = read('src/packages/member/mip-events/feedback/index.ts')
    const gateway = read('src/modules/mip-events/cloudbase-gateway.ts')
    const entry = read('cloudfunctions/mip-events-api/index.js')

    expect(detail).toContain('currentEvent.registrationVersion')
    expect(feedback).toContain('expectedVersion: this.data.feedback?.version || 0')
    expect(gateway).toContain('const { expectedVersion, ...feedback } = draft')
    expect(gateway).toMatch(/eventId,[\s\S]*expectedVersion,[\s\S]*draft: feedback/)
    expect(entry).toContain('expectedVersion: event.expectedVersion')
  })

  it('uses the configured MIP logo and image-led event cards on the events page', () => {
    const eventsView = read('src/pages/events/index.wxml')
    const eventsPage = read('src/pages/events/index.ts')
    const eventCard = read('src/components/mip-activity-card/index.wxml')

    expect(read('src/config/brand.ts')).toContain('/assets/brand/mip-logo-yellow.png')
    expect(fs.existsSync(path.join(root, 'src/assets/brand/mip-logo-yellow.png'))).toBe(true)
    expect(eventsView).toContain('<mip-activity-card')
    expect(eventCard).toContain('src="{{displayCoverUrl}}"')
    expect(read('src/components/mip-activity-card/index.ts')).toContain('value?.coverUrl')
    expect(eventCard).toContain('count-text="{{event.countText || \'\'}}"')
    expect(eventsPage).toContain('feed.items.map(presentEventCard)')
  })

  it('routes checkout to a server-confirmed result and keeps explicit exits', () => {
    // MIW-65：会员方案页/权益页下线，结账发起收敛到玩家等级页，结果页回读语义不变。
    const growth = read('src/packages/member/mip-growth/index.ts')
    const paymentResult = read('src/packages/member/payment-result/index.ts')
    const paymentResultView = read('src/packages/member/payment-result/index.wxml')

    expect(growth).toContain('/packages/member/payment-result/index?orderId=')
    expect(paymentResult).toContain('mipCommerceModule.reconcile(order.id)')
    expect(paymentResult).toContain('classification === \'success\'')
    expect(paymentResultView).toContain('订单状态')
    expect(paymentResultView).toContain('<app-page-exit always label="完成" tab-url="/pages/profile/index" />')
  })

  it('links paid registration states to their exact order when the server provides an order id', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')
    const detail = read('src/packages/member/mip-events/detail/index.ts')

    expect(registration).toContain('orderId: result.orderId')
    expect(registration).toContain('/packages/member/order-detail/index?orderId=')
    expect(registrationView).toContain('wx:if="{{orderId}}"')
    expect(registrationView).toContain('bind:tap="openOrder">查看订单详情')

    expect(mineView).not.toContain('data-order-id')
    expect(mine).not.toContain('/packages/member/order-detail/index?orderId=')

    // MIW-53：详情页底部不再提供「查看待支付订单」主按钮，待支付订单从报名/订单链路进入。
    expect(detail).not.toContain('查看待支付订单')
    expect(detail).not.toContain('listMyRegistrations')
  })

  it('presents event payment results without describing membership entitlement changes', () => {
    const paymentResult = read('src/packages/member/payment-result/index.ts')
    const paymentResultView = read('src/packages/member/payment-result/index.wxml')
    const orderDetail = read('src/packages/member/order-detail/index.ts')
    const orderDetailView = read('src/packages/member/order-detail/index.wxml')
    const orderRepository = read('cloudfunctions/mip-commerce-api/domain/repository.js')
    const eventService = read('cloudfunctions/mip-events-api/domain/event-service.js')

    expect(paymentResult).toContain('const isEventOrder = order.orderType === \'EVENT\'')
    expect(paymentResult).toContain('mipEventsModule.getMyRegistration')
    expect(paymentResult).toContain('[\'REGISTERED\', \'ATTENDED\'].includes(registration.status)')
    expect(paymentResult).toContain('活动报名资格已生效。')
    expect(paymentResult).toContain('报名暂未完成。')
    expect(paymentResult).toContain('报名未成功。')
    expect(paymentResult).toContain('已付款，正在确认报名。')
    expect(paymentResult).toContain('&resumeCheckIn=1')
    expect(paymentResult).not.toMatch(/check-in\/index\?[^`]*token=/)
    expect(paymentResultView).toContain('wx:if="{{!isEventOrder && !isContentOrder && membershipEndsText}}"')
    expect(paymentResultView).toContain('bind:tap="openEvent">返回活动')
    expect(paymentResultView).toContain('bind:tap="openMyEvents">查看我的活动')
    expect(paymentResultView).toContain('wx:if="{{!isEventOrder && !isContentOrder && result === \'success\'}}"')
    // MIW-44：知识内容页面下线，内容订单不再提供「返回内容」入口。
    expect(paymentResultView).not.toContain('openContent')

    expect(orderDetail).toContain('order.orderType === \'CONTENT\' ? \'INTERACT\' : \'PURCHASE_MEMBERSHIP\'')
    expect(orderDetail).toContain('order.orderType === \'CONTENT\' ? \'内容支付尚未配置\' : \'会员支付尚未配置\'')
    expect(orderDetail).toContain('mipEventsModule.getMyRegistration(eventId as EventId)')
    expect(orderDetail).toContain('资格生效前不能签到')
    expect(orderDetail).toContain('&resumeCheckIn=1')
    expect(orderDetail).not.toMatch(/check-in\/index\?[^`]*token=/)
    expect(orderDetailView).toContain('{{paymentEnabled ? \'继续支付\' : paymentUnavailableText}}')
    expect(orderDetailView).toContain('wx:if="{{isEventOrder}}"')
    expect(orderDetailView).toContain('wx:if="{{!order.event}}"')
    expect(orderDetailView).toContain('wx:if="{{!priceItems.length}}"')
    expect(orderDetailView).toContain('总计')
    expect(orderDetailView).toContain('bind:tap="retryEventRegistration">重新核对报名')
    expect(orderDetailView).toContain('bind:tap="continueCheckIn">继续签到')
    expect(orderRepository).toContain('event_cover.cloud_file_id AS event_cover_file_id')
    expect(orderRepository).toContain('items.reduce((sum, item) => sum + item.amountCents, 0) === totalAmountCents')
    expect(eventService).toContain('priceItems: [{ label: \'活动报名\', amountCents: Number(event.price_cents) }]')
  })

  it('resumes check-in after registration without placing the scene token in a route', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('mipCheckInResumeStore.peek(String(this.data.eventId))')
    expect(registration).toContain('registrationReadyForCheckIn')
    expect(registration).toContain('[\'REGISTERED\', \'ATTENDED\'].includes(registration.status)')
    expect(registration).toContain('&resumeCheckIn=1')
    expect(registration).not.toMatch(/check-in\/index\?[^`]*token=/)
    expect(registrationView).toContain('重新核对报名')
    expect(registrationView).toContain('继续签到')
  })

  it('keeps implementation status out of consumer-facing event actions', () => {
    const events = read('src/pages/events/index.ts')
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')

    expect(detail).toContain('{ key: \'register\', label: \'立刻报名\' }')
    expect(registration).toContain('result.kind === \'PAYMENT_REQUIRED\'')
    expect(registration).toContain('result.kind === \'PAYMENT_REQUIRED\'')
    expect(events).not.toContain('活动支付暂未开放')
    expect(detail).not.toContain('活动支付暂未开放')
    expect(registration).not.toContain('活动支付暂未开放')
    expect(`${events}\n${detail}\n${registration}`).not.toContain('报名即将开放')
  })

  it('keeps the MIP event detail compact with status, exit, and primary actions', () => {
    const detailLogic = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    const primaryActionButton = detailView.match(/<button[^>]*id="mip-event-primary-action"[^>]*>/)?.[0] || ''

    expect(detailLogic).toContain('{ key: \'register\', label: \'立刻报名\' }')
    // Yellow primary action remains registration-only; owner confirmed 2026-10-20
    // that server-authorized cancellation/refund continuation is a fixed secondary action.
    expect(detailLogic).not.toContain('key: \'disabled\'')
    expect(detailLogic).toContain('if (this.data.busy || this.data.primaryAction !== \'register\')')
    expect(detailLogic).toContain('imageUrl: this.data.event?.coverUrl || brand.logoPath')
    expect(detailView).toContain('id="mip-event-detail-page"')
    expect(detailView).toContain('wx:if="{{event.coverUrl}}"')
    // figma 1861_17860: participant card header reads 参与人数45/50.
    expect(detailView).toContain('参与人数{{event.registrationCount}}')
    expect(detailView).toContain('/{{event.capacity}}')
    expect(detailView).toContain('活动介绍')
    expect(detailView).toContain('报名须知')
    expect(detailView).toContain('open-type="share"')
    // MIW-53：邀请来源 / 活动签到 / 活动变更模块按客户口径整体删除。
    expect(detailView).not.toContain('邀请来源')
    expect(detailView).not.toContain('活动签到')
    expect(detailView).not.toContain('活动变更')
    expect(detailLogic).not.toContain('event.changes')
    expect(primaryActionButton).toContain('wx:if="{{primaryAction}}"')
    expect(primaryActionButton).toContain('aria-disabled="{{busy}}"')
    expect(primaryActionButton).not.toMatch(/\sdisabled=/)
    // 未报名态：客服/转发收窄为 120rpx 胶囊、主按钮占满剩余宽度；
    // 无报名/取消/继续退款动作时：客服/转发平分宽度（figma 1818_17142）。
    expect(detailView).toContain('{{primaryAction || event.canCancel || event.canRetryRefund ? \'w-[120rpx] shrink-0\' : \'min-w-0 flex-1\'}}')
    expect(detailView).toContain('pb-[calc(env(safe-area-inset-bottom)+160rpx)]')
    expect(detailView).toContain('id="mip-event-bottom-actions"')
    expect(detailView).toContain('mip-member-fixed-inset fixed bottom-[env(safe-area-inset-bottom)]')
    expect(detailView).toContain('aria-label="联系客服"')
    expect(detailView).toContain('id="mip-event-support-surface"')
    expect(detailView).toContain('id="mip-event-primary-action"')
    expect(detailView).toContain('/assets/figma/events/customer-service.svg')
    expect(detailView).toContain('/assets/figma/events/share-circle.svg')
    expect(detailView).toContain('id="mip-event-primary-surface"')
    expect(detailView).not.toContain('<text>客服</text>')
    expect(detailView).toContain('<app-page-exit')
    expect(detailView).not.toContain('shadow-[0_8rpx_22rpx')
  })

  it('renders the organizer tab as the admin-configured introduction rich text (C1)', () => {
    // 小程序需求 C1 / TC-C-01：「主办方」Tab 展示后台配置的主办方介绍富文本（图文），
    // 与活动介绍同一解析通道；旧的主办方资料卡不再出现。
    const detailLogic = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')

    expect(detailView).toContain('contentSection === \'ORGANIZER\'')
    expect(detailView).toContain('nodes="{{organizerIntroductionNodes}}"')
    expect(detailView).toContain('暂无主办方介绍')
    // MIW-79：原始 markdown（可能含 cloud:// 插图引用）先解构出局部变量再建节点，不进页面数据。
    expect(detailLogic).toContain('organizerIntroduction: richOrganizerIntroduction')
    expect(detailLogic).toContain('eventRichTextNodes(richOrganizerIntroduction || \'\')')
    expect(detailView).not.toContain('openOrganizer')
    expect(detailView).not.toContain('主办方资料暂未公开')
    expect(detailView).not.toContain('event.organizer')
    // organizerIntroduction 合法存在，负断言只锁定资料卡读取（event.organizer 后不再跟字段名）。
    expect(detailLogic).not.toMatch(/event\.organizer(?![A-Za-z])/)
  })

  it('matches the Figma event-share sheet structure and actions', () => {
    const detailLogic = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')

    expect(detailView).toContain('id="mip-event-share-sheet"')
    expect(detailView).toContain('h-[836rpx]')
    expect(detailView).toContain('bg-[#080808]')
    expect(detailView).toContain('id="mip-event-share-actions"')
    expect(detailView).toContain('h-[496rpx]')
    expect(detailView).toContain('id="mip-event-share-copy"')
    expect(detailView).toContain('h-[292rpx]')
    expect(detailView).toContain('id="mip-event-wechat-share"')
    expect(detailView).toContain('id="mip-event-copy-link"')
    expect(detailView).toContain('id="mip-event-download-code"')
    expect(detailView).toContain('id="mip-event-copy-text"')
    expect(detailView).toContain('/assets/figma/events/wechat.svg')
    expect(detailView).toContain('/assets/figma/events/link.svg')
    expect(detailView).toContain('/assets/figma/events/qr-code.svg')
    expect(detailView).toContain('/assets/figma/events/copy.svg')
    expect(detailView).toContain('MIP 小程序活动详情')
    expect(detailView).toContain('时间：{{shareTimeText}}')
    expect(detailView).not.toContain('发送给微信好友')
    expect(detailView).not.toContain('生成邀请海报')
    expect(detailLogic).toContain('copyEventLink()')
    expect(detailLogic).toContain('downloadInvitationCode()')
    expect(detailLogic).toContain('shareTimeText: compactEventTime(event.startsAt, event.endsAt)')
    expect(detailLogic).toContain('wx.showToast({ title: \'二维码已保存\', icon: \'success\' })')
  })

  it('gates guest share/participants/signup behind the phone-auth login sheet (journey-review J1-01/J1-02)', () => {
    const detailConfig = JSON.parse(read('src/packages/member/mip-events/detail/index.json')) as Record<string, unknown>
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    const sheetView = read('src/components/mip-login-sheet/index.wxml')
    const sheetLogic = read('src/components/mip-login-sheet/index.ts')

    expect(detailConfig.usingComponents).toHaveProperty('mip-login-sheet')
    expect(detailView).toContain('visible="{{loginSheetOpen}}"')
    // MIW-121：open-type 随协议勾选门控置空，未勾选不拉起原生授权。
    expect(sheetView).toContain('open-type="{{agreed ? \'getPhoneNumber\' : \'\'}}"')
    expect(sheetView).toContain('我已阅读并同意')
    expect(sheetView).toContain('授权手机号')
    expect(sheetView).toContain('将获取你的手机号，用于确认身份')
    expect(sheetView).toContain('手机号快捷登录')
    expect(sheetView).toContain('暂不授权，返回原页面')
    expect(sheetLogic).toContain('assertConsented()')
    expect(sheetLogic).toContain('triggerEvent(\'phone\', event.detail)')
    expect(sheetLogic).toContain('triggerEvent(\'dismiss\')')

    // 三个游客触发点统一走通用 guest-login-flow，页面只保留意图来源与就地执行。
    expect(detail).toContain('async requireAuthIntent(intent: AuthIntent): Promise<boolean>')
    expect(detail).toContain('intent === \'register\' ? \'REGISTER_EVENT\' : \'INTERACT\'')
    expect(detail).toContain('requireGuestLoginFlow().begin(')
    expect(detail).toContain('requireGuestLoginFlow().phone(event)')
    expect(detail).toContain('requireGuestLoginFlow().signIn()')
    // 新账号走「填写信息」（mip-profile），完成或关闭都回本页并恢复原意图。
    expect(detail).toContain('this.resumeAuthIntent()')
  })

  it('presents signup as the order-confirm page from journey-review J2-08 (figma 1821_19274)', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registrationView).toContain('订单ID')
    expect(registrationView).toContain('{{orderNumberText}}')
    expect(registrationView).toContain('bind:tap="copyOrderId"')
    expect(registrationView).toContain('价格明细')
    expect(registrationView).toContain('活动门票')
    expect(registrationView).toContain('总计')
    expect(registrationView).toContain('购买须知')
    expect(registrationView).toContain('nodes="{{noticesNodes}}"')
    expect(registrationView).not.toContain('{{noticesText}}')
    expect(registrationView).toContain('id="event-registration-submit"')
    expect(registrationView).toContain('{{payLabel}}')
    // 终审 QO：订单确认页无补充填写项；仅当活动配置报名问题时才出现字段区。
    expect(registrationView).toContain('wx:if="{{fields.length > 0}}"')
    expect(registrationView).not.toContain('本场活动没有额外报名问题')
    expect(registration).toContain('orderNumberText: orderIdText || (needsPayment(event) ? \'提交后生成\' : \'无需支付\')')
    expect(registration).toContain('updateEventRichContent(this, \'noticesNodes\', event.notices || DEFAULT_PURCHASE_NOTICES)')
  })
})
