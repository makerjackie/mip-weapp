import type {
  AccessRequirement,
  AccessReturnContext,
  AccessSession,
  AccountClosureInput,
  AgreementAcceptanceInput,
  IdentityAccessSnapshot,
  MipIdentityGateway,
  PendingAccessResume,
  ProfileUpdateInput,
  ProtectedActionIntent,
} from './contracts'
import { evaluateAccess, sanitizeReturnContext } from './access-flow'
import { protectedActionKeys } from './contracts'

export const MIP_IDENTITY_ACCESS_STORAGE_KEY = 'mip.identity.access-state.v1'
const MIP_IDENTITY_ACCESS_STORAGE_VERSION = 1
const MAX_PERSISTED_INTENTS = 8

interface StoredIntent {
  intent: ProtectedActionIntent
  createdAt: number
}

interface StoredPendingResume extends PendingAccessResume {
  createdAt: number
}

interface PersistedAccessState {
  version: typeof MIP_IDENTITY_ACCESS_STORAGE_VERSION
  intents: Array<StoredIntent & { token: string }>
  pendingResume?: StoredPendingResume
}

export interface MipIdentityAccessStorage {
  read: () => unknown
  write: (state: PersistedAccessState) => void
  clear: () => void
}

export interface MipIdentityModuleOptions {
  now?: () => number
  token?: () => string
  intentLifetimeMs?: number
  storage?: MipIdentityAccessStorage
}

