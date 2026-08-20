import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('event registration experience', () => {
  it('uses EventDetail as the single confirmation-page capability source', () => {
    const confirm = read('src/packages/member/registration-confirm/index.ts')

    expect(confirm).toContain('profileReady: event.phoneBound')
    expect(confirm).not.toContain('membershipModule.load()')
    expect(confirm).not.toContain('Promise.all')
  })

  it('keeps registration confirmation task-focused and defaults public profile sharing on', () => {
    const confirm = read('src/packages/member/registration-confirm/index.ts')
    const confirmView = read('src/packages/member/registration-confirm/index.wxml')

    expect(confirm).toContain('shareProfile: true')
    expect(confirm).toContain('cached.registrationSharesProfile : true')
    expect(confirmView).toContain('默认开启')
    expect(confirmView).toContain('fixed inset-x-0 bottom-0')
    expect(confirmView).not.toContain('event.coverUrl')
    expect(confirmView).not.toContain('event.location')
    expect(confirmView).not.toContain('startsText')
    expect(confirmView).not.toContain('event.notices')
  })

  it('uses a compact WeChat-avatar profile and an image-led branded home', () => {
    const home = read('src/pages/index/index.wxml')
    const member = read('src/packages/member/member-detail/index.wxml')

    expect(read('src/config/brand.ts')).toContain('/assets/brand/tongxinghui-logo.webp')
    expect(home).toContain('src="{{logoPath}}"')
    expect(fs.existsSync(path.join(root, 'src/assets/brand/tongxinghui-logo.webp'))).toBe(true)
    expect(home).toContain('nextEvent.coverUrl')
    expect(member).toContain('h-[176rpx] w-[176rpx]')
    expect(member).not.toContain('h-[520rpx]')
    expect(member).not.toContain('h-[420rpx] w-full')
  })

  it('gives both post-payment membership surfaces an explicit route back to home', () => {
    const membership = read('src/pages/membership/index.ts')
    const membershipView = read('src/pages/membership/index.wxml')
    const benefits = read('src/packages/member/benefits/index.ts')
    const benefitsView = read('src/packages/member/benefits/index.wxml')

    expect(membership).toContain('caseSwitchPrimary(\'/pages/index/index\')')
    expect(membershipView).toContain('bind:tap="backToHome"')
    expect(membershipView).toContain('返回首页')
    expect(benefits).toContain('caseSwitchPrimary(\'/pages/index/index\')')
    expect(benefitsView).toContain('bind:tap="backToHome"')
    expect(benefitsView).toContain('返回首页')
    expect(benefitsView).not.toContain('返回我的')
  })

  it('keeps implementation status out of consumer-facing event actions', () => {
    const events = read('src/pages/events/index.ts')
    const feed = read('src/modules/membership/event-feed.ts')
    const detail = read('src/packages/member/event-detail/index.ts')

    expect(feed).toContain('支付 ¥')
    expect(detail).toContain('支付 ¥')
    expect(`${events}\n${feed}`).not.toContain('活动支付暂未开放')
    expect(detail).not.toContain('活动支付暂未开放')
    expect(`${events}\n${feed}`).not.toContain('报名即将开放')
    expect(detail).not.toContain('报名即将开放')
  })

  it('keeps the event-detail first viewport compact and faithful to the approved editorial layout', () => {
    const detailView = read('src/packages/member/event-detail/index.wxml')

    expect(detailView).toContain('class="min-h-screen bg-panel')
    expect(detailView).toContain('class="mt-3 border-y border-line"')
    expect(detailView).toContain('min-h-[64rpx]')
    expect(detailView).toContain('{{event.registrationCount}} 人报名')
    expect(detailView).toContain('费用 {{priceText}}')
    expect(detailView).toContain('class="border-b border-line"')
    expect(detailView).toContain('分享活动')
    expect(detailView).not.toContain('wx:if="{{event.registrationState === \'PENDING_REVIEW\'}}"')
    expect(detailView).not.toContain('absolute bottom-4 right-4')
    expect(detailView).not.toContain('shadow-[0_8rpx_22rpx')
  })
})
