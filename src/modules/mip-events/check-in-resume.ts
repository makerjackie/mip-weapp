import type { CheckInScene } from './types'

const STORAGE_KEY = 'mip:event-check-in-resume:v2'
const LEGACY_STORAGE_KEY = 'mip:event-check-in-resume:v1'
const LOCAL_RESUME_TTL_MS = 30 * 60 * 1000
const resumeTokenPattern = /^[\w-]{20,2048}\.[\w-]{43}$/

export interface CheckInResumeIntent {
  eventId: string
  resumeToken: string
  validUntil: string
  expiresAt: number
}

export interface CheckInResumeStorage {
  read: (key: string) => unknown
  write: (key: string, value: CheckInResumeIntent) => void
  clear: (key: string) => void
}

export interface CheckInResumeScheduler {
  set: (callback: () => void, delayMs: number) => unknown
  clear: (handle: unknown) => void
}

function validIntent(value: unknown, now: number): value is CheckInResumeIntent {
  if (!value || typeof value !== 'object') {
    return false
  }
  const candidate = value as Partial<CheckInResumeIntent>
  const validUntil = Date.parse(String(candidate.validUntil || ''))
  return typeof candidate.eventId === 'string'
    && candidate.eventId.length > 0
    && candidate.eventId.length <= 64
    && typeof candidate.resumeToken === 'string'
    && resumeTokenPattern.test(candidate.resumeToken)
    && Number.isFinite(validUntil)
    && validUntil > now
    && typeof candidate.expiresAt === 'number'
    && Number.isFinite(candidate.expiresAt)
    && candidate.expiresAt > now
    && candidate.expiresAt <= validUntil
}

export function createCheckInResumeStore(
  storage: CheckInResumeStorage,
  now: () => number = () => Date.now(),
  scheduler?: CheckInResumeScheduler,
) {
  let fallback: CheckInResumeIntent | null = null
  let cleanupHandle: unknown
  let legacyStoragePruned = false
  let read: (eventId?: string) => CheckInResumeIntent | null

  function cancelScheduledCleanup() {
    if (cleanupHandle !== undefined) {
      scheduler?.clear(cleanupHandle)
      cleanupHandle = undefined
    }
  }

  function pruneLegacyStorage() {
    if (legacyStoragePruned) {
      return
    }
    try {
      storage.clear(LEGACY_STORAGE_KEY)
      legacyStoragePruned = true
    }
    catch {}
  }

  function clearStorage() {
    cancelScheduledCleanup()
    fallback = null
    try {
      storage.clear(STORAGE_KEY)
    }
    catch {}
    pruneLegacyStorage()
  }

  function scheduleCleanup(intent: CheckInResumeIntent) {
    cancelScheduledCleanup()
    if (!scheduler) {
      return
    }
    cleanupHandle = scheduler.set(() => {
      cleanupHandle = undefined
      read()
    }, Math.max(0, intent.expiresAt - now()))
  }

  read = function readIntent(eventId?: string) {
    pruneLegacyStorage()
    let value: unknown
    try {
      value = storage.read(STORAGE_KEY)
    }
    catch {
      value = fallback
    }
    if ((value === undefined || value === null || value === '') && fallback) {
      value = fallback
    }
    if (!validIntent(value, now())) {
      if (value !== undefined && value !== null && value !== '') {
        clearStorage()
      }
      return null
    }
    if (eventId && value.eventId !== eventId) {
      return null
    }
    fallback = value
    scheduleCleanup(value)
    return { ...value }
  }

  return {
    save(scene: CheckInScene) {
      const currentTime = now()
      const validUntil = Date.parse(scene.validUntil)
      if (!scene.eventId || !resumeTokenPattern.test(scene.resumeToken) || !Number.isFinite(validUntil) || validUntil <= currentTime) {
        clearStorage()
        return null
      }
      const intent: CheckInResumeIntent = {
        eventId: String(scene.eventId),
        resumeToken: scene.resumeToken,
        validUntil: scene.validUntil,
        expiresAt: Math.min(validUntil, currentTime + LOCAL_RESUME_TTL_MS),
      }
      fallback = intent
      try {
        storage.write(STORAGE_KEY, intent)
      }
      catch {}
      scheduleCleanup(intent)
      return { ...intent }
    },
    peek: read,
    prune() {
      void read()
    },
    clear(eventId?: string) {
      const current = eventId ? read(eventId) : read()
      if (!eventId || current) {
        clearStorage()
      }
    },
  }
}

export const _checkInResumeTest = { LEGACY_STORAGE_KEY, LOCAL_RESUME_TTL_MS, STORAGE_KEY }
