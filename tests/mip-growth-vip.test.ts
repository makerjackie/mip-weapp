import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('MIP growth player actions', () => {
  it('reuses the membership invitation and canonical renewal flow on the growth page', () => {
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
    expect(script).toContain('/pages/membership/index?source=growth-renew')
    expect(script).toContain('invitationToken=')
    expect(script).not.toContain('requestPayment')
    expect(template).toContain('open-type="share"')
    expect(template).toContain('邀请加入')
    expect(template).toContain('立即续费')
    expect(template).toContain('会员有效期至 {{membershipEndsText}}')
    expect(template).toContain('wx:for="{{tasks}}"')
    expect(template).toContain('id="growth-member-actions"')
    expect(template).toContain('bottom-[calc(env(safe-area-inset-bottom)+16rpx)]')
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
