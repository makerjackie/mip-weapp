import { beforeAll, describe, expect, it, vi } from 'vitest'

const identity = vi.hoisted(() => ({
  rebindWechatPhone: vi.fn(),
  getProfile: vi.fn(),
}))
vi.mock('../src/modules/mip-identity/client', () => ({ mipIdentityModule: identity }))
vi.mock('../src/modules/mip-identity', () => ({ MAX_PROFILE_ORGANIZATIONS: 5 }))

type Data = Record<string, unknown>
interface Definition { data: Data, [key: string]: unknown }
let definition: Definition
beforeAll(async () => {
  vi.stubGlobal('Page', (value: Definition) => {
    definition = value
  })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('../src/packages/member/mip-card-edit/index')
})
describe('card phone binding preserves edits', () => {
  it('refreshes authoritative phone and version while retaining unsaved card fields', async () => {
    identity.rebindWechatPhone.mockResolvedValue({})
    identity.getProfile.mockResolvedValue({ version: 8, realName: 'old name', privateContact: { phoneBound: true, phoneMasked: '138****5678', wechat: 'old wechat' } })
    const value = Object.create(definition) as Definition & { setData: (patch: Data) => void }
    value.data = structuredClone(definition.data)
    value.setData = patch => Object.assign(value.data, patch)
    const draft = { realName: 'new name', wechat: 'new wechat', email: 'new@example.com', address: 'new address', companies: [{ name: 'new company', role: 'new role' }], organizations: [{ name: 'new organization', role: 'role' }], visibilityPhone: true, visibilityWechat: true }
    Object.assign(value.data, draft, { profileVersion: 7 })
    await Reflect.apply(value.bindPhone as (...args: unknown[]) => Promise<void>, value, [{ detail: { code: 'phone-authorization-code' } }])
    expect(value.data).toMatchObject(draft)
    expect(value.data).toMatchObject({ profileVersion: 8, phoneBound: true, phoneMasked: '138****5678', previewPhone: '138****5678', phoneBinding: false })
    expect(identity.rebindWechatPhone).toHaveBeenCalledWith('phone-authorization-code')
  })
})
