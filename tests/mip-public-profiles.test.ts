import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createMipIdentityGateway } from '../src/modules/mip-identity'

const require = createRequire(import.meta.url)

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('MIP public profiles', () => {
  it('uses the same AppID-bound profile reference contract across MIP functions', () => {
    const identityRefs = require('../cloudfunctions/mip-identity-api/lib/profile-ref') as {
      readProfileRef: (profileRef: string, appId: string, pepper: string) => string
    }
    const issuers = [
      require('../cloudfunctions/mip-events-api/lib/profile-ref'),
      require('../cloudfunctions/mip-opportunities-api/lib/profile-ref'),
    ] as Array<{ createProfileRef: (identity: { appId: string, userId: string }, pepper: string) => string }>
    const appId = 'wx-public-profile-test'
    const userId = '10000000-0000-4000-8000-000000000001'
    const pepper = 'cross-function-profile-ref-pepper-more-than-32-characters'
    for (const issuer of issuers) {
      const profileRef = issuer.createProfileRef({ appId, userId }, pepper)
      expect(identityRefs.readProfileRef(profileRef, appId, pepper)).toBe(userId)
      expect(() => identityRefs.readProfileRef(profileRef, 'another-app', pepper)).toThrow('PUBLIC_PROFILE_NOT_FOUND')
    }
  })

  it('sanitizes the public profile transport instead of forwarding extra identity fields', async () => {
    const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`
    const gateway = createMipIdentityGateway({
      async invoke() {
        return {
          ok: true,
          data: {
            profileRef,
            isSelf: false,
            nickname: '公开用户',
            userKind: 'PLAYER',
            abilities: [{ label: '项目管理' }],
            userId: 'private-user-id',
            openid: 'private-openid',
            phoneNumber: 'private-phone',
          },
        }
      },
    })
    const result = await gateway.getPublicProfile(profileRef)
    expect(result).toEqual({
      profileRef,
      isSelf: false,
      nickname: '公开用户',
      userKind: 'PLAYER',
      abilities: [{ label: '项目管理' }],
    })
    expect(result).not.toHaveProperty('userId')
    expect(result).not.toHaveProperty('openid')
    expect(result).not.toHaveProperty('phoneNumber')
  })

  it('registers public profile and event participant pages in all route contracts', () => {
    const app = JSON.parse(source('src/app.json'))
    const project = JSON.parse(source('config/project.json'))
    const runtime = JSON.parse(source('config/runtime-pages.json'))
    const expected = [
      'packages/member/mip-public-profile/index',
      'packages/member/mip-events/participants/index',
    ]
    const appRoutes = new Set(app.subPackages.flatMap((pkg: { root: string, pages: string[] }) => (
      pkg.pages.map(page => `${pkg.root}/${page}`)
    )))
    const projectRoutes = new Set(project.routes.map((route: { pathName: string }) => route.pathName))
    const runtimeRoutes = new Set(runtime.routes.map((route: { path: string }) => route.path))
    for (const route of expected) {
      expect(appRoutes.has(route)).toBe(true)
      expect(projectRoutes.has(route)).toBe(true)
      expect(runtimeRoutes.has(route)).toBe(true)
    }
    expect(runtime.routeCount).toBe(runtime.routes.length)
  })

  it('uses MIP modules and protects detail interactions before mutations', () => {
    const participantPage = source('src/packages/member/mip-events/participants/index.ts')
    const profilePage = source('src/packages/member/mip-public-profile/index.ts')
    expect(participantPage).toContain('mipEventsModule.listPublicParticipants')
    expect(profilePage).toContain('opportunityModule.getPublicProfile')
    expect(profilePage).toContain('mipIdentityModule.resolveProfileCardScene')
    expect(profilePage).toContain('profileInterestMutations.mutate')
    expect(`${participantPage}\n${profilePage}`).not.toMatch(/membershipModule|wx\.cloud/)

    for (const detail of [
      'src/packages/member/mip-opportunities/detail/index.ts',
      'src/packages/member/mip-cooperation/detail/index.ts',
      'src/packages/member/mip-cases/detail/index.ts',
    ]) {
      const code = source(detail)
      expect(code).toContain('action: \'INTERACT\'')
      expect(code).toContain('consumePendingResume')
      expect(code).toContain('/packages/member/mip-public-profile/index?profileRef=')
    }
  })
})
