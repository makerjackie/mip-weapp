import type { IdentityAccessSnapshot, ProtectedActionIntent } from './contracts'
import type { MipIdentityModule } from './module'
import {
  accessReturnUrl,
  evaluateAccess,
  mipAccessPageUrl,
  sanitizeReturnContext,
} from './access-flow'

export const MIP_GLOBAL_ACCESS_EXEMPT_ROUTES = [
  'packages/member/mip-access/index',
  'packages/member/privacy-policy/index',
  'packages/member/user-agreement/index',
] as const

const MIP_HOME_ROUTE = 'pages/index/index'

export interface MipGlobalAccessTarget {
  path?: string
  query?: Record<string, string>
}

interface MipGlobalAccessIdentity {
  cancel: MipIdentityModule['cancel']
  peekIntent: MipIdentityModule['peekIntent']
  peekSnapshot: MipIdentityModule['peekSnapshot']
  prepareProtectedAction: MipIdentityModule['prepareProtectedAction']
}

export interface MipGlobalAccessRuntime {
  currentPage: () => MipGlobalAccessTarget | undefined
  reLaunch: (url: string) => void
  canNavigateBack: () => boolean
  navigateBack: () => void
}

export type MipGlobalAccessResult = 'BACK' | 'BLOCKED' | 'EXEMPT' | 'READY'

function normalizeRoute(route = ''): string {
  return route.split('?')[0].replace(/^\/+/, '').replace(/\/+$/, '')
}

export function isMipGlobalAccessExemptRoute(route?: string): boolean {
  const normalized = normalizeRoute(route)
  return MIP_GLOBAL_ACCESS_EXEMPT_ROUTES.includes(
    normalized as (typeof MIP_GLOBAL_ACCESS_EXEMPT_ROUTES)[number],
  )
}

export function createMipGlobalAccessIntent(
  target: MipGlobalAccessTarget,
): ProtectedActionIntent {
  const normalizedRoute = normalizeRoute(target.path || MIP_HOME_ROUTE)
  return {
    action: 'ENTER_APP',
    source: sanitizeReturnContext({
      navigation: 'reLaunch',
      route: `/${normalizedRoute}`,
      query: target.query,
    }),
  }
}

function globalAccessReady(
  snapshot: IdentityAccessSnapshot | undefined,
  intent: ProtectedActionIntent,
): boolean {
  return Boolean(snapshot && evaluateAccess(snapshot, intent).ready)
}

export function createMipGlobalAccessGuard(
  identity: MipGlobalAccessIdentity,
  runtime: MipGlobalAccessRuntime,
) {
  let activeRedirect: { token: string, source: string } | undefined

  function redirectToAccess(intent: ProtectedActionIntent): MipGlobalAccessResult {
    const source = JSON.stringify(intent.source)
    let token = activeRedirect?.source === source
      && identity.peekIntent(activeRedirect.token)?.action === 'ENTER_APP'
      ? activeRedirect.token
      : ''
    if (!token) {
      token = identity.prepareProtectedAction(intent)
      activeRedirect = { token, source }
    }
    runtime.reLaunch(mipAccessPageUrl(token))
    return 'BLOCKED'
  }

  function targetFromLaunch(launch: MipGlobalAccessTarget): MipGlobalAccessTarget {
    const current = runtime.currentPage()
    return current?.path ? current : launch
  }

  function clearActiveRedirect() {
    if (activeRedirect && identity.peekIntent(activeRedirect.token)) {
      identity.cancel(activeRedirect.token)
    }
    activeRedirect = undefined
  }

  function enterTarget(
    target: MipGlobalAccessTarget = { path: MIP_HOME_ROUTE },
  ): MipGlobalAccessResult {
    const intent = createMipGlobalAccessIntent(target)
    if (globalAccessReady(identity.peekSnapshot(), intent)) {
      clearActiveRedirect()
      runtime.reLaunch(accessReturnUrl(intent.source) || `/${MIP_HOME_ROUTE}`)
      return 'READY'
    }
    return redirectToAccess(intent)
  }

  return {
    ensureLaunch(launch: MipGlobalAccessTarget = {}): MipGlobalAccessResult {
      const target = targetFromLaunch(launch)
      if (isMipGlobalAccessExemptRoute(target.path)) {
        return 'EXEMPT'
      }
      const intent = createMipGlobalAccessIntent(target)
      if (globalAccessReady(identity.peekSnapshot(), intent)) {
        clearActiveRedirect()
        return 'READY'
      }
      return redirectToAccess(intent)
    },

    enterTarget,

    leaveDocument(fallback: MipGlobalAccessTarget = { path: MIP_HOME_ROUTE }): MipGlobalAccessResult {
      if (runtime.canNavigateBack()) {
        runtime.navigateBack()
        return 'BACK'
      }
      return enterTarget(fallback)
    },
  }
}
