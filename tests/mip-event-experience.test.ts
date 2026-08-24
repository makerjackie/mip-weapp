import type { BranchId, CityBranchSummary } from '../src/modules/mip'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkInCredentialCountdown,
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
