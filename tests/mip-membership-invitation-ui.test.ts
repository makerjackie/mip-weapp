import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// MIW-65：会员方案页下线后，邀请承载（分享/复制文案/小程序码海报）与受邀嘉宾
// 落地全部收敛到玩家等级页（mip-growth）。
describe('MIP membership invitation carriers', () => {
  it('provides share, copy, and server-backed mini-program-code poster carriers on the growth page', () => {
    const controller = source('src/packages/member/mip-growth/index.ts')
    const template = source('src/packages/member/mip-growth/index.wxml')
    expect(controller).toContain('onShareAppMessage()')
    expect(controller).toContain('copyInvitation()')
    expect(controller).toContain('createMembershipInvitationCode()')
    expect(controller).toContain('drawInvitationPoster')
    expect(template).toContain('open-type="share"')
    expect(template).toContain('复制邀请文案')
    expect(template).toContain('生成邀请海报')
    expect(template).toContain('mip-growth-invitation-canvas')
  })

  it('exchanges a signed scene and displays only the public invitation source', () => {
    const controller = source('src/packages/member/mip-growth/index.ts')
    const template = source('src/packages/member/mip-growth/index.wxml')
    expect(controller).toContain('resolveMembershipInvitationScene(scene)')
    expect(controller).toContain('invitationAttribution')
    expect(template).toContain('当前会员邀请来源')
    expect(template).not.toMatch(/invitedByUserId|userId|OpenID/)
  })

  it('shares the brand cover image and reports the invitation once the invitee is a guest', () => {
    const controller = source('src/packages/member/mip-growth/index.ts')
    // MIW-27 第二轮：分享卡片图片暂用品牌默认封面；受邀嘉宾进入页面时上报一次
    // 邀请凭证，资格校验与幂等由服务端完成，失败静默（下次进入重试）。
    expect(controller).toContain('imageUrl: brand.opportunityDefaultCoverPath')
    expect(controller).toContain('recordMembershipInvitationGuest(this.incomingInvitationToken)')
    expect(controller).toContain('invitationGuestRecorded')
    expect(controller).toMatch(/recordMembershipInvitationGuest[\s\S]{0,80}\.catch\(\(\) => \{\}\)/)
    // MIW-65：分享与复制文案的落地路径都指向玩家等级页。
    expect(controller).toContain('/packages/member/mip-growth/index?source=growth-share')
    expect(controller).toContain('/packages/member/mip-growth/index?source=member-copy')
  })

  it('pauses repurchase while the first payment waits for the admin approval', () => {
    const controller = source('src/packages/member/mip-growth/index.ts')
    const template = source('src/packages/member/mip-growth/index.wxml')
    // MIW-27 第二轮：待审核事实来自 commerce 快照；审核中不给下单入口，不虚构会员状态。
    expect(controller).toContain('membership.kind === \'PENDING\'')
    expect(controller).toContain('membershipState: \'pending\'')
    expect(template).toContain('label="入会审核中" disabled')
    expect(template).not.toContain('requestPayment')
  })
})
