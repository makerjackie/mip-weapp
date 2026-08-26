import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import {
  createAdminMembershipDetailView,
  parseAdminMembershipDetail,
  retainAdminMembershipGrantIntent,
} from '../src/modules/mip-admin/memberships'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const USER_ID = '10000000-0000-4000-8000-000000000001'
const ORDER_ID = '10000000-0000-4000-8000-000000000002'
const ORDER_ENTITLEMENT_ID = '10000000-0000-4000-8000-000000000003'
const MANUAL_ENTITLEMENT_ID = '10000000-0000-4000-8000-000000000004'
const ADJUSTMENT_ID = '10000000-0000-4000-8000-000000000005'
const NEXT_ADJUSTMENT_ID = '10000000-0000-4000-8000-000000000006'

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function detail(chainVersion = 4) {
  return {
    user: { id: USER_ID, nickname: '林然', status: 'ACTIVE' as const },
    chainVersion,
    membership: {
      status: 'ACTIVE' as const,
      active: true,
      currentEndsAt: '2030-06-01T00:00:00.000Z',
      nextStartsAt: '2030-06-01T00:00:00.000Z',
    },
    entitlements: [
      {
        id: ORDER_ENTITLEMENT_ID,
        sourceType: 'ORDER' as const,
        status: 'ACTIVE' as const,
        startsAt: '2030-01-01T00:00:00.000Z',
        endsAt: '2030-03-01T00:00:00.000Z',
        currentlyActive: true,
        orderId: ORDER_ID,
        adjustment: null,
      },
      {
        id: MANUAL_ENTITLEMENT_ID,
        sourceType: 'ADMIN_ADJUSTMENT' as const,
        status: 'ACTIVE' as const,
        startsAt: '2030-03-01T00:00:00.000Z',
        endsAt: '2030-06-01T00:00:00.000Z',
        currentlyActive: false,
        orderId: null,
        adjustment: {
          id: ADJUSTMENT_ID,
          durationMonths: 3 as const,
          reason: '线下协议会员',
          actorNickname: '运营成员',
          createdAt: '2030-01-02T00:00:00.000Z',
          expectedChainVersion: 3,
          resultChainVersion: 4,
        },
      },
    ],
  }
}

