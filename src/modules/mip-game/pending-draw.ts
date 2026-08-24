const STORAGE_PREFIX = 'mip:blind-box-pending-draw:v1'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BlindBoxPendingDrawStorage {
  read: (key: string) => unknown
  write: (key: string, value: string) => void
  clear: (key: string) => void
}

export function shouldRetainPendingDraw(error: unknown) {
  return (error as { code?: string })?.code === 'SERVICE_UNAVAILABLE'
}

function storageKey(userId: string, catalogId: string) {
  if (!uuidPattern.test(userId) || !uuidPattern.test(catalogId)) {
    throw new Error('INVALID_PENDING_DRAW_SCOPE')
  }
  return `${STORAGE_PREFIX}:${userId}:${catalogId}`
}

export function createBlindBoxPendingDrawStore(storage: BlindBoxPendingDrawStorage) {
  function read(userId: string, catalogId: string) {
    const key = storageKey(userId, catalogId)
    const value = storage.read(key)
    if (typeof value === 'string' && uuidPattern.test(value)) {
      return value
    }
    if (value !== undefined && value !== null && value !== '') {
      storage.clear(key)
    }
    return ''
  }

  return {
    read,
    ensure(userId: string, catalogId: string, createId: () => string) {
      const existing = read(userId, catalogId)
      if (existing) {
        return existing
      }
      const requestId = createId()
      if (!uuidPattern.test(requestId)) {
        throw new Error('INVALID_PENDING_DRAW_REQUEST')
      }
      storage.write(storageKey(userId, catalogId), requestId)
      return requestId
    },
    clear(userId: string, catalogId: string, expectedRequestId: string) {
      const key = storageKey(userId, catalogId)
      if (read(userId, catalogId) === expectedRequestId) {
        storage.clear(key)
      }
    },
  }
}

export const _pendingDrawTest = { storageKey }
