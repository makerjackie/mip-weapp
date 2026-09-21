import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP growth player actions', () => {
  it('reuses the membership invitation and routes renewal to the membership order page', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    expect(script).toContain('mipCommerceModule.getMembershipBenefits()')
    expect(script).toContain('mipCommerceModule.createMembershipInvitation()')
    expect(script).toContain('membership.membershipEndsAt')
    expect(script).toContain('mipTasksModule.query.listTasks(undefined, 4, force)')
    // journey-review J1-07/J4-03：开通与续费走同一会员订单确认页。
    expect(script).toContain('const MEMBERSHIP_ORDER_PAGE = \'/packages/member/membership-order/index\'')
    expect(script).toContain('source=growth-renew')
    expect(script).toContain('source=growth-join')
    expect(script).toContain('invitationToken=')
    expect(script).not.toContain('requestPayment')
    // 续费/开通的跳转目标一律是会员订单确认页（邀请分享落地页仍为会员方案页，属既有邀请链路）。
    expect(script).toMatch(/renewMembership\(\)[\s\S]{0,200}source=growth-renew/)
    expect(script).toMatch(/openMembershipOrder\(\)[\s\S]{0,200}source=growth-join/)
    expect(template).toContain('open-type="share"')
    expect(template).toContain('邀请加入')
    expect(template).toContain('立即续费')
    expect(template).toContain('立即加入')
    expect(template).toContain('{{membershipValidityText}}')
    expect(template).toContain('wx:for="{{tasks}}"')
    expect(template).toContain('id="growth-member-actions"')
    expect(template).toContain('id="growth-join-actions"')
    expect(template).toContain('<mip-sticky-actions')
    expect(template).toContain('slot="actions"')
  })

  it('gates the renewal CTA to the final three months of the server-provided membership', () => {
    const script = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.ts'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    // figma 2165:17142：「立即续费」仅到期前 3 个月展示（到期时间为服务端会员事实）。
    expect(script).toContain('function withinRenewalWindow(')
    expect(script).toContain('opensAt.setMonth(opensAt.getMonth() - 3)')
    expect(script).toContain('renewWindowOpen: withinRenewalWindow(membership.membershipEndsAt)')
    expect(script).toContain('\'有效期一年\'')
    expect(script).toMatch(/有效期至:\$\{formatDottedDate\(membership\.membershipEndsAt\)\}/)
    expect(template).toContain('wx:if="{{renewWindowOpen}}"')
    // 本页不展示金额（终审 C7：会费金额只在订单确认页展示）。
    expect(template).not.toContain('6600')
    expect(template).not.toContain('¥')
  })

  it('maps the frozen player-level visual hierarchy to server facts', () => {
    const pageConfig = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.json'),
      'utf8',
    )
    const template = fs.readFileSync(
      path.join(process.cwd(), 'src/packages/member/mip-growth/index.wxml'),
      'utf8',
    )

    expect(pageConfig).toContain('"navigationBarTitleText": "玩家等级"')
    expect(pageConfig).toContain('"navigationBarBackgroundColor": "#FCDF03"')
    expect(pageConfig).toContain('"navigationBarTextStyle": "black"')
    expect(pageConfig).toContain('"backgroundColor": "#FCDF03"')
    expect(template).toContain('EXP: {{snapshot.account.experienceBalance}}')
    expect(template).toContain('{{nextLevelThreshold}}')
    expect(template).toContain('wx:for="{{levels}}"')
    expect(template).toContain('可享 {{snapshot.currentLevel.benefits.length}} 项权益')
    expect(template).not.toContain('requestPayment')
  })
})