describe('MIP admin membership client contract', () => {
  it('uses neutral get/grant operations and places the idempotency key in the envelope', async () => {
    const requests: unknown[] = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request))
        return request.action.endsWith('.get')
          ? detail() as never
          : {
              adjustmentId: NEXT_ADJUSTMENT_ID,
              resultChainVersion: 5,
              startsAt: '2030-06-01T00:00:00.000Z',
              endsAt: '2030-09-01T00:00:00.000Z',
              idempotent: false,
            } as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.getMembership(USER_ID)
    await gateway.grantMembership({
      userId: USER_ID,
      durationMonths: 3,
      reason: ' 线下协议会员 ',
      expectedChainVersion: 4,
      idempotencyKey: 'membership-intent-a',
    })

    expect(requests).toEqual([
      {
        contractVersion: 1,
        action: 'mip.admin.memberships.get',
        input: { userId: USER_ID },
      },
      {
        contractVersion: 1,
        action: 'mip.admin.memberships.grant',
        input: {
          userId: USER_ID,
          durationMonths: 3,
          reason: '线下协议会员',
          expectedChainVersion: 4,
        },
        idempotencyKey: 'membership-intent-a',
      },
    ])
    await expect(gateway.getMembership('user-a')).rejects.toThrow('Invalid admin membership user ID')
  })

  it('strictly validates dual-source entitlements and the chain transition', async () => {
    expect(parseAdminMembershipDetail(detail())).toEqual(detail())

    expect(() => parseAdminMembershipDetail({
      ...detail(),
      entitlements: [{ ...detail().entitlements[1], orderId: ORDER_ID }],
    })).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))

    expect(() => parseAdminMembershipDetail({
      ...detail(),
      entitlements: [{ ...detail().entitlements[0], status: 'UNKNOWN' }],
    })).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }))

    const gateway = createMipAdminGateway({
      request: vi.fn(async () => ({
        adjustmentId: NEXT_ADJUSTMENT_ID,
        resultChainVersion: 4,
        startsAt: '2030-06-01T00:00:00.000Z',
        endsAt: '2030-09-01T00:00:00.000Z',
        idempotent: false,
      })),
    })
    await expect(gateway.grantMembership({
      userId: USER_ID,
      durationMonths: 3,
      reason: '线下协议会员',
      expectedChainVersion: 4,
      idempotencyKey: 'membership-intent-a',
    })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('retains one idempotency key per exact intent and maps server facts without deriving membership', () => {
    const draft = {
      userId: USER_ID,
      durationMonths: 3 as const,
      reason: ' 线下协议会员 ',
      expectedChainVersion: 4,
    }
    const first = retainAdminMembershipGrantIntent(null, draft, () => 'intent-a')
    const retry = retainAdminMembershipGrantIntent(first, { ...draft, reason: '线下协议会员' }, () => 'intent-b')
    const nextVersion = retainAdminMembershipGrantIntent(retry, { ...draft, expectedChainVersion: 5 }, () => 'intent-c')

    expect(retry.idempotencyKey).toBe('intent-a')
    expect(nextVersion.idempotencyKey).toBe('intent-c')

    const view = createAdminMembershipDetailView(detail(), value => `日期:${value}`)
    expect(view.membership.statusText).toBe('有效')
    expect(view.entitlements.map(item => item.sourceText)).toEqual(['购买', '人工开通'])
    expect(view.entitlements[1]?.adjustment).toMatchObject({
      reason: '线下协议会员',
      actorNickname: '运营成员',
      createdText: '日期:2030-01-02T00:00:00.000Z',
    })
  })

  it('caches detail reads and invalidates membership and user views after a grant', async () => {
    const spies = {
      getMembership: vi.fn<MipAdminGateway['getMembership']>(async () => detail()),
      grantMembership: vi.fn<MipAdminGateway['grantMembership']>(async input => ({
        adjustmentId: NEXT_ADJUSTMENT_ID,
        resultChainVersion: input.expectedChainVersion + 1,
        startsAt: '2030-06-01T00:00:00.000Z',
        endsAt: '2030-09-01T00:00:00.000Z',
        idempotent: false,
      })),
    }
    const module = createMipAdminModule(spies as unknown as MipAdminGateway)
    await module.memberships.get(USER_ID)
    await module.memberships.get(USER_ID)
    expect(spies.getMembership).toHaveBeenCalledTimes(1)

    await module.memberships.grant({
      userId: USER_ID,
      durationMonths: 3,
      reason: '线下协议会员',
      expectedChainVersion: 4,
      idempotencyKey: 'intent-a',
    })
    await module.memberships.get(USER_ID)
    expect(spies.getMembership).toHaveBeenCalledTimes(2)
  })

  it('registers a contextual responsive page without adding a workspace navigation item', () => {
    const app = JSON.parse(read('src/app.json')) as { subPackages: Array<{ root: string, pages: string[] }> }
    const runtime = JSON.parse(read('config/runtime-pages.json')) as {
      routes: Array<{
        path: string
        states: string[]
        acceptStates?: string[]
        readyAssertion: string
      }>
    }
    const adminPackage = app.subPackages.find(item => item.root === 'packages/admin')
    const membershipRoute = runtime.routes.find(item => item.path === 'packages/admin/membership/index')
    const page = read('src/packages/admin/membership/index.wxml')
    const profile = read('src/packages/admin/profiles/index.wxml')
    const profileScript = read('src/packages/admin/profiles/index.ts')
    const workspaceNav = read('src/packages/admin/components/workspace-nav/index.ts')

    expect(adminPackage?.pages).toContain('membership/index')
    expect(membershipRoute?.states).toContain('conflict')
    expect(membershipRoute?.acceptStates).toEqual(['ready'])
    expect(membershipRoute?.readyAssertion).toBe('state === \'ready\'')
    expect(page).toContain('mip-admin-section-grid')
    expect(page).toContain('mip-admin-record-list')
    expect(page).toContain('<app-page-exit />')
    expect(page).not.toContain('windowWidth')
    expect(profile).toContain('wx:if="{{canReadMembership}}"')
    expect(profileScript).toContain('hasCapability(session.capabilities, \'memberships.read\')')
    expect(profileScript).toContain('/packages/admin/membership/index?userId=')
    expect(workspaceNav).not.toContain('/packages/admin/membership/index')
  })
})
