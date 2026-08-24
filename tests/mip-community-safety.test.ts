import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { createMipCommunityGateway } from '../src/modules/mip-community/gateway'
import { createCommunityReportIntent } from '../src/modules/mip-community/report-intent'

const require = createRequire(import.meta.url)

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP community safety', () => {
  it('sanitizes community DTOs and never forwards internal identity fields', async () => {
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const transport = {
      invoke: vi.fn(async (action: string) => {
        if (action === 'getRelationship') {
          return { profileRef, isSelf: false, blocked: false, userId: 'private-user-id', openid: 'private-openid' }
        }
        return {
          items: [{
            profileRef,
            nickname: '公开用户',
            headline: '产品设计',
            blockedAt: '2026-08-24T08:00:00.000Z',
            userId: 'private-user-id',
            openid: 'private-openid',
          }],
        }
      }),
    }
    const gateway = createMipCommunityGateway(transport)
    expect(await gateway.relationship(profileRef)).toEqual({ profileRef, isSelf: false, blocked: false })
    const blocked = await gateway.listBlocked()
    expect(blocked.items[0]).toEqual({
      profileRef,
      nickname: '公开用户',
      headline: '产品设计',
      blockedAt: '2026-08-24T08:00:00.000Z',
    })
    expect(JSON.stringify(blocked)).not.toMatch(/userId|openid|private-user-id|private-openid/)
  })

  it('keeps one report request id stable across a failed delivery retry', async () => {
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const intent = createCommunityReportIntent(
      profileRef,
      'FRAUD',
      '疑似虚假交易信息',
      'community-report-stable-request-0001',
    )
    const invoke = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ reportId: 'report-1', status: 'PENDING', idempotent: true })
    const gateway = createMipCommunityGateway({ invoke })
    await expect(gateway.report(intent)).rejects.toThrow('network')
    await expect(gateway.report(intent)).resolves.toEqual({
      reportId: 'report-1',
      status: 'PENDING',
      idempotent: true,
    })
    expect(invoke.mock.calls[0][1].requestId).toBe('community-report-stable-request-0001')
    expect(invoke.mock.calls[1][1].requestId).toBe('community-report-stable-request-0001')
  })

  it('locks migration checksums and app-scoped community constraints', () => {
    const sql = source('database/mysql/mip/010_community_safety.sql')
    const rollback = source('database/mysql/mip/rollback/010_community_safety.sql')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mip_user_blocks')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS mip_reports')
    expect(sql).toContain('PRIMARY KEY (app_id, blocker_user_id, blocked_user_id)')
    expect(sql).toContain('UNIQUE KEY mip_reports_request_uk (app_id, reporter_user_id, request_id)')
    expect(sql).toContain('mip_reports_review_state_ck')
    expect(sql).toContain('mip_reports_version_ck')
    expect(rollback.indexOf('mip_reports')).toBeLessThan(rollback.indexOf('mip_user_blocks'))
    expect(sql).not.toMatch(/\b(member|dating|sewing)_/i)
  })

  it('registers the block list and gates all safety mutations through MIP modules', () => {
    const app = JSON.parse(source('src/app.json'))
    const project = JSON.parse(source('config/project.json'))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    const route = 'packages/member/mip-blocked/index'
    const appRoutes = app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => (
      pkg.pages.map(page => `${pkg.root}/${page}`)
    ))
    expect(appRoutes).toContain(route)
    expect(project.routes.some((item: { pathName: string }) => item.pathName === route)).toBe(true)
    expect(runtime.routes.some((item: { path: string }) => item.path === route)).toBe(true)
    expect(runtime.routeCount).toBe(runtime.routes.length)

    const publicProfile = source('src/packages/member/mip-public-profile/index.ts')
    const blockedPage = source('src/packages/member/mip-blocked/index.ts')
    expect(`${publicProfile}\n${blockedPage}`).toContain('action: \'INTERACT\'')
    expect(publicProfile).toContain('mipCommunityModule.report')
    expect(publicProfile).toContain('mipCommunityModule.block')
    expect(publicProfile).toContain('reportIntent: null as CommunityReportIntent | null')
    expect(publicProfile).toContain('intent.requestId')
    expect(publicProfile).toContain('retryReport()')
    expect(blockedPage).toContain('mipCommunityModule.unblock')
    expect(`${publicProfile}\n${blockedPage}`).not.toMatch(/wx\.cloud|userId|openid/i)
  })

  it('shares the AppID-bound profile reference contract with the community function', () => {
    const identity = require('../cloudfunctions/mip-identity-api/lib/profile-ref') as {
      createProfileRef: (value: { appId: string, userId: string }, pepper: string) => string
    }
    const community = require('../cloudfunctions/mip-community-api/lib/profile-ref') as {
      readProfileRef: (profileRef: string, appId: string, pepper: string) => string
    }
    const appId = 'wx-community-test'
    const userId = '10000000-0000-4000-8000-000000000001'
    const pepper = 'community-cross-function-pepper-value-over-32'
    const profileRef = identity.createProfileRef({ appId, userId }, pepper)
    expect(community.readProfileRef(profileRef, appId, pepper)).toBe(userId)
  })
})
