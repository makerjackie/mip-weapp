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
    expect(script).toContain('/pages/membership/index?source=growth-renew')
    expect(script).toContain('invitationToken=')
    expect(script).not.toContain('requestPayment')
    expect(template).toContain('open-type="share"')
    expect(template).toContain('邀请加入')
    expect(template).toContain('立即续费')
  })
})
