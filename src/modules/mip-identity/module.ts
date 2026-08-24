import type {
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

interface StoredIntent {
  intent: ProtectedActionIntent
  createdAt: number
}

export interface MipIdentityModuleOptions {
  now?: () => number
  token?: () => string
  intentLifetimeMs?: number
}

export function createMipIdentityModule(
  gateway: MipIdentityGateway,
  options: MipIdentityModuleOptions = {},
) {
  const now = options.now || Date.now
  const createToken = options.token || (() => `mip-${now()}-${Math.random().toString(36).slice(2, 12)}`)
  const intentLifetimeMs = options.intentLifetimeMs || 30 * 60 * 1000
  const intents = new Map<string, StoredIntent>()
  let latestSnapshot: IdentityAccessSnapshot | undefined
  let pendingResume: (PendingAccessResume & { createdAt: number }) | undefined

  function getIntent(token: string): ProtectedActionIntent | null {
    const stored = intents.get(token)
    if (!stored) {
      return null
    }
    if (now() - stored.createdAt > intentLifetimeMs) {
      intents.delete(token)
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

  return {
    async beginProtectedAction(intent: ProtectedActionIntent): Promise<AccessSession> {
      const token = createToken()
      const safeIntent = {
        ...intent,
        source: sanitizeReturnContext(intent.source),
        requirements: intent.requirements ? [...intent.requirements] : undefined,
      }
      intents.set(token, { intent: safeIntent, createdAt: now() })
      const started = await session(token)
      if (started.decision.ready) {
        intents.delete(token)
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
      if (current.intent.source.navigation !== 'redirectTo') {
        pendingResume = {
          action: current.intent.action,
          source: current.intent.source,
          createdAt: now(),
        }
      }
      return current.intent.source
    },

    consumePendingResume(route?: string): PendingAccessResume | null {
      if (!pendingResume || now() - pendingResume.createdAt > intentLifetimeMs) {
        pendingResume = undefined
        return null
      }
      if (route && pendingResume.source.route && pendingResume.source.route !== route) {
        return null
      }
      const result = { action: pendingResume.action, source: pendingResume.source }
      pendingResume = undefined
      return result
    },

    cancel(token: string): AccessReturnContext | null {
      const intent = getIntent(token)
      intents.delete(token)
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
