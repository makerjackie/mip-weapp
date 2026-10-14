import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('account closure experience', () => {
  it('hides the closure entry and dialog while keeping the closed-account tombstone (MIW-93, DEF-07)', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const template = read('src/packages/member/privacy/index.wxml')
    const config = JSON.parse(read('src/packages/member/privacy/index.json'))

    // 注销入口本轮下线：设置页不渲染注销按钮与确认弹层，页面处理器不留死代码。
    expect(template).not.toContain('注销账号')
    expect(template).not.toContain('startAccountClosure')
    expect(template).not.toContain('<t-dialog')
    expect(page).not.toContain('closeAccount')
    expect(page).not.toContain('closureState')
    expect(page).not.toContain('confirmationPhrase')
    expect(page).not.toContain('accountClosureConfirmationPhrase')
    expect(page).not.toContain('createAccountClosureRequestTracker')
    expect(config.usingComponents['t-dialog']).toBeUndefined()
    expect(read('src/packages/member/privacy/index.json')).not.toContain('tdesign-miniprogram/dialog')
    // 服务端 account-closure 能力保留（支持/应急场景）：被服务端关闭的账号打开设置页仍呈现墓碑。
    expect(page).toContain('userStatus === \'CLOSED\'')
    expect(template).toContain('账号已注销')
    expect(template).toContain('订单、支付、退款、活动记录和审计记录按规则保留')
    // 退出登录流保持原行为（确认弹窗，非注销）。
    expect(page).toContain('wx.showModal')
  })

  it('presents account actions as settings instead of data-category explanations', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const template = read('src/packages/member/privacy/index.wxml')
    const config = JSON.parse(read('src/packages/member/privacy/index.json'))

    // journey-review J5-01：账号设置页导航标题对齐设计帧 1728_19083「账号设置」。
    expect(config.navigationBarTitleText).toBe('账号设置')
    expect(template).toContain('title="资料与隐私"')
    expect(template).toContain('bind:tap="openVisibilitySettings"')
    expect(template).toContain('bind:tap="openBlockedProfiles"')
    expect(template).toContain('bind:tap="openUserAgreement"')
    expect(template).toContain('bind:tap="openPrivacyPolicy"')
    expect(template).not.toContain('>微信账号</view>')
    expect(template).not.toContain('>手机号</view>')
    expect(template).not.toContain('>支付记录</view>')
    expect(page).toContain('/packages/member/privacy-policy/index')
  })

  it('uses a standalone privacy policy for agreement and registration entry points', () => {
    const policy = read('src/packages/member/privacy-policy/index.wxml')
    const globalAccess = read('src/modules/mip-identity/global-access.ts')
    const registration = read('src/packages/member/mip-events/registration/index.ts')
    const agreementSources = [
      'cloudfunctions/mip-identity-api/domain/service.js',
      'cloudfunctions/mip-events-api/domain/participation-access.js',
      'cloudfunctions/mip-commerce-api/domain/full-access.js',
      'cloudfunctions/mip-admin-api/domain/full-access.js',
    ].map(read)

    expect(policy).toContain('id="mip-privacy-policy-page"')
    expect(globalAccess).toContain('\'packages/member/privacy-policy/index\'')
    expect(registration).toContain('\'/packages/member/privacy-policy/index\'')
    for (const source of agreementSources) {
      expect(source).toContain('documentPath: \'/packages/member/privacy-policy/index\'')
    }
  })

  it('keeps the server closure capability behind the MIP identity API and off the settings page', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const gateway = read('src/modules/mip-identity/gateway.ts')
    expect(page).not.toContain('closeAccount')
    expect(gateway).toContain('call(transport, \'closeAccount\', input)')
    expect(gateway).toContain('contractVersion: MIP_IDENTITY_CONTRACT_VERSION')
    expect(`${page}\n${gateway}`).not.toMatch(/membership-(?:api|admin|payment)/)
  })

  it('serializes invitation attribution with inviter account closure', () => {
    const events = read('cloudfunctions/mip-events-api/domain/event-service.js')
    const attribution = events.slice(
      events.indexOf('async function recordInvitationAttribution'),
      events.indexOf('async function createRegistration'),
    )

    expect(attribution).toMatch(
      /SELECT id FROM mip_users[\s\S]*status = 'ACTIVE' FOR UPDATE/,
    )
    expect(attribution.indexOf('FOR UPDATE')).toBeLessThan(
      attribution.indexOf('INSERT IGNORE INTO mip_event_invitation_attributions'),
    )
  })
})
