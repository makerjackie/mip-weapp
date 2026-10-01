import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AdminOperationAction, AdminRequestInput, AdminSession } from '../domain/contracts'
import { AdminApiClient, AdminApiClientError, type AdminLoginChallenge } from '../services/admin-api'

interface SessionContextValue {
  client: AdminApiClient
  session: AdminSession | null
  loading: boolean
  error: AdminApiClientError | null
  challenge: AdminLoginChallenge | null
  loginError: string
  loginConfirmed: boolean
  demoMode: boolean
  sessionBoundary: number
  hasCapability: (capability: string) => boolean
  hasCapabilityAtScope: (capability: string, scopeType: string) => boolean
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
  refreshSession: () => Promise<boolean>
  beginLogin: () => Promise<void>
  loginWithPassword: (phone: string, password: string) => Promise<boolean>
  retryConfirmedLogin: () => Promise<void>
  closeLogin: () => void
  requireLogin: () => void
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)
const defaultClient = new AdminApiClient()

export function SessionProvider({ children, client = defaultClient }: { children: ReactNode; client?: AdminApiClient }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<AdminSession | null>(null)
  const [sessionBoundary, setSessionBoundary] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AdminApiClientError | null>(null)
  const [challenge, setChallenge] = useState<AdminLoginChallenge | null>(null)
  const [loginError, setLoginError] = useState('')
  const [loginConfirmed, setLoginConfirmed] = useState(false)
  const loginFlow = useRef(0)
  const sessionRead = useRef(0)
  const sessionIdentity = useRef<string | null>(null)
  const sessionGeneration = useRef(0)

  useEffect(() => () => { loginFlow.current += 1; sessionRead.current += 1 }, [])

  const commitSession = useCallback((next: AdminSession | null) => {
    const capabilityBoundary = [...(next?.capabilities || [])]
      .map(item => `${item.capability}:${item.scopeType || ''}:${item.scopeId || ''}`)
      .sort()
      .join('|')
    const nextIdentity = next?.enabled
      ? `${next.actor?.id || 'authenticated'}:${capabilityBoundary}`
      : null
    if (nextIdentity !== sessionIdentity.current) {
      sessionIdentity.current = nextIdentity
      setSessionBoundary(++sessionGeneration.current)
      queryClient.removeQueries({ predicate: query => isProtectedAdminQueryKey(query.queryKey) })
    }
    setSession(next)
  }, [queryClient])

  const refreshSession = useCallback(async () => {
    const read = ++sessionRead.current
    const flow = loginFlow.current
    const current = () => read === sessionRead.current && flow === loginFlow.current
    setLoading(true)
    setError(null)
    if (client.demoMode) {
      commitSession({ enabled: true, actor: { id: 'demo', name: '演示运营账号' }, capabilities: [] })
      setLoading(false)
      return true
    }
    try {
      const next = await client.getSession()
      if (!current()) return false
      commitSession(next)
      return Boolean(next.enabled)
    }
    catch (reason) {
      if (!current()) return false
      const next = reason instanceof AdminApiClientError
        ? reason
        : new AdminApiClientError('SERVICE_UNAVAILABLE', '运营会话暂时无法加载', true)
      if (next.code === 'AUTH_REQUIRED' || next.code === 'FORBIDDEN') commitSession(null)
      setError(next)
      return false
    }
    finally { if (read === sessionRead.current) setLoading(false) }
  }, [client, commitSession])

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSession(), 0)
    return () => window.clearTimeout(timer)
  }, [refreshSession])

  const pollLogin = useCallback(async (flow: number, initialDelay: number) => {
    let delay = initialDelay
    while (loginFlow.current === flow) {
      await new Promise(resolve => window.setTimeout(resolve, Math.max(750, delay)))
      if (loginFlow.current !== flow) return
      try {
        const status = await client.pollLogin()
        if (loginFlow.current !== flow) return
        if (status.state === 'AUTHENTICATED') {
          setChallenge(null)
          setLoginError('')
          setLoginConfirmed(true)
          const loaded = await refreshSession()
          if (loginFlow.current !== flow) return
          if (loaded) {
            setLoginConfirmed(false)
          }
          else {
            setLoginError('登录已确认，但运营会话暂时无法加载，请重试')
          }
          return
        }
        if (Date.parse(status.expiresAt) <= Date.now()) {
          setChallenge(null)
          setLoginError('登录请求已过期，请重新获取')
          return
        }
        delay = status.pollAfterMs
      }
      catch (reason) {
        if (loginFlow.current !== flow) return
        setChallenge(null)
        setLoginError(reason instanceof Error ? reason.message : '网页登录服务暂时不可用')
        return
      }
    }
  }, [client, refreshSession])

  const beginLogin = useCallback(async () => {
    const flow = loginFlow.current + 1
    loginFlow.current = flow
    setChallenge(null)
    setLoginError('')
    setLoginConfirmed(false)
    try {
      const next = await client.beginLogin()
      if (loginFlow.current !== flow) return
      setChallenge(next)
      void pollLogin(flow, next.pollAfterMs)
    }
    catch (reason) {
      if (loginFlow.current !== flow) return
      setLoginError(reason instanceof Error ? reason.message : '网页登录服务暂时不可用')
    }
  }, [client, pollLogin])

  const closeLogin = useCallback(() => {
    loginFlow.current += 1
    setChallenge(null)
    setLoginError('')
    setLoginConfirmed(false)
  }, [])

  const requireLogin = useCallback(() => {
    closeLogin()
    sessionRead.current += 1
    commitSession(null)
    setLoading(false)
    setError(new AdminApiClientError('AUTH_REQUIRED', '请重新登录'))
  }, [closeLogin, commitSession])

  const loginWithPassword = useCallback(async (phone: string, password: string) => {
    const flow = ++loginFlow.current
    setChallenge(null)
    setLoginError('')
    setLoginConfirmed(false)
    try {
      await client.loginWithPassword(phone, password, () => loginFlow.current === flow)
      if (loginFlow.current !== flow) return false
      setLoginConfirmed(true)
      const loaded = await refreshSession()
      if (loginFlow.current !== flow) return false
      if (loaded) setLoginConfirmed(false)
      else setLoginError('登录已确认，但运营会话暂时无法加载，请重试')
      return loaded
    }
    catch (reason) {
      if (loginFlow.current === flow) {
        setLoginError(reason instanceof Error ? reason.message : '密码登录暂时不可用，请稍后重试')
      }
      return false
    }
  }, [client, refreshSession])

  const retryConfirmedLogin = useCallback(async () => {
    setLoginError('')
    const loaded = await refreshSession()
    if (loaded) {
      setLoginConfirmed(false)
      return
    }
    setLoginError('登录已确认，但运营会话暂时无法加载，请重试')
  }, [refreshSession])

  const logout = useCallback(async () => {
    const flow = ++loginFlow.current
    sessionRead.current += 1
    setLoginConfirmed(false)
    commitSession(null)
    setError(null)
    setLoading(true)
    try {
      await client.logout()
    }
    catch {
      // Server session state is the source of truth; refreshSession below
      // reconciles the client instead of assuming the cookie was cleared.
    }
    if (flow === loginFlow.current) await refreshSession()
  }, [client, commitSession, refreshSession])

  const hasCapability = useCallback((capability: string) => {
    if (client.demoMode) return true
    return Boolean(session?.capabilities?.some(item => item.capability === capability))
  }, [client.demoMode, session])
  const hasCapabilityAtScope = useCallback((capability: string, scopeType: string) => {
    if (client.demoMode) return true
    return Boolean(session?.capabilities?.some(item => item.capability === capability && item.scopeType === scopeType))
  }, [client.demoMode, session])

  const request = useCallback(async <T,>(action: AdminOperationAction, input: AdminRequestInput = {}) => {
    if (sessionBoundary !== sessionGeneration.current) {
      throw new AdminApiClientError('SESSION_CHANGED', '账号或权限已变化，请重新打开记录。')
    }
    const identity = sessionIdentity.current
    const flow = loginFlow.current
    try {
      const result = await client.request<T>(action, input)
      if (sessionBoundary !== sessionGeneration.current || identity !== sessionIdentity.current || flow !== loginFlow.current) {
        throw new AdminApiClientError('SESSION_CHANGED', '账号或权限已变化，请重新打开记录。')
      }
      return result
    }
    catch (reason) {
      if (reason instanceof AdminApiClientError && reason.code === 'AUTH_REQUIRED'
        && sessionBoundary === sessionGeneration.current && identity === sessionIdentity.current && flow === loginFlow.current) {
        sessionRead.current += 1
        commitSession(null)
        setLoading(false)
        setError(reason)
      }
      throw reason
    }
  }, [client, commitSession, sessionBoundary])

  const value = useMemo<SessionContextValue>(() => ({
    client,
    session,
    loading,
    error,
    challenge,
    loginError,
    loginConfirmed,
    demoMode: client.demoMode,
    sessionBoundary,
    hasCapability,
    hasCapabilityAtScope,
    request,
    refreshSession,
    beginLogin,
    loginWithPassword,
    retryConfirmedLogin,
    closeLogin,
    requireLogin,
    logout,
  }), [beginLogin, challenge, client, closeLogin, error, hasCapability, hasCapabilityAtScope, loading, loginConfirmed, loginError, loginWithPassword, logout, refreshSession, request, requireLogin, retryConfirmedLogin, session, sessionBoundary])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Every protected admin query must be keyed under the shared `admin` root so
 * session/capability changes can purge them without a hand-maintained list. */
export function isProtectedAdminQueryKey(queryKey: readonly unknown[]) {
  return String(queryKey[0] || '') === 'admin'
}

export function useAdminSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useAdminSession must be used within SessionProvider')
  return value
}
