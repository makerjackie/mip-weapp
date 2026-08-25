import type {
  IdentityAccessSnapshot,
  MipIdentityAction,
  MipIdentityRequest,
  ProfileUpdateInput,
} from '../src/modules/mip-identity'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMipIdentityCloudbaseTransport } from '../src/modules/mip-identity/cloudbase-gateway'
import { createMipIdentityGateway } from '../src/modules/mip-identity/gateway'
import { isRetryableIdentityAction } from '../src/modules/mip-identity/retry-policy'

const cloudHarness = vi.hoisted(() => ({
  callFunction: vi.fn(),
}))

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(async () => ({ callFunction: cloudHarness.callFunction })),
}))

vi.mock('../src/modules/platform/cloud-media', () => ({
  resolveCloudFileUrls: (value: unknown) => value,
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { identityFunctionName: 'mip-identity-api' } },
}))

const profile = {
  exists: true,
  version: 2,
  nickname: '测试用户',
  avatarBound: false,
  identityStatus: '',
  headline: '',
  introduction: '',
  companies: [],
  organizations: [],
  visibility: {
    headline: true,
    introduction: true,
    companies: true,
    organizations: true,
  },
  abilityTagIds: [],
  complete: true,
  missingFields: [],
} satisfies IdentityAccessSnapshot['profile']

const snapshot = {
  authenticated: true,
  userVersion: 3,
  userStatus: 'ACTIVE',
  phoneBound: true,
  agreements: [],
  profile,
  membership: { kind: 'GUEST', source: 'NONE' },
  grants: [],
} satisfies IdentityAccessSnapshot

const profileRef = `p1.${'a'.repeat(16)}.${'b'.repeat(48)}.${'c'.repeat(22)}`

const profileInput = {
  expectedVersion: 2,
  nickname: '测试用户',
  identityStatus: '',
  headline: '',
  introduction: '',
  companies: [],
  organizations: [],
  visibility: {
    headline: true,
    introduction: true,
    companies: true,
    organizations: true,
  },
  abilityTagIds: [],
} satisfies ProfileUpdateInput

function responseFor(action: MipIdentityAction) {
  if (action === 'closeAccount') {
    return {
      status: 'CLOSED',
      version: 4,
      closedAt: '2026-08-25T00:00:00.000Z',
      idempotent: false,
    }
  }
  if (action === 'getProfile') {
    return profile
  }
  if (action === 'getPublicProfile') {
    return { profileRef, isSelf: false }
  }
  if (action === 'listBranches' || action === 'listProfileTags') {
    return []
  }
  if (action === 'setPrimaryBranch') {
    return { branches: [], userVersion: 4 }
  }
  return snapshot
}

afterEach(() => {
  cloudHarness.callFunction.mockReset()
  vi.useRealTimers()
})

describe('MIP identity v1 client contract', () => {
  it('sends all ten actions as direct business input in the neutral envelope', async () => {
    const calls: MipIdentityRequest[] = []
    const gateway = createMipIdentityGateway({
      async invoke(request) {
        calls.push(request)
        return { ok: true, data: responseFor(request.action) }
      },
    })

    await gateway.getAccessSnapshot()
    await gateway.acceptAgreements({ agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] })
    await gateway.bindWechatPhone('wx-phone-code')
    await gateway.closeAccount({
      confirmationPhrase: '确认注销账号',
      expectedVersion: 3,
      idempotencyKey: 'identity-close-request-1',
    })
    await gateway.getProfile()
    await gateway.getPublicProfile(profileRef)
    await gateway.updateProfile(profileInput)
    await gateway.listProfileTags()
    await gateway.listBranches()
    await gateway.setPrimaryBranch({
      branchId: '20000000-0000-4000-8000-000000000001',
      expectedVersion: 3,
    })

    expect(calls.map(call => call.action)).toEqual([
      'getAccessSnapshot',
      'acceptAgreements',
      'bindWechatPhone',
      'closeAccount',
      'getProfile',
      'getPublicProfile',
      'updateProfile',
      'listProfileTags',
      'listBranches',
      'setPrimaryBranch',
    ])
    expect(calls.every(call => call.contractVersion === 1)).toBe(true)
    expect(calls[1]).toEqual({
      contractVersion: 1,
      action: 'acceptAgreements',
      input: { agreements: [{ key: 'SERVICE_AGREEMENT', version: '1' }] },
    })
    expect(calls[2]).toEqual({
      contractVersion: 1,
      action: 'bindWechatPhone',
      input: { code: 'wx-phone-code' },
    })
    expect(calls[6]?.input).toEqual(profileInput)
    expect(calls[9]).toEqual({
      contractVersion: 1,
      action: 'setPrimaryBranch',
      input: {
        branchId: '20000000-0000-4000-8000-000000000001',
        expectedVersion: 3,
      },
    })
    expect(calls.some(call => Object.hasOwn(call.input, 'input'))).toBe(false)
  })

  it('limits cold-start retries to the five identity reads', () => {
    const reads = [
      'getAccessSnapshot',
      'getProfile',
      'getPublicProfile',
      'listBranches',
      'listProfileTags',
    ] satisfies MipIdentityAction[]
    const writes = [
      'acceptAgreements',
      'bindWechatPhone',
      'closeAccount',
      'updateProfile',
      'setPrimaryBranch',
    ] satisfies MipIdentityAction[]

    expect(reads.every(isRetryableIdentityAction)).toBe(true)
    expect(writes.some(isRetryableIdentityAction)).toBe(false)
  })

  it('retries a failed CloudBase read but sends a phone mutation only once', async () => {
    vi.useFakeTimers()
    const transport = createMipIdentityCloudbaseTransport('mip-identity-api')
    cloudHarness.callFunction
      .mockRejectedValueOnce(new Error('cold start'))
      .mockResolvedValueOnce({ result: { ok: true, data: snapshot } })

    const read = transport.invoke({
      contractVersion: 1,
      action: 'getAccessSnapshot',
      input: {},
    })
    await vi.runAllTimersAsync()
    await expect(read).resolves.toEqual({ ok: true, data: snapshot })
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(2)
    expect(cloudHarness.callFunction).toHaveBeenLastCalledWith({
      name: 'mip-identity-api',
      data: { contractVersion: 1, action: 'getAccessSnapshot', input: {} },
    })

    cloudHarness.callFunction.mockReset()
    cloudHarness.callFunction.mockRejectedValue(new Error('transport unavailable'))
    await expect(transport.invoke({
      contractVersion: 1,
      action: 'bindWechatPhone',
      input: { code: 'one-shot-code' },
    })).rejects.toThrow('身份服务暂时不可用')
    expect(cloudHarness.callFunction).toHaveBeenCalledTimes(1)
    expect(cloudHarness.callFunction).toHaveBeenCalledWith({
      name: 'mip-identity-api',
      data: {
        contractVersion: 1,
        action: 'bindWechatPhone',
        input: { code: 'one-shot-code' },
      },
    })
  })

  it('does not add logging or storage seams around sensitive identity requests', () => {
    const sources = [
      'src/modules/mip-identity/gateway.ts',
      'src/modules/mip-identity/cloudbase-gateway.ts',
      'src/modules/mip-identity/retry-policy.ts',
    ].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')).join('\n')

    expect(sources).not.toMatch(/console\.|setStorage|getStorage|removeStorage/)
    expect(sources).not.toMatch(/JSON\.stringify\([^)]*(?:code|phone)/i)
  })
})
