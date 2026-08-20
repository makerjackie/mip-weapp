import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  AdminDtoError,
  parseAdminEventCancelResult,
  parseAdminEventItem,
  parseAdminEventList,
  parseAdminEventSaveResult,
  parseAdminEventStatusResult,
} from '../src/modules/admin/event-dto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: '公开沙龙',
    description: '说明',
    notices: '须知',
    registrationSchema: [],
    formVersion: 1,
    albumEnabled: true,
    albumRequiresReview: true,
    startsAt: '2027-01-02T02:00:00.000Z',
    endsAt: '2027-01-02T04:00:00.000Z',
    registrationDeadline: null,
    venueName: '场地',
    address: '地址',
    location: '上海',
    capacity: 20,
    cancellationPolicy: '',
    coverAssetId: null,
    coverUrl: '',
    version: 2,
    memberFree: false,
    priceCents: 0,
    activityType: 'PUBLIC_FREE',
    status: 'DRAFT',
    cancelledAt: null,
    cancellationReason: null,
    ...overrides,
  }
}

describe('admin event client contract', () => {
  it('exposes complete free-event DTO fields in admin types', () => {
    const types = read('src/modules/admin/types.ts')
    expect(types).toContain('export type ActivityType = \'PUBLIC_FREE\' | \'MEMBER_INCLUDED\' | \'PAID\'')
    expect(types).toContain('endsAt: string')
    expect(types).toContain('registrationDeadline: string | null')
    expect(types).toContain('venueName: string')
    expect(types).toContain('address: string')
    expect(types).toContain('cancellationPolicy: string')
    expect(types).toContain('coverAssetId: string | null')
    expect(types).toContain('version: number')
    expect(types).toContain('activityType: ActivityType')
    expect(types).toContain('export interface AdminEventDraft')
    expect(types).toContain('expectedVersion: number')
    expect(types).toContain('AdminEventStatusResult')
  })

  it('invalidates admin and member event caches after event mutations', () => {
    const clientSource = read('src/modules/admin/client.ts')
    expect(clientSource).toContain('cache.invalidate(\'events\')')
    expect(clientSource).toContain('cache.invalidate(\'dashboard\')')
    expect(clientSource).toContain('cache.invalidate(\'audit\')')
    expect(clientSource).toContain('membershipModule.invalidateEventCaches()')
    expect(clientSource).toContain('saveEvent')
    expect(clientSource).toContain('setEventStatus')
    expect(clientSource).toContain('expectedVersion')
    expect(clientSource).toContain('cancelEvent')
    expect(clientSource).toContain('invalidateAdminEventCaches')
  })

  it('keeps admin events route and full authoring fields in source', () => {
    const appJson = JSON.parse(read('src/app.json'))
    const adminPackage = appJson.subPackages?.find((item: { root: string }) => item.root === 'packages/admin')
    expect(adminPackage?.pages || []).toContain('events/index')

    const pageTs = read('src/packages/admin/events/index.ts')
    const pageWxml = read('src/packages/admin/events/index.wxml')
    const gateway = read('src/modules/admin/cloudbase-gateway.ts')

    expect(gateway).toContain('AdminGatewayError')
    expect(gateway).toContain('parseAdminEventList')
    expect(gateway).toContain('expectedVersion')
    expect(read('src/modules/admin/event-dto.ts')).toContain('parseAdminEventItem')
    expect(pageTs).toContain('EVENT_VERSION_CONFLICT')
    expect(pageTs).toContain('activityType')
    expect(pageTs).toContain('registrationDeadline')
    expect(pageTs).toContain('cancellationPolicy')
    expect(pageTs).toContain('version')
    expect(pageTs).toContain('if (this.data.conflict)')
    expect(pageTs).toContain('refreshAfterConflict')
    expect(pageTs).toContain('applyEventToForm(latest)')
    expect(pageTs).toContain('adminModule.setEventStatus(')
    expect(pageTs).toContain('selected.version || 1')
    expect(pageTs).not.toMatch(/setData\(\{\s*version:\s*latest\.version/)
    expect(pageWxml).toContain('公开免费')
    expect(pageWxml).toContain('会员包含')
    expect(pageWxml).toContain('独立付费')
    expect(pageWxml).toContain('刷新并载入最新版本')
    expect(pageWxml).toContain('box-border')
    expect(pageWxml).toContain('max-w-full')
    expect(pageWxml).toContain('报名截止')
    expect(pageWxml).toContain('取消规则')
    expect(pageWxml).not.toMatch(/class="[^"]*\{\{/)
  })
})

describe('admin event DTO parsers', () => {
  it('decodes valid list/save/status/cancel payloads from unknown', () => {
    const item = parseAdminEventItem(validEvent({ activityType: 'MEMBER_INCLUDED', memberFree: true }))
    expect(item.activityType).toBe('MEMBER_INCLUDED')
    expect(item.memberFree).toBe(true)
    expect(parseAdminEventList([validEvent()])).toHaveLength(1)
    expect(parseAdminEventSaveResult({ id: validEvent().id, version: 3 })).toEqual({
      id: validEvent().id,
      version: 3,
    })
    expect(parseAdminEventStatusResult({
      id: validEvent().id,
      status: 'PUBLISHED',
      version: 4,
    })).toEqual({
      id: validEvent().id,
      status: 'PUBLISHED',
      version: 4,
    })
    expect(parseAdminEventCancelResult({
      id: validEvent().id,
      status: 'CANCELLED',
      version: 5,
      cancelledAt: '2027-01-01T00:00:00.000Z',
      cancellationReason: '场地问题',
      affectedCount: 2,
    }).affectedCount).toBe(2)
  })

  it('turns malformed ok:true business payloads into INVALID_RESPONSE', () => {
    expect(() => parseAdminEventList({ items: [] })).toThrowError(/INVALID_RESPONSE|无效/)
    expect(() => parseAdminEventItem(validEvent({ version: 0 }))).toThrow(AdminDtoError)
    expect(() => parseAdminEventSaveResult({ id: 'x' })).toThrow(AdminDtoError)
    expect(() => parseAdminEventStatusResult({ id: validEvent().id, status: 'CANCELLED', version: 1 }))
      .toThrow(AdminDtoError)
    try {
      parseAdminEventItem({ title: 'nope' })
    }
    catch (error) {
      expect(error).toBeInstanceOf(AdminDtoError)
      expect((error as AdminDtoError).code).toBe('INVALID_RESPONSE')
    }
  })

  it('rejects illegal price/member_free combinations instead of PUBLIC_FREE fallback', () => {
    expect(() => parseAdminEventItem(validEvent({
      activityType: 'PUBLIC_FREE',
      memberFree: true,
      priceCents: 100,
    }))).toThrow(/EVENT_DATA_INTEGRITY|非法|不一致/)
    expect(() => parseAdminEventItem(validEvent({
      activityType: 'MEMBER_INCLUDED',
      memberFree: false,
      priceCents: 0,
    }))).toThrow(AdminDtoError)
  })
})

describe('admin event conflict save gate', () => {
  it('blocks a second save after conflict until refreshAfterConflict applies latest content', async () => {
    class ConflictError extends Error {
      code = 'EVENT_VERSION_CONFLICT'
    }
    const saveEvent = vi.fn(async () => {
      throw new ConflictError('conflict')
    })
    const listEvents = vi.fn(async () => [validEvent({
      id: '11111111-1111-4111-8111-111111111111',
      title: '最新标题',
      version: 9,
      activityType: 'PUBLIC_FREE',
      memberFree: false,
      priceCents: 0,
      status: 'DRAFT',
      startsAt: '2027-02-01T10:00:00.000Z',
      endsAt: '2027-02-01T12:00:00.000Z',
      registrationDeadline: null,
      venueName: '新场地',
      address: '新地址',
      location: '新地点',
      capacity: 40,
      cancellationPolicy: '新规则',
      description: '新说明',
      coverAssetId: null,
      cancelledAt: null,
      cancellationReason: null,
    })])

    const page: any = {
      data: {
        saving: false,
        conflict: false,
        editingId: '11111111-1111-4111-8111-111111111111',
        version: 2,
        title: '本地未保存标题',
        activityType: 'PUBLIC_FREE',
        eventDate: '2027-01-02',
        eventTime: '19:30',
        endDate: '2027-01-02',
        endTime: '21:00',
        hasDeadline: false,
        deadlineDate: '2027-01-02',
        deadlineTime: '18:00',
        venueName: '本地场地',
        address: '本地地址',
        capacity: '30',
        cancellationPolicy: '',
        description: '本地说明',
        coverAssetId: '',
        message: '',
        events: [],
        state: 'ready',
      },
      setData(patch: Record<string, unknown>) {
        Object.assign(this.data, patch)
      },
    }

    // Minimal behavioral harness matching the page gate order.
    async function saveDraft() {
      if (page.data.saving) {
        return
      }
      if (page.data.conflict) {
        page.setData({ message: '版本冲突未解决。请先点击「刷新并载入最新版本」，再保存。' })
        return
      }
      page.setData({ saving: true, message: '' })
      try {
        await saveEvent({
          id: page.data.editingId,
          version: page.data.version,
          title: page.data.title,
        })
      }
      catch (error) {
        if (error instanceof ConflictError && error.code === 'EVENT_VERSION_CONFLICT') {
          page.setData({
            conflict: true,
            message: '活动已被其他人更新。你的输入已保留；必须刷新并载入最新版本后才能再次保存。',
          })
          const events = await listEvents()
          page.setData({ events })
          // Intentionally do not merge latest.version into the stale form.
          return
        }
        throw error
      }
      finally {
        page.setData({ saving: false })
      }
    }

    async function refreshAfterConflict() {
      const events = await listEvents()
      page.setData({ events })
      const latest = page.data.events.find((item: { id: string }) => item.id === page.data.editingId)
      page.setData({
        title: latest.title,
        version: latest.version,
        conflict: false,
        message: '已载入最新版本，请确认内容后再次保存。',
      })
    }

    await saveDraft()
    expect(saveEvent).toHaveBeenCalledTimes(1)
    expect(page.data.conflict).toBe(true)
    expect(page.data.version).toBe(2)
    expect(page.data.title).toBe('本地未保存标题')

    await saveDraft()
    expect(saveEvent).toHaveBeenCalledTimes(1)
    expect(page.data.message).toContain('版本冲突未解决')

    await refreshAfterConflict()
    expect(page.data.conflict).toBe(false)
    expect(page.data.version).toBe(9)
    expect(page.data.title).toBe('最新标题')

    saveEvent.mockResolvedValueOnce({ id: page.data.editingId, version: 10 })
    await saveDraft()
    expect(saveEvent).toHaveBeenCalledTimes(2)
  })
})

describe('activity operations migration recovery contract (static)', () => {
  it('defines information_schema recovery helpers and reset token', () => {
    const schemaHelper = read('scripts/lib/activity-operations-schema.mjs')
    const verifyMysql = read('scripts/verify-mysql.mjs')
    const applyMysql = read('scripts/apply-mysql-schema.mjs')
    expect(schemaHelper).toContain('inspectActivityOperations')
    expect(schemaHelper).toContain('ensureActivityOperations')
    expect(schemaHelper).toContain('MEMBERSHIP_TEST_RESET_TOKEN')
    expect(schemaHelper).toContain('membership-test-reset')
    expect(verifyMysql).toContain('MEMBERSHIP_TEST_RESET_TOKEN')
    expect(verifyMysql).toContain('ensureActivityOperations')
    expect(verifyMysql).toContain('001 probe')
    expect(verifyMysql).toContain('002 rollback')
    expect(applyMysql).toContain('ensureActivityOperationsRemote')
    expect(applyMysql).toContain('inspectActivityOperationsRemote')
    expect(applyMysql).toContain('information_schema')
    expect(applyMysql).toContain('tc.constraint_name AS name')
    expect(applyMysql).toContain('all 18 objects')
    expect(applyMysql).toContain('if (state.complete)')
    expect(applyMysql).toContain('verified and recorded')
  })
})
