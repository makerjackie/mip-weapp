import type { BranchId, CityBranchSummary } from '../src/modules/mip'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  _checkInResumeTest,
  checkInCredentialCountdown,
  createCheckInResumeStore,
  decodeInvitationToken,
  eventInvitationPath,
  isEventAccessRequirementError,
  resolvePrimaryBranchCity,
  safeHttpsEventUrl,
} from '../src/modules/mip-events'

const root = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP event experience contracts', () => {
  it('selects the active primary branch city without persisting a manual page choice', () => {
    const primaryBranchId = '20000000-0000-4000-8000-000000000001' as BranchId
    const branches: CityBranchSummary[] = [{
      id: primaryBranchId,
      name: '深圳分会',
      cityName: '深圳',
      status: 'ACTIVE',
    }]
    expect(resolvePrimaryBranchCity(primaryBranchId, branches)).toBe('深圳')
    expect(resolvePrimaryBranchCity(undefined, branches)).toBe('')
    expect(resolvePrimaryBranchCity(primaryBranchId, [{ ...branches[0], status: 'INACTIVE' }])).toBe('')

    const page = source('src/pages/events/index.ts')
    expect(page).toContain('mipIdentityModule.loadSnapshot()')
    expect(page).toContain('resolvePrimaryBranchCity(snapshot.primaryBranchId')
    expect(page).toContain('cityManuallySelected = true')
    expect(page).not.toMatch(/setStorageSync|setStorage\(/)
  })

  it('revalidates cached activity feeds when a page returns to the foreground', () => {
    const eventPage = source('src/pages/events/index.ts')
    const discoverPage = source('src/pages/index/index.ts')

    expect(eventPage).toContain('force: options.force === true || Boolean(cached)')
    expect(discoverPage).toContain('force: options.force === true || Boolean(cached)')
  })

  it('accepts only HTTPS online activity addresses in the client entry', () => {
    expect(safeHttpsEventUrl('https://meeting.example.com/room')).toBe('https://meeting.example.com/room')
    expect(safeHttpsEventUrl(' http://meeting.example.com/room ')).toBe('')
    expect(safeHttpsEventUrl('https://user:secret@meeting.example.com/room')).toBe('')
    expect(safeHttpsEventUrl('javascript:alert(1)')).toBe('')

    const detail = source('src/packages/member/mip-events/detail/index.ts')
    const view = source('src/packages/member/mip-events/detail/index.wxml')
    expect(detail).toContain('safeHttpsEventUrl(this.data.event?.onlineUrl)')
    expect(detail).toContain('&online=1')
    expect(view).toContain('进入线上活动')
    expect(view).toContain('<web-view')
  })

  it('keeps the invitation route actionable and classifies identity requirements', () => {
    expect(eventInvitationPath('event 1', 'invite/value')).toBe(
      '/packages/member/mip-events/detail/index?eventId=event%201&invitationToken=invite%2Fvalue',
    )
    expect(decodeInvitationToken('invite%2Fvalue')).toBe('invite/value')
    expect(decodeInvitationToken(undefined)).toBe('')
    expect(decodeInvitationToken('%E0%A4%A')).toBe('')
    expect(decodeInvitationToken('a'.repeat(1537))).toBe('')
    expect(decodeInvitationToken('a'.repeat(1536)).length).toBe(1024)
    expect(() => eventInvitationPath(' ')).toThrow('EVENT_ID_REQUIRED')
    expect(isEventAccessRequirementError({ code: 'PHONE_REQUIRED' })).toBe(true)
    expect(isEventAccessRequirementError({ code: 'REGISTRATION_REQUIRED' })).toBe(false)
    expect(isEventAccessRequirementError(null)).toBe(false)

    const detail = source('src/packages/member/mip-events/detail/index.ts')
    expect(detail).toContain('`小程序路径：${eventInvitationPath(')
    expect(detail).toContain('requestWechatSubscription(\'CHECKIN_RESULT\')')
  })

  it('recovers protected check-in gestures and requests the result subscription per use', () => {
    const checkIn = source('src/packages/member/mip-events/check-in/index.ts')
    const checkInView = source('src/packages/member/mip-events/check-in/index.wxml')
    const registration = source('src/packages/member/mip-events/registration/index.ts')
    expect(checkIn).toContain('isEventAccessRequirementError(error)')
    expect(checkIn).toContain('action: \'INTERACT\'')
    expect(checkIn).toContain('mipCheckInResumeStore.save(this.resolvedScene)')
    expect(checkIn).toContain('resumeCheckIn: \'1\'')
    expect(checkIn).not.toMatch(/query:\s*\{[^}]*scene:/)
    expect(checkIn).not.toMatch(/check-in\/index\?[^`]*token=/)
    expect(checkIn).toContain('consumePendingResume(\'packages/member/mip-events/check-in/index\')')
    expect(checkIn).toContain('route: \'packages/member/mip-events/check-in/index\'')
    expect(checkIn).toContain('mipEventsModule.resolveCheckInScene(this.scanToken)')
    expect(checkIn).toContain('error.code === \'REGISTRATION_REQUIRED\'')
    expect(checkIn).toContain('error.code === \'REGISTRATION_PENDING\'')
    expect(checkIn).toContain('requestWechatSubscription(\'CHECKIN_RESULT\')')
    expect(registration).toContain('requestWechatSubscription(\'CHECKIN_RESULT\')')
    expect(checkInView).toContain('前往报名')
    expect(checkInView).toContain('重新核对报名')
    expect(checkInView).toContain('hasScanToken ? \'确认签到\' : \'扫描活动码\'')
  })

  it('keeps a server-resolved check-in intent only within both local and scene expiry', () => {
    const values = new Map<string, unknown>()
    let cleared = false
    let scheduled: (() => void) | undefined
    let now = Date.parse('2026-08-25T04:00:00.000Z')
    const resumeToken = `${'a'.repeat(24)}.${'b'.repeat(43)}`
    const store = createCheckInResumeStore({
      read: key => values.get(key),
      write: (key, value) => { values.set(key, value) },
      clear: (key) => {
        values.delete(key)
        if (key === _checkInResumeTest.STORAGE_KEY) {
          cleared = true
        }
      },
    }, () => now, {
      set: (callback) => {
        scheduled = callback
        return callback
      },
      clear: () => { scheduled = undefined },
    })
    const saved = store.save({
      eventId: 'event-a' as never,
      resumeToken,
      validFrom: '2026-08-25T03:00:00.000Z',
      validUntil: '2026-08-25T06:00:00.000Z',
    })

    expect(saved?.expiresAt).toBe(now + 30 * 60 * 1000)
    expect(store.peek('event-a')?.resumeToken).toBe(resumeToken)
    expect(store.peek('event-b')).toBeNull()
    expect(cleared).toBe(false)
    const stored = values.get(_checkInResumeTest.STORAGE_KEY)
    expect(stored).toEqual(expect.objectContaining({ eventId: 'event-a', resumeToken }))
    expect(stored).not.toHaveProperty('scanToken')
    expect(JSON.stringify(stored)).not.toContain('s1.')

    now = Date.parse('2026-08-25T04:31:00.000Z')
    scheduled?.()
    expect(values.get(_checkInResumeTest.STORAGE_KEY)).toBeUndefined()
    expect(cleared).toBe(true)

    const sceneBound = store.save({
      eventId: 'event-a' as never,
      resumeToken,
      validFrom: '2026-08-25T04:00:00.000Z',
      validUntil: '2026-08-25T04:35:00.000Z',
    })
    expect(sceneBound?.expiresAt).toBe(Date.parse('2026-08-25T04:35:00.000Z'))
  })

  it('prunes only the legacy raw-scene key on first read and repeated foreground pruning', () => {
    const now = Date.parse('2026-08-25T04:00:00.000Z')
    const resumeToken = `${'a'.repeat(24)}.${'b'.repeat(43)}`
    const validIntent = {
      eventId: 'event-a',
      resumeToken,
      validUntil: '2026-08-25T04:30:00.000Z',
      expiresAt: Date.parse('2026-08-25T04:30:00.000Z'),
    }
    const createStorage = (entries: Array<[string, unknown]>) => {
      const values = new Map(entries)
      const cleared: string[] = []
      return {
        values,
        cleared,
        adapter: {
          read: (key: string) => values.get(key),
          write: (key: string, value: typeof validIntent) => { values.set(key, value) },
          clear: (key: string) => {
            cleared.push(key)
            values.delete(key)
          },
        },
      }
    }

    const legacyOnly = createStorage([[
      _checkInResumeTest.LEGACY_STORAGE_KEY,
      { eventId: 'event-a', scanToken: 's1.abcdefghijk.abcdefghijk' },
    ]])
    createCheckInResumeStore(legacyOnly.adapter, () => now).prune()
    expect(legacyOnly.values.has(_checkInResumeTest.LEGACY_STORAGE_KEY)).toBe(false)

    const mixed = createStorage([
      [_checkInResumeTest.LEGACY_STORAGE_KEY, { scanToken: 's1.abcdefghijk.abcdefghijk' }],
      [_checkInResumeTest.STORAGE_KEY, validIntent],
    ])
    const store = createCheckInResumeStore(mixed.adapter, () => now)
    expect(store.peek('event-a')).toEqual(validIntent)
    store.prune()
    store.prune()
    expect(mixed.values.get(_checkInResumeTest.STORAGE_KEY)).toEqual(validIntent)
    expect(mixed.values.has(_checkInResumeTest.LEGACY_STORAGE_KEY)).toBe(false)
    expect(mixed.cleared.filter(key => key === _checkInResumeTest.LEGACY_STORAGE_KEY)).toHaveLength(1)
    expect(mixed.cleared).not.toContain(_checkInResumeTest.STORAGE_KEY)
  })

  it('rehydrates only the matching event intent from event detail entry and foreground hooks', () => {
    const detail = source('src/packages/member/mip-events/detail/index.ts')
    expect(detail).toContain('mipCheckInResumeStore.peek(String(eventId))')
    expect(detail).toContain('onShow()')
    expect(detail).toContain('this.refreshCheckInIntent()')
    expect(detail).toContain('mipCheckInResumeStore.peek(eventId)')
    expect(detail).toContain('[\'ATTENDED\', \'CANCELLATION_PENDING\', \'CANCELLED\', \'REJECTED\']')
  })

  it('formats a five-minute rotating credential countdown and exposes refresh controls', () => {
    const countdown = checkInCredentialCountdown(
      '2026-08-24T00:05:00.000Z',
      Date.parse('2026-08-24T00:00:00.000Z'),
    )
    expect(countdown).toEqual({ expired: false, remainingSeconds: 300, text: '05:00' })
    expect(checkInCredentialCountdown(
      '2026-08-24T00:05:00.000Z',
      Date.parse('2026-08-24T00:05:00.001Z'),
    ).expired).toBe(true)

    const consolePage = source('src/packages/admin/event-console/index.ts')
    const consoleView = source('src/packages/admin/event-console/index.wxml')
    expect(consolePage).toContain('createCheckInPoster(\'ROTATING\')')
    expect(consolePage).toContain('startPosterCountdown')
    expect(consoleView).toContain('刷新短时码')
    expect(consoleView).toContain('posterCountdownText')
  })
})
