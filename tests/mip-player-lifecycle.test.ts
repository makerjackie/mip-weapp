import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createAdminUserListRequest,
  parseAdminUserPage,
} from '../src/modules/mip-admin/user-records'

const root = path.resolve(import.meta.dirname, '..')

const user = {
  id: 'user-a',
  status: 'ACTIVE',
  kind: 'PLAYER',
  nickname: '用户',
  headline: '',
  introduction: '',
  primaryBranchId: null,
  branchName: '',
  cityName: '',
  phoneBound: false,
  phoneNumber: null,
  controls: [],
  levelId: null,
  levelName: '',
  experience: 0,
  visibility: {},
  userVersion: 1,
  profileVersion: 0,
  createdAt: null,
  updatedAt: null,
  playerNumber: 7,
  firstPlayerAt: '2026-01-01T00:00:00.000Z',
  latestEntitlementEndsAt: '2026-12-31T00:00:00.000Z',
  totalValidMembershipSeconds: 31_536_000,
}

describe('player lifecycle contract', () => {
  it('validates lifecycle filtering without accepting identity input', () => {
    expect(createAdminUserListRequest({
      filters: { playerLifecycle: 'FORMER' },
    })).toEqual({ filters: { playerLifecycle: 'FORMER' } })
    expect(() => createAdminUserListRequest({ filters: { playerLifecycle: 'UNKNOWN' } }))
      .toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }))
    expect(() => parseAdminUserPage({ items: [{ ...user, playerNumber: 0 }], nextCursor: null }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_RESPONSE' }))
    expect(parseAdminUserPage({ items: [user], nextCursor: null })).toEqual({
      items: [user],
      nextCursor: null,
    })
  })

  it('keeps the lifecycle facts in an append-only, app-scoped migration', () => {
    const migration = fs.readFileSync(
      path.join(root, 'database/mysql/mip/048_player_lifecycle.sql'),
      'utf8',
    )
    expect(migration).toContain('mip_player_lifecycles_number_uk')
    expect(migration).toContain('ROW_NUMBER() OVER')
    expect(migration).toContain('status IN (\'ACTIVE\', \'EXPIRED\')')
    expect(migration).not.toMatch(/\b(?:member|dating|sewing)_/i)
  })
})
