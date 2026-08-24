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
})
