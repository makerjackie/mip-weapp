import { describe, expect, it, vi } from 'vitest'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'

vi.mock('../src/platform/cloudbase/client', () => ({ requireCloudClient: vi.fn() }))
vi.mock('../src/config/runtime', () => ({ runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } } }))

// Mirrors repositories/events.listRoster + events.listRoster's public projection.
const row = {
  id: '11111111-1111-4111-8111-111111111111',
  nickname: '活动参与者',
  cityName: '广州',
  status: 'REGISTERED',
  registrationStatus: 'REGISTERED',
  source: 'USER',
  roleMark: null,
  importedAt: null,
  abnormalReason: '',
  abnormalMarkedAt: null,
  answers: { company: '示例公司' },
  answerItems: [{ key: 'company', label: '公司', value: '示例公司' }],
  phoneBound: true,
  phoneNumber: null,
  submittedAt: '2026-09-26T00:00:00.000Z',
  registeredAt: '2026-09-26T00:00:00.000Z',
  checkedInAt: null,
  version: 1,
}

describe('onsite nonempty roster response', () => {
  it.each(['REGISTERED', 'ATTENDED', 'ABNORMAL'])('accepts current server metadata with status %s', async (status) => {
    const gateway = createMipAdminGateway({ request: vi.fn(async () => ({ items: [{ ...row, status }], nextCursor: 'next' })) })
    const result = await gateway.listRoster({ eventId: row.id, includePhone: false })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ nickname: row.nickname, status, answerItems: row.answerItems })
    expect(result.items[0]).not.toHaveProperty('abnormalReason')
    expect(result.items[0]).not.toHaveProperty('source')
    expect(result.nextCursor).toBe('next')
  })

  it.each([
    { phoneCiphertext: 'private' },
    { userId: 'private' },
    { answerItems: [{ key: 'company', label: '公司', value: 123 }] },
    { status: 'INVALID' },
  ])('continues to reject private or malformed response fields', async (patch) => {
    const gateway = createMipAdminGateway({ request: vi.fn(async () => ({ items: [{ ...row, ...patch }], nextCursor: null })) })
    await expect(gateway.listRoster({ eventId: row.id })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
