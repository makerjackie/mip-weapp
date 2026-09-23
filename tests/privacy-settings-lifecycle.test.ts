import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ loadSnapshot: vi.fn(), saveProfile: vi.fn() }))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: api }))
let definition: Record<string, any>
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Record<string, any>) => {
    definition = value
  })
  await import('../src/packages/member/privacy-settings/index')
})
function snapshot(visibility = {}, version = 3) {
  return {
    authenticated: true,
    profile: { exists: true, version, nickname: '玩家', realName: '', gender: 'UNKNOWN', careerIdentityKey: '', identityStatus: '', headline: '', introduction: '', companies: [], organizations: [], abilityTagIds: [], visibility: { headline: true, introduction: true, companies: true, organizations: true, ...visibility } },
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  api.loadSnapshot.mockResolvedValue(snapshot())
})
function page() {
  const instance = Object.create(definition)
  instance.data = structuredClone(definition.data)
  instance.setData = (patch: Record<string, unknown>) => Object.assign(instance.data, patch)
  return instance
}
const toggle = (instance: ReturnType<typeof page>, key: string, value: boolean) => instance.onToggle({ currentTarget: { dataset: { key } }, detail: { value } })

describe('server-backed privacy settings', () => {
  it('loads current account privacy on every entry without device-global state', async () => {
    api.loadSnapshot.mockResolvedValue(snapshot({ talentSearch: false, opportunitiesForNonPlayers: true }))
    const first = page()
    await first.load()
    expect(first.data).toMatchObject({ state: 'ready', hideFromTalentSearch: true, hideOpportunitiesFromNonPlayers: false })
    api.loadSnapshot.mockResolvedValue(snapshot({ talentSearch: true }))
    const second = page()
    await second.load()
    expect(second.data.hideFromTalentSearch).toBe(false)
  })
  it('saves only the selected preference using the current profile version', async () => {
    const instance = page()
    await instance.load()
    api.saveProfile.mockResolvedValue(snapshot({ opportunitiesForNonPlayers: false }, 4))
    await toggle(instance, 'hideOpportunitiesFromNonPlayers', true)
    expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3,
      nickname: '玩家',
      visibility: expect.objectContaining({ headline: true, opportunitiesForNonPlayers: false }),
    }))
    expect(instance.data).toMatchObject({ saving: false, hideOpportunitiesFromNonPlayers: true })
    expect(instance.snapshot.profile.version).toBe(4)
  })
  it('does not show a successful saved value after a conflict and refreshes server state', async () => {
    const instance = page()
    await instance.load()
    api.saveProfile.mockRejectedValue(new Error('资料已更新，请重试'))
    await toggle(instance, 'hideFromTalentSearch', true)
    expect(instance.data.hideFromTalentSearch).toBe(false)
    expect(instance.data.message).toContain('请重试')
    expect(api.loadSnapshot).toHaveBeenCalledTimes(2)
  })
  it('blocks edits while loading or saving and fails visibly when identity is absent', async () => {
    const instance = page()
    await toggle(instance, 'hideFromTalentSearch', true)
    expect(api.saveProfile).not.toHaveBeenCalled()
    api.loadSnapshot.mockResolvedValue({ authenticated: false, profile: {} })
    await instance.load()
    expect(instance.data.state).toBe('error')
  })
})
