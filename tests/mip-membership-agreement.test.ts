import { describe, expect, it } from 'vitest'
import { createMipIdentityGateway } from '../src/modules/mip-identity/gateway'

describe('membership agreement response contract', () => {
  it('reads nonempty configured text and strips unrelated settings', async () => {
    const data = { title: '会员协议', body: '第一条\n第二条', isDemo: true, version: 3, updatedAt: '2026-09-26', internal: 'hidden' }
    const gateway = createMipIdentityGateway({ invoke: async (request) => {
      expect(request.action).toBe('getMembershipAgreement')
      return { ok: true, data }
    } })
    expect(await gateway.getMembershipAgreement()).toEqual({ title: data.title, body: data.body, isDemo: true, version: 3, updatedAt: data.updatedAt })
  })
  it('rejects malformed content instead of presenting it as a valid agreement', async () => {
    const gateway = createMipIdentityGateway({ invoke: async () => ({ ok: true, data: { title: '协议', body: 123, version: -1 } }) })
    await expect(gateway.getMembershipAgreement()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
  it('requests the configured user document rather than the membership document', async () => {
    const gateway = createMipIdentityGateway({ invoke: async (request) => {
      expect(request.input).toEqual({ document: 'user' })
      return { ok: true, data: { title: '用户使用协议（演示）', body: '后台正文', isDemo: true, version: 1, updatedAt: '' } }
    } })
    expect((await gateway.getMembershipAgreement('user')).body).toBe('后台正文')
  })
})
