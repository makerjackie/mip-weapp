import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ getProfile: vi.fn(), saveProfile: vi.fn(), loadSnapshot: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: api }))
const pages: Record<string, Record<string, any>> = {}
let registering = ''
beforeAll(async () => {
  vi.stubGlobal('wx', { showToast: vi.fn() })
  vi.stubGlobal('Page', (definition: Record<string, any>) => {
    pages[registering] = definition
  })
  registering = 'visibility'
  await import('../src/packages/member/mip-visibility-settings/index')
  registering = 'privacy'
  await import('../src/packages/member/privacy-settings/index')
})
function page(name: string) {
  const instance = Object.create(pages[name])
  instance.data = structuredClone(pages[name].data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}
function profile() {
  return {
    exists: true,
    version: 3,
    nickname: '玩家',
    realName: '',
    gender: 'UNKNOWN',
    careerIdentityKey: '',
    identityStatus: '',
    headline: '',
    introduction: '',
    companies: [],
    organizations: [],
    abilityTagIds: [],
    visibility: { headline: true, introduction: true, companies: true, organizations: true, talentSearch: true, opportunitiesForNonPlayers: true },
  }
}
beforeEach(() => vi.clearAllMocks())

describe('settings save and re-entry contract', () => {
  it('keeps both privacy choices after saving public visibility and opening a new privacy page', async () => {
    let saved = profile()
    api.loadSnapshot.mockImplementation(async () => ({ authenticated: true, phoneBound: true, profile: structuredClone(saved) }))
    api.getProfile.mockImplementation(async () => ({ ...structuredClone(saved), privateContact: { phoneBound: true } }))
    // Identity mutations return a snapshot with top-level phoneBound, not privateContact.
    api.saveProfile.mockImplementation(async (input) => {
      saved = { ...saved, ...input, version: saved.version + 1 }
      return { authenticated: true, phoneBound: true, profile: structuredClone(saved) }
    })
    const privacy = page('privacy')
    await privacy.load()
    for (const key of ['hideFromTalentSearch', 'hideOpportunitiesFromNonPlayers']) {
      await privacy.onToggle({ currentTarget: { dataset: { key } }, detail: { value: true } })
    }
    const visibility = page('visibility')
    await visibility.load()
    visibility.updateVisibility({ currentTarget: { dataset: { field: 'visibilityHeadline' } }, detail: { value: false } })
    await visibility.save()
    expect(visibility.data.phoneBound).toBe(true)
    expect(saved.visibility).toMatchObject({ talentSearch: false, opportunitiesForNonPlayers: false, headline: false })
    expect(api.saveProfile.mock.calls.map(([input]) => input.expectedVersion)).toEqual([3, 4, 5])
    const reentered = page('privacy')
    await reentered.load()
    expect(reentered.data).toMatchObject({ state: 'ready', hideFromTalentSearch: true, hideOpportunitiesFromNonPlayers: true })
  })
})
