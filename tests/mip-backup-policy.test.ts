import { describe, expect, it } from 'vitest'
import {
  assertBackupCompletedWithinMaxAge,
  DEFAULT_BACKUP_MAX_AGE_HOURS,
  MAX_BACKUP_MAX_AGE_HOURS,
  MIN_BACKUP_MAX_AGE_HOURS,
  resolveBackupMaxAgeHours,
} from '../scripts/lib/mip-backup-policy.mjs'

const nowMs = Date.parse('2026-08-25T16:00:00.000Z')
const hoursBeforeNow = (hours: number) => new Date(nowMs - hours * 3_600_000).toISOString()

describe('MIP database backup maximum age option', () => {
  it('keeps 24 hours as the strict default', () => {
    expect(resolveBackupMaxAgeHours()).toBe(DEFAULT_BACKUP_MAX_AGE_HOURS)
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: hoursBeforeNow(24.01),
      nowMs,
    })).toThrow('within the last 24 hours')
  })

  it('allows an explicit 72-hour maximum age', () => {
    const maxAgeHours = resolveBackupMaxAgeHours(['--backup-max-age-hours=72'])
    expect(maxAgeHours).toBe(72)
    expect(assertBackupCompletedWithinMaxAge({
      completedAt: hoursBeforeNow(28),
      maxAgeHours,
      nowMs,
    })).toMatchObject({ maxAgeHours: 72 })
  })

  it('rejects a backup older than the explicit maximum', () => {
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: hoursBeforeNow(72.01),
      maxAgeHours: 72,
      nowMs,
    })).toThrow('within the last 72 hours')
  })

  it('rejects an invalid or materially future completion time', () => {
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: 'not-a-timestamp',
      nowMs,
    })).toThrow('invalid completion time')
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: new Date(nowMs + 300_001).toISOString(),
      nowMs,
    })).toThrow('completion time is in the future')
  })

  it('accepts inclusive age and option boundaries', () => {
    expect(resolveBackupMaxAgeHours([
      `--backup-max-age-hours=${MIN_BACKUP_MAX_AGE_HOURS}`,
    ])).toBe(MIN_BACKUP_MAX_AGE_HOURS)
    expect(resolveBackupMaxAgeHours([
      `--backup-max-age-hours=${MAX_BACKUP_MAX_AGE_HOURS}`,
    ])).toBe(MAX_BACKUP_MAX_AGE_HOURS)
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: hoursBeforeNow(MAX_BACKUP_MAX_AGE_HOURS),
      maxAgeHours: MAX_BACKUP_MAX_AGE_HOURS,
      nowMs,
    })).not.toThrow()
    expect(() => assertBackupCompletedWithinMaxAge({
      completedAt: new Date(nowMs + 300_000).toISOString(),
      nowMs,
    })).not.toThrow()
  })

  it.each([
    ['--backup-max-age-hours=23'],
    ['--backup-max-age-hours=169'],
    ['--backup-max-age-hours=72.5'],
    ['--backup-max-age-hours='],
    ['--backup-max-age-hours=-72'],
    ['--backup-max-age-hours'],
    ['--backup-max-age-hours=72', '--backup-max-age-hours=96'],
  ])('rejects an illegal option: %j', (...argv) => {
    expect(() => resolveBackupMaxAgeHours(argv)).toThrow()
  })
})
