import type { AdminExportTicket } from './types'

const STORAGE_KEY = 'mip:admin-export-pending:v1'
const ticketIdPattern = /^[\w-]{1,36}$/
const tokenPattern = /^[\w-]{32,96}$/
const persistedKeys = new Set(['version', 'ticketId', 'token', 'expiresAt'])

export interface PendingAdminExport {
  version: 1
  ticketId: string
  token: string
  expiresAt: string
}

export interface PendingAdminExportStorage {
  read: (key: string) => unknown
  write: (key: string, value: PendingAdminExport) => void
  clear: (key: string) => void
}

export interface PendingAdminExportScheduler {
  set: (callback: () => void, delayMs: number) => unknown
  clear: (handle: unknown) => void
}

export interface PendingAdminExportStore {
  save: (ticket: AdminExportTicket) => PendingAdminExport | null
  peek: () => PendingAdminExport | null
  clear: (ticketId?: string) => void
}

function validPendingExport(value: unknown, now: number): value is PendingAdminExport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const candidate = value as Partial<PendingAdminExport>
  const expiresAt = Date.parse(String(candidate.expiresAt || ''))
  return Object.keys(value).every(key => persistedKeys.has(key))
    && Object.keys(value).length === persistedKeys.size
    && candidate.version === 1
    && typeof candidate.ticketId === 'string'
    && ticketIdPattern.test(candidate.ticketId)
    && typeof candidate.token === 'string'
    && tokenPattern.test(candidate.token)
    && typeof candidate.expiresAt === 'string'
    && Number.isFinite(expiresAt)
    && expiresAt > now
}

export function createPendingAdminExportStore(
  storage: PendingAdminExportStorage,
  now: () => number = () => Date.now(),
  scheduler?: PendingAdminExportScheduler,
): PendingAdminExportStore {
  let fallback: PendingAdminExport | null = null
  let cleanupHandle: unknown
  let peek: () => PendingAdminExport | null

  function cancelCleanup() {
    if (cleanupHandle !== undefined) {
      scheduler?.clear(cleanupHandle)
      cleanupHandle = undefined
    }
  }

  function clearStorage() {
    cancelCleanup()
    fallback = null
    try {
      storage.clear(STORAGE_KEY)
    }
    catch {}
  }

  function scheduleCleanup(pending: PendingAdminExport) {
    cancelCleanup()
    if (!scheduler) {
      return
    }
    cleanupHandle = scheduler.set(() => {
      cleanupHandle = undefined
      peek()
    }, Math.max(0, Date.parse(pending.expiresAt) - now()))
  }

  peek = function peekPendingExport() {
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
    if (!validPendingExport(value, now())) {
      if (value !== undefined && value !== null && value !== '') {
        clearStorage()
      }
      return null
    }
    fallback = value
    scheduleCleanup(value)
    return { ...value }
  }

  return {
    save(ticket) {
      const pending: PendingAdminExport = {
        version: 1,
        ticketId: ticket.ticketId,
        token: ticket.token,
        expiresAt: ticket.expiresAt,
      }
      // Recovery needs the opaque token, so the durable record is restricted to this exact allowlist.
      if (!validPendingExport(pending, now())) {
        clearStorage()
        return null
      }
      fallback = pending
      try {
        storage.write(STORAGE_KEY, pending)
      }
      catch {}
      scheduleCleanup(pending)
      return { ...pending }
    },
    peek,
    clear(ticketId) {
      if (!ticketId || peek()?.ticketId === ticketId) {
        clearStorage()
      }
    },
  }
}

export const _pendingAdminExportTest = { STORAGE_KEY }
