import type {
  AccessDecision,
  AccessRequirement,
  AccessReturnContext,
  IdentityAccessSnapshot,
  ProtectedActionIntent,
} from './contracts'

export const MIP_ACCESS_PAGE_PATH = '/packages/member/mip-access/index'

const fullAccessRequirements: AccessRequirement[] = [
  'AUTHENTICATED',
  'AGREEMENTS',
  'PHONE',
  'PROFILE',
]

const defaultRequirements: Record<ProtectedActionIntent['action'], AccessRequirement[]> = {
  ENTER_APP: ['AUTHENTICATED', 'AGREEMENTS'],
  REGISTER_EVENT: fullAccessRequirements,
  PURCHASE_MEMBERSHIP: fullAccessRequirements,
  PUBLISH_OPPORTUNITY: fullAccessRequirements,
  INTERACT: fullAccessRequirements,
  VIEW_RESTRICTED_PROFILE: fullAccessRequirements,
  ENTER_ADMIN: fullAccessRequirements,
  EDIT_PROFILE: ['AUTHENTICATED', 'AGREEMENTS'],
}

const blockByRequirement = {
  AUTHENTICATED: 'AUTH_REQUIRED',
  AGREEMENTS: 'AGREEMENT_REQUIRED',
  PHONE: 'PHONE_REQUIRED',
  PROFILE: 'PROFILE_REQUIRED',
} as const

export function requirementsFor(intent: ProtectedActionIntent): AccessRequirement[] {
  if (intent.action === 'ENTER_APP') {
    return [...defaultRequirements.ENTER_APP]
  }
  return [...(intent.requirements || defaultRequirements[intent.action])]
}

export function evaluateAccess(
  snapshot: IdentityAccessSnapshot,
  intent: ProtectedActionIntent,
): AccessDecision {
  if (snapshot.authenticated && snapshot.userStatus && snapshot.userStatus !== 'ACTIVE') {
    return { ready: false, block: 'FORBIDDEN' }
  }
  const checks: Record<AccessRequirement, boolean> = {
    AUTHENTICATED: snapshot.authenticated && snapshot.userStatus === 'ACTIVE',
    AGREEMENTS: snapshot.agreements.every(agreement => agreement.accepted),
    PHONE: snapshot.phoneBound,
    PROFILE: snapshot.profile.complete,
  }

  for (const requirement of requirementsFor(intent)) {
    if (!checks[requirement]) {
      return {
        ready: false,
        block: blockByRequirement[requirement],
        nextRequirement: requirement,
      }
    }
  }

  if (intent.requiredCapability && !snapshot.grants.some(
    grant => grant.capabilities.includes(intent.requiredCapability as string),
  )) {
    return { ready: false, block: 'FORBIDDEN' }
  }

  return { ready: true }
}

export function isSensitiveAccessQueryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized === 'key'
    || normalized.includes('openid')
    || normalized.includes('unionid')
    || normalized.includes('phone')
    || normalized.includes('mobile')
    || normalized.includes('password')
    || normalized.includes('passwd')
    || normalized.includes('secret')
    || normalized.includes('token')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('sessionkey')
    || normalized.includes('privatekey')
    || normalized.includes('accesskey')
    || normalized.includes('apikey')
    || normalized.includes('merchantkey')
    || normalized.includes('mchkey')
    || normalized.includes('encryptionkey')
}

export function sanitizeReturnContext(source: AccessReturnContext): AccessReturnContext {
  if (source.navigation === 'navigateBack' && !source.route) {
    return { navigation: 'navigateBack' }
  }

  const rawRoute = String(source.route || '')
  const route = rawRoute && !rawRoute.startsWith('/') ? `/${rawRoute}` : rawRoute
  if (route.length > 200
    || !/^\/[\w/-]+$/.test(route)
    || route.includes('..')
    || route.includes('//')) {
    throw new Error('INVALID_RETURN_ROUTE')
  }

  const query: Record<string, string> = {}
  for (const [key, value] of Object.entries(source.query || {})) {
    if (Object.keys(query).length >= 16) {
      break
    }
    if (!/^[a-z]\w{0,39}$/i.test(key) || isSensitiveAccessQueryKey(key)) {
      continue
    }
    const normalized = String(value)
    if (normalized.length <= 300) {
      query[key] = normalized
    }
  }

  return { navigation: source.navigation, route, query }
}

export function accessReturnUrl(context: AccessReturnContext, resumeAction?: string): string | null {
  if (!context.route) {
    return null
  }
  const query = { ...(context.query || {}) }
  if (resumeAction) {
    query.mipResume = resumeAction
  }
  const suffix = Object.entries(query)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return suffix ? `${context.route}?${suffix}` : context.route
}

export function mipAccessPageUrl(token: string): string {
  return `${MIP_ACCESS_PAGE_PATH}?token=${encodeURIComponent(token)}`
}
