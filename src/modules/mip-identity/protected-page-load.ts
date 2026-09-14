import { recordLoadingFailure } from '../../platform/cloudbase/loading-diagnostics'

interface ProtectedPage {
  accessReady: boolean
  checkingAccess: boolean
  setData: (patch: { state?: 'loading' | 'access' | 'error', accessToken?: string, message?: string }) => void
}
interface AccessResult {
  token: string
  decision: { ready: boolean }
}

/** Lock only the identity check, never the independent data requests that follow it. */
export async function ensureProtectedPageAccess(page: ProtectedPage, begin: () => Promise<AccessResult>): Promise<boolean> {
  if (page.checkingAccess) {
    return false
  }
  page.checkingAccess = true
  if (!page.accessReady) {
    page.setData({ state: 'loading', message: '' })
  }
  try {
    const session = await begin()
    page.accessReady = session.decision.ready
    if (!session.decision.ready) {
      page.setData({ state: 'access', accessToken: session.token, message: '' })
      return false
    }
    page.setData({ accessToken: '', message: '' })
    return true
  }
  catch (error) {
    page.accessReady = false
    recordLoadingFailure('identity.response', error)
    page.setData({ state: 'error', message: '身份状态暂时无法确认，请重新加载。' })
    return false
  }
  finally {
    page.checkingAccess = false
  }
}

export function requiresIdentityRefresh(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && ['AUTH_REQUIRED', 'AGREEMENT_REQUIRED', 'PHONE_REQUIRED', 'PROFILE_REQUIRED'].includes(String(error.code))
}
