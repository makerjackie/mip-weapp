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
    expect(template).toContain('订单、支付、退款、会员权益、活动业务事实和审计记录继续保留')
    expect(template).toContain('loading="{{closureState === \'processing\'}}"')
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
