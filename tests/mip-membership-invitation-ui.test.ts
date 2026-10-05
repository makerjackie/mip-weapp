import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP membership invitation carriers', () => {
  it('provides share, copy, and server-backed mini-program-code poster carriers', () => {
    const controller = source('src/pages/membership/index.ts')
    const template = source('src/pages/membership/index.wxml')
    expect(controller).toContain('onShareAppMessage()')
    expect(controller).toContain('copyInvitation()')
    expect(controller).toContain('createMembershipInvitationCode()')
    expect(controller).toContain('drawInvitationPoster')
    expect(template).toContain('open-type="share"')
    expect(template).toContain('复制邀请文案')
    expect(template).toContain('生成邀请海报')
    expect(template).toContain('mip-membership-invitation-canvas')
  })

  it('exchanges a signed scene and displays only the public invitation source', () => {
    const controller = source('src/pages/membership/index.ts')
    const template = source('src/pages/membership/index.wxml')
    expect(controller).toContain('resolveMembershipInvitationScene(scene)')
    expect(controller).toContain('benefits.invitationAttribution')
    expect(template).toContain('当前会员邀请来源')
    expect(template).not.toMatch(/invitedByUserId|userId|OpenID/)
  })

  it('shares the brand cover image and reports the invitation once the invitee is a guest', () => {
    const controller = source('src/pages/membership/index.ts')
    // MIW-27 第二轮：分享卡片图片暂用品牌默认封面；受邀嘉宾进入页面时上报一次
    // 邀请凭证，资格校验与幂等由服务端完成，失败静默（下次进入重试）。
    expect(controller).toContain('imageUrl: brand.opportunityDefaultCoverPath')
    expect(controller).toContain('recordMembershipInvitationGuest(this.incomingInvitationToken)')
    expect(controller).toContain('invitationGuestRecorded')
    expect(controller).toMatch(/recordMembershipInvitationGuest[\s\S]{0,80}\.catch\(\(\) => \{\}\)/)
  })
})
