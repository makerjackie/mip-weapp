import { describe, expect, it, vi } from 'vitest'
import { createMipIdentityCloudbaseTransport } from '../src/modules/mip-identity/cloudbase-gateway'

const harness = vi.hoisted(() => ({ callFunction: vi.fn(), downloadFile: vi.fn() }))
vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: async () => harness }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: { cloudbase: { identityFunctionName: 'mip-identity-api' } } }))

describe('identity access critical path', () => {
  it('returns identity facts before an avatar download can block navigation', async () => {
    const envelope = { ok: true, data: { authenticated: true, profile: { avatarUrl: 'cloud://mip-test/avatars/user.png' } } }
    harness.callFunction.mockResolvedValue({ result: envelope })
    harness.downloadFile.mockReturnValue(new Promise(() => {}))
    const transport = createMipIdentityCloudbaseTransport()
    await expect(transport.invoke({ contractVersion: 1, action: 'getAccessSnapshot', input: {} })).resolves.toEqual(envelope)
    expect(harness.downloadFile).not.toHaveBeenCalled()
  })
})
