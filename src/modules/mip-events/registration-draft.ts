export const REGISTRATION_DRAFT_STORAGE_KEY = 'mip:event-registration-drafts:v1'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

interface RegistrationDraft {
  userId: string
  eventId: string
  registrationVersion: number | null
  answers: Record<string, string | boolean>
  shareProfile: boolean
  savedAt: number
}

export function createRegistrationDraftStore(storage: {
  read: (key: string) => unknown
  write: (key: string, value: unknown) => void
  clear: (key: string) => void
}, now = Date.now) {
  function read(): RegistrationDraft[] {
    try {
      const value = storage.read(REGISTRATION_DRAFT_STORAGE_KEY)
      return Array.isArray(value)
        ? value.filter((item): item is RegistrationDraft =>
            item && typeof item.userId === 'string' && typeof item.eventId === 'string'
            && typeof item.savedAt === 'number' && item.savedAt <= now() && now() - item.savedAt < MAX_AGE_MS
            && (item.registrationVersion === null || Number.isInteger(item.registrationVersion))
            && typeof item.shareProfile === 'boolean'
            && item.answers && typeof item.answers === 'object' && !Array.isArray(item.answers)
            && Object.values(item.answers).every(answer => typeof answer === 'string' || typeof answer === 'boolean'))
        : []
    }
    catch { return [] }
  }
  function write(drafts: RegistrationDraft[]) {
    try {
      storage.write(REGISTRATION_DRAFT_STORAGE_KEY, drafts)
    }
    catch {
      // Storage failure must not prevent registration.
    }
  }
  return {
    load(userId: string, eventId: string, registrationVersion: number | null) {
      return read().find(item => item.userId === userId && item.eventId === eventId
        && item.registrationVersion === registrationVersion) || null
    },
    save(draft: Omit<RegistrationDraft, 'savedAt'>) {
      if (!draft.userId || !draft.eventId) {
        return
      }
      write([...read().filter(item => item.userId === draft.userId && item.eventId !== draft.eventId), { ...draft, savedAt: now() }].slice(-10))
    },
    remove(userId: string, eventId: string) {
      write(read().filter(item => item.userId !== userId || item.eventId !== eventId))
    },
    clear() {
      try {
        storage.clear(REGISTRATION_DRAFT_STORAGE_KEY)
      }
      catch {
        // Optional local drafts must not block sign-out.
      }
    },
  }
}
