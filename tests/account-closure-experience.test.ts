import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('account closure experience', () => {
  it('provides loading, failure, typed confirmation, processing, and success states', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const template = read('src/packages/member/privacy/index.wxml')

    expect(page).toContain('state: \'loading\'')
    expect(page).toContain('closureState: \'idle\'')
    expect(page).toContain('closureState: \'processing\'')
    expect(page).toContain('closureState: \'failed\'')
    expect(page).toContain('state: \'success\'')
    expect(page).toContain('state: \'processing\'')
    expect(page).toContain('? \'blocked\'')
    expect(page).toContain('? \'conflict\'')
    expect(page).toContain('error.code === \'ACCOUNT_CLOSURE_PENDING_SETTLEMENT\'')
    expect(page).toContain('wx.showModal')
    expect(page).toContain('createAccountClosureRequestTracker')
    expect(page).toContain('idempotencyKey: this.accountClosureRequest().current()')
    expect(page).toContain('closureRequest: null as ReturnType<typeof createAccountClosureRequestTracker> | null')
    expect(template).toContain('输入“{{requiredConfirmationPhrase}}”')
    expect(template).toContain('账号已注销')
    expect(page).toContain('订单、支付、退款、活动和审计记录按规则保留')
    expect(template).toContain('loading="{{closureState === \'processing\'}}"')
  })

  it('presents account actions as settings instead of data-category explanations', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const template = read('src/packages/member/privacy/index.wxml')
    const config = JSON.parse(read('src/packages/member/privacy/index.json'))

    expect(config.navigationBarTitleText).toBe('账号设置')
    expect(template).toContain('>资料与隐私</view>')
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

  it('keeps closure behind the MIP identity API and does not call legacy membership functions', () => {
    const page = read('src/packages/member/privacy/index.ts')
    const gateway = read('src/modules/mip-identity/gateway.ts')
    expect(page).toContain('mipIdentityModule.closeAccount')
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
