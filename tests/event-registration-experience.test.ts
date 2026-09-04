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
      navigationBarBackgroundColor: '#040404',
      navigationBarTextStyle: 'white',
      backgroundColor: '#040404',
      backgroundColorContent: '#040404',
      backgroundColorTop: '#040404',
      backgroundColorBottom: '#040404',
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

  it('keeps registration task-focused and makes public profile sharing explicit opt-in', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('shareProfile: false')
    expect(registration).toContain('shareProfile: this.data.shareProfile')
    expect(registrationView).toContain('仅影响本场活动的参与者列表')
    expect(registrationView).toContain('wx:for="{{fields}}"')
    expect(registrationView).toContain('event.coverUrl')
    expect(registrationView).not.toContain('event.address')
    expect(registrationView).not.toContain('event.notices')
  })

  it('shows registration failures in the current viewport and keeps the message near the form start', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('showErrorFeedback(error, \'报名提交失败，请稍后重试。\')')
    expect(registrationView).toContain('id="event-registration-feedback"')
    expect(registrationView.indexOf('id="event-registration-feedback"'))
      .toBeLessThan(registrationView.indexOf('报名资料'))
  })

  it('prefills editable registrations by field key without selecting the first option', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const registrationView = read('src/packages/member/mip-events/registration/index.wxml')

    expect(registration).toContain('selectedIndex,')
    expect(registration).toContain('selectedLabel: selectedIndex >= 0')
    expect(registration).toContain(': -1')
    expect(registration).toContain('mipEventsModule.getMyRegistration(this.data.eventId)')
    expect(registration).toContain('fieldsFromAnswers(event, editing ? registration?.answers : undefined)')
    expect(registration).toContain('shareProfile: editing ? registration?.shareProfile === true : false')
    expect(registrationView).toContain('{{editing ? \'修改报名\' : \'确认报名\'}}')
    expect(registrationView).toContain('{{editing ? \'保存修改\' : \'提交报名\'}}')
    expect(registrationView).toContain('{{item.selectedLabel}}')
    expect(registration).toContain('selectedIndex >= 0 ? field.options?.[selectedIndex] || \'请选择\' : \'请选择\'')
  })

  it('uses optimistic update recovery and a dedicated non-bubbling edit entry', () => {
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')

    expect(registration).toContain('mipEventsModule.updateRegistration')
    expect(registration).toContain('expectedVersion: registration.version')
    expect(registration).toContain('idempotencyKey: this.submissionIdempotencyKey')
    expect(registration).toContain('recoverUpdateConflict(answers, this.data.shareProfile)')
    expect(registration).toContain('{ ...registration.answers, ...draftAnswers }')
    expect(registration).toContain('当前填写内容已保留，请确认后重新保存')
    expect(mine).toContain('/packages/member/mip-events/registration/index?eventId=')
    expect(mineView).toContain('wx:if="{{item.canEdit}}"')
    expect(mineView).toContain('catch:tap="editRegistration"')
    expect(mineView).toContain('修改报名')
  })

  it('uses server-filtered activity tabs, server counts, and server-authorized cancellation', () => {
    const mine = read('src/packages/member/mip-events/mine/index.ts')
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')
    const service = read('cloudfunctions/mip-events-api/domain/event-service.js')

    expect(mine).toContain('listMyRegistrations(undefined, category)')
    expect(mine).toContain('result.counts || this.data.counts')
    expect(mine).toContain('mipEventsModule.cancelRegistration')
    expect(mine).toContain('!Number.isInteger(version) || version < 1')
    expect(mine).toContain('await this.loadRegistrations()')
    expect(mineView).toContain('data-version="{{item.version}}"')
    expect(mineView).toContain('待参加({{counts.upcoming}})')
    expect(mineView).toContain('已参加({{counts.attended}})')
    expect(mineView).toContain('event="{{item.card}}"')
    expect(mineView).toContain('data-role="registration-actions"')
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

  it('keeps registration actions in one footer with clear hierarchy', () => {
    const mineView = read('src/packages/member/mip-events/mine/index.wxml')
    const actionsStart = mineView.indexOf('data-role="registration-actions"')
    const actionsEnd = mineView.indexOf('</view>', mineView.indexOf('</view>', actionsStart) + 1)
    const actions = mineView.slice(actionsStart, actionsEnd)

    expect(actions).toContain('data-action="cancel"')
    expect(actions).toContain('theme="{{item.canRetryRefund ? \'primary\' : \'danger\'}}"')
    expect(actions).toContain('variant="outline"')
    expect(actions).toContain('size="large"')
    expect(actions).toContain('catch:tap="cancelRegistration"')
    expect(actions).toContain('data-action="edit"')
    expect(actions).toContain('theme="primary"')
    expect(actions).toContain('catch:tap="editRegistration"')
    expect(actions).toContain('class="min-w-0 flex-1"')
    expect(mineView).toContain('data-action="order"')
    expect(mineView).toContain('variant="text"')
    expect(mineView).not.toContain('show-cancel=')
    expect(read('src/components/event-card/index.ts')).not.toContain('handleCancel')
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

  it('uses the configured MIP logo and image-led event cards on the discover page', () => {
    const home = read('src/pages/index/index.wxml')
    const homePage = read('src/pages/index/index.ts')

    expect(read('src/config/brand.ts')).toContain('/assets/brand/mip-logo-yellow.png')
    expect(home).toContain('src="{{logoPath}}"')
    expect(fs.existsSync(path.join(root, 'src/assets/brand/mip-logo-yellow.png'))).toBe(true)
    expect(home).toContain('item.coverUrl')
    expect(home).toContain('{{item.registrationCount}} 人参加')
    expect(homePage).toContain('mipEventsModule.listEvents')
    expect(homePage).toContain('items.slice(0, 3).map(presentEvent)')
  })

  it('routes checkout to a server-confirmed result and keeps explicit exits', () => {
    const membership = read('src/pages/membership/index.ts')
    const membershipView = read('src/pages/membership/index.wxml')
    const paymentResult = read('src/packages/member/payment-result/index.ts')
    const paymentResultView = read('src/packages/member/payment-result/index.wxml')
    const benefits = read('src/packages/member/benefits/index.ts')
    const benefitsView = read('src/packages/member/benefits/index.wxml')

    expect(membership).toContain('/packages/member/payment-result/index?orderId=')
    expect(membershipView).toContain('<app-page-exit label="返回" />')
    expect(paymentResult).toContain('mipCommerceModule.reconcile(order.id)')
    expect(paymentResult).toContain('classification === \'success\'')
    expect(paymentResultView).toContain('服务端状态')
    expect(paymentResultView).toContain('<app-page-exit always label="完成" tab-url="/pages/profile/index" />')
    expect(benefits).toContain('caseNavigateTo({ url: \'/pages/membership/index\' })')
    expect(benefitsView).toContain('<app-page-exit label="返回" />')
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

    expect(mineView).toContain('wx:if="{{item.orderId}}"')
    expect(mineView).toContain('data-order-id="{{item.orderId}}"')
    expect(mineView).toContain('catch:tap="openOrder">查看订单详情')
    expect(mine).toContain('/packages/member/order-detail/index?orderId=')

    expect(detail).toContain('return { key: \'order\', label: \'查看待支付订单\' }')
    expect(detail).toContain('mipEventsModule.listMyRegistrations(cursor)')
    expect(detail).toContain('orderId = registration.orderId || \'\'')
    expect(detail).toContain('/packages/member/order-detail/index?orderId=')
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
    expect(paymentResult).toContain('活动报名尚未生效。')
    expect(paymentResult).toContain('活动报名未生效。')
    expect(paymentResult).toContain('资格生效前不能签到')
    expect(paymentResult).toContain('&resumeCheckIn=1')
    expect(paymentResult).not.toMatch(/check-in\/index\?[^`]*token=/)
    expect(paymentResultView).toContain('wx:if="{{!isEventOrder && !isContentOrder && membershipEndsText}}"')
    expect(paymentResultView).toContain('bind:tap="openEvent">返回活动')
    expect(paymentResultView).toContain('bind:tap="openMyEvents">查看我的活动')
    expect(paymentResultView).toContain('wx:if="{{!isEventOrder && !isContentOrder && result === \'success\'}}"')
    expect(paymentResultView).toContain('bind:tap="openContent">返回内容')

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

    expect(detail).toContain('event.accessType === \'PAID\' ? \'提交付费报名\'')
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

    expect(detailLogic).toContain('event.accessType === \'PAID\' ? \'提交付费报名\' : \'立即报名\'')
    expect(detailLogic).toContain('return { key: \'disabled\', label: \'活动已结束\' }')
    expect(detailLogic).toContain('if (this.data.busy || this.data.primaryAction === \'disabled\')')
    expect(detailLogic).toContain('imageUrl: this.data.event?.coverUrl || brand.logoPath')
    expect(detailView).toContain('id="mip-event-detail-page"')
    expect(detailView).toContain('wx:if="{{event.coverUrl}}"')
    expect(detailView).toContain('{{event.registrationCount}} 人参加')
    expect(detailView).toContain('活动介绍')
    expect(detailView).toContain('报名须知')
    expect(detailView).toContain('open-type="share"')
    expect(primaryActionButton).toContain('aria-disabled="{{primaryAction === \'disabled\' || busy}}"')
    expect(primaryActionButton).not.toMatch(/\sdisabled=/)
    expect(detailView).toContain('pb-[calc(env(safe-area-inset-bottom)+160rpx)]')
    expect(detailView).toContain('id="mip-event-calendar-action"')
    expect(detailView).toContain('id="mip-event-bottom-actions"')
    expect(detailView).toContain('mip-member-fixed-inset fixed bottom-[env(safe-area-inset-bottom)]')
    expect(detailView).toContain('aria-label="联系客服"')
    expect(detailView).toContain('h-[88rpx] w-[120rpx]')
    expect(detailView).toContain('id="mip-event-support-surface"')
    expect(detailView).toContain('id="mip-event-primary-action"')
    expect(detailView).toContain('/assets/figma/events/customer-service.svg')
    expect(detailView).toContain('/assets/figma/events/share-circle.svg')
    expect(detailView).toContain('id="mip-event-primary-surface"')
    expect(detailView).not.toContain('<text>客服</text>')
    expect(detailView).toContain('<app-page-exit')
    expect(detailView).not.toContain('shadow-[0_8rpx_22rpx')
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
})