const accessRequirements = new Set<AccessRequirement>([
  'AUTHENTICATED',
  'AGREEMENTS',
  'PHONE',
  'PROFILE',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFresh(createdAt: number, currentTime: number, lifetimeMs: number): boolean {
  return Number.isInteger(createdAt)
    && createdAt >= 0
    && createdAt <= currentTime + 60_000
    && currentTime - createdAt <= lifetimeMs
}

function sanitizeIntent(intent: ProtectedActionIntent): ProtectedActionIntent {
  return {
    ...intent,
    source: sanitizeReturnContext(intent.source),
    requirements: intent.requirements ? [...intent.requirements] : undefined,
  }
}

function restoreIntent(raw: unknown): ProtectedActionIntent | null {
  if (!isRecord(raw) || !protectedActionKeys.includes(raw.action as ProtectedActionIntent['action'])) {
    return null
  }
  if (!isRecord(raw.source)) {
    return null
  }
  const navigation = raw.source.navigation
  if (!['navigateBack', 'redirectTo', 'reLaunch', 'switchTab'].includes(String(navigation))) {
    return null
  }
  if (raw.source.query !== undefined && !isRecord(raw.source.query)) {
    return null
  }
  let requirements: AccessRequirement[] | undefined
  if (raw.requirements !== undefined) {
    if (!Array.isArray(raw.requirements)
      || raw.requirements.length > accessRequirements.size
      || raw.requirements.some(item => !accessRequirements.has(item as AccessRequirement))) {
      return null
    }
    requirements = [...new Set(raw.requirements as AccessRequirement[])]
  }
  let requiredCapability: string | undefined
  if (raw.requiredCapability !== undefined) {
    if (typeof raw.requiredCapability !== 'string'
      || !/^[\w:.-]{1,120}$/.test(raw.requiredCapability)) {
      return null
    }
    requiredCapability = raw.requiredCapability
  }
  try {
    return {
      action: raw.action as ProtectedActionIntent['action'],
      source: sanitizeReturnContext(raw.source as unknown as AccessReturnContext),
      requirements,
      requiredCapability,
    }
  }
  catch {
    return null
  }
}

export function createMipIdentityModule(
  gateway: MipIdentityGateway,
  options: MipIdentityModuleOptions = {},
) {
  const now = options.now || Date.now
  const createToken = options.token || (() => `mip-${now()}-${Math.random().toString(36).slice(2, 12)}`)
  const intentLifetimeMs = options.intentLifetimeMs ?? 30 * 60 * 1000
  const storage = options.storage
  const intents = new Map<string, StoredIntent>()
  let latestSnapshot: IdentityAccessSnapshot | undefined
  let pendingResume: StoredPendingResume | undefined

  function persistAccessState() {
    if (!storage) {
      return
    }
    try {
      if (!intents.size && !pendingResume) {
        storage.clear()
        return
      }
      storage.write({
        version: MIP_IDENTITY_ACCESS_STORAGE_VERSION,
        intents: [...intents.entries()].map(([token, stored]) => ({
          token,
          createdAt: stored.createdAt,
          intent: sanitizeIntent(stored.intent),
        })),
        pendingResume: pendingResume
          ? { ...pendingResume, source: sanitizeReturnContext(pendingResume.source) }
          : undefined,
      })
    }
    catch {
      // Storage is a resume optimization; server access checks remain authoritative.
    }
  }

  function restoreAccessState() {
    if (!storage) {
      return
    }
    let raw: unknown
    try {
      raw = storage.read()
    }
    catch {
      return
    }
    if (raw === undefined || raw === null || raw === '') {
      return
    }
    if (!isRecord(raw)
      || raw.version !== MIP_IDENTITY_ACCESS_STORAGE_VERSION
      || !Array.isArray(raw.intents)) {
      try {
        storage.clear()
      }
      catch {}
      return
    }
    const currentTime = now()
    for (const item of raw.intents.slice(-MAX_PERSISTED_INTENTS)) {
      if (!isRecord(item)
        || typeof item.token !== 'string'
        || !/^[\w.:-]{1,200}$/.test(item.token)
        || typeof item.createdAt !== 'number'
        || !isFresh(item.createdAt, currentTime, intentLifetimeMs)) {
        continue
      }
      const intent = restoreIntent(item.intent)
      if (intent) {
        intents.set(item.token, { intent, createdAt: item.createdAt })
      }
    }
    if (isRecord(raw.pendingResume)
      && typeof raw.pendingResume.createdAt === 'number'
      && isFresh(raw.pendingResume.createdAt, currentTime, intentLifetimeMs)) {
      const intent = restoreIntent({
        action: raw.pendingResume.action,
        source: raw.pendingResume.source,
      })
      if (intent) {
        pendingResume = {
          action: intent.action,
          source: intent.source,
          createdAt: raw.pendingResume.createdAt,
        }
      }
    }
    persistAccessState()
  }

  function trimIntents() {
    while (intents.size > MAX_PERSISTED_INTENTS) {
      const oldest = [...intents.entries()]
        .sort((left, right) => left[1].createdAt - right[1].createdAt)[0]
      if (!oldest) {
        return
      }
      intents.delete(oldest[0])
    }
  }

  function prepareProtectedAction(intent: ProtectedActionIntent): string {
    const token = createToken()
    const safeIntent = sanitizeIntent(intent)
    intents.set(token, { intent: safeIntent, createdAt: now() })
    trimIntents()
    persistAccessState()
    return token
  }

  function getIntent(token: string): ProtectedActionIntent | null {
    const stored = intents.get(token)
    if (!stored) {
      return null
    }
    if (now() - stored.createdAt > intentLifetimeMs) {
      intents.delete(token)
      persistAccessState()
      return null
    }
    return stored.intent
  }

  async function session(token: string, next?: IdentityAccessSnapshot): Promise<AccessSession> {
    const intent = getIntent(token)
    if (!intent) {
      throw new Error('ACCESS_INTENT_EXPIRED')
    }
    latestSnapshot = next || await gateway.getAccessSnapshot()
    return {
      token,
      intent,
      snapshot: latestSnapshot,
      decision: evaluateAccess(latestSnapshot, intent),
    }
  }

  restoreAccessState()

  return {
    prepareProtectedAction,

    async beginProtectedAction(intent: ProtectedActionIntent): Promise<AccessSession> {
      const token = prepareProtectedAction(intent)
      const started = await session(token)
      if (started.decision.ready) {
        intents.delete(token)
        persistAccessState()
      }
      return started
    },

    loadAccess(token: string) {
      return session(token)
    },

    peekSnapshot() {
      return latestSnapshot
    },

    async loadSnapshot() {
      latestSnapshot = await gateway.getAccessSnapshot()
      return latestSnapshot
    },

    peekIntent(token: string) {
      return getIntent(token)
    },

    async acceptAgreements(token: string, input: AgreementAcceptanceInput) {
      return session(token, await gateway.acceptAgreements(input))
    },

    async bindWechatPhone(token: string, code: string) {
      if (!code.trim()) {
        throw new Error('PHONE_CODE_REQUIRED')
      }
      return session(token, await gateway.bindWechatPhone(code))
    },

    async rebindWechatPhone(code: string) {
      if (!code.trim()) {
        throw new Error('PHONE_CODE_REQUIRED')
      }
      latestSnapshot = await gateway.bindWechatPhone(code)
      return latestSnapshot
    },

    async closeAccount(input: AccountClosureInput) {
      const result = await gateway.closeAccount(input)
      latestSnapshot = undefined
      intents.clear()
      pendingResume = undefined
      persistAccessState()
      return result
    },

    async updateProfile(token: string, input: ProfileUpdateInput) {
      return session(token, await gateway.updateProfile(input))
    },

    async saveProfile(input: ProfileUpdateInput) {
      latestSnapshot = await gateway.updateProfile(input)
      return latestSnapshot
    },

    async complete(token: string): Promise<AccessReturnContext> {
      const current = await session(token)
      if (!current.decision.ready) {
        throw new Error(current.decision.block || 'ACCESS_NOT_READY')
      }
      intents.delete(token)
      if (current.intent.source.navigation === 'navigateBack'
        || current.intent.source.navigation === 'switchTab') {
        pendingResume = {
          action: current.intent.action,
          source: current.intent.source,
          createdAt: now(),
        }
      }
      else {
        pendingResume = undefined
      }
      persistAccessState()
      return current.intent.source
    },

    consumePendingResume(route?: string): PendingAccessResume | null {
      if (!pendingResume || now() - pendingResume.createdAt > intentLifetimeMs) {
        pendingResume = undefined
        persistAccessState()
        return null
      }
      if (route && pendingResume.source.route && pendingResume.source.route !== route) {
        return null
      }
      const result = { action: pendingResume.action, source: pendingResume.source }
      pendingResume = undefined
      persistAccessState()
      return result
    },

    cancel(token: string): AccessReturnContext | null {
      const intent = getIntent(token)
      intents.delete(token)
      persistAccessState()
      return intent?.source || null
    },

    getProfile() {
      return gateway.getProfile()
    },

    getPublicProfile(profileRef: string) {
      const normalized = profileRef.trim()
      if (!normalized.startsWith('p1.') || normalized.length > 200) {
        throw new Error('PUBLIC_PROFILE_NOT_FOUND')
      }
      return gateway.getPublicProfile(normalized)
    },

    listProfileTags() {
      return gateway.listProfileTags()
    },
  }
}

export type MipIdentityModule = ReturnType<typeof createMipIdentityModule>
