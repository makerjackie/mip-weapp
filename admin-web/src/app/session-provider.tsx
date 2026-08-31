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
  demoMode: boolean
  sessionBoundary: number
  hasCapability: (capability: string) => boolean
  hasCapabilityAtScope: (capability: string, scopeType: string) => boolean
  request: <T>(action: AdminOperationAction, input?: AdminRequestInput) => Promise<T>
  refreshSession: () => Promise<void>
  beginLogin: () => Promise<void>
  closeLogin: () => void
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
  const loginFlow = useRef(0)
  const sessionIdentity = useRef<string | null>(null)

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
      setSessionBoundary(value => value + 1)
      queryClient.removeQueries({ predicate: query => isProtectedAdminQueryKey(query.queryKey) })
    }
    setSession(next)
  }, [queryClient])

  const refreshSession = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (client.demoMode) {
      commitSession({ enabled: true, actor: { id: 'demo', name: '演示运营账号' }, capabilities: [] })
      setLoading(false)
      return
    }
    try {
      commitSession(await client.getSession())
    }
    catch (reason) {
      const next = reason instanceof AdminApiClientError
        ? reason
        : new AdminApiClientError('SERVICE_UNAVAILABLE', '运营会话暂时无法加载', true)
      if (next.code === 'AUTH_REQUIRED') commitSession(null)
      setError(next)
    }
    finally { setLoading(false) }
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
          await refreshSession()
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
    try {
      const next = await client.beginLogin()
      setChallenge(next)
      void pollLogin(flow, next.pollAfterMs)
    }
    catch (reason) {
      setLoginError(reason instanceof Error ? reason.message : '网页登录服务暂时不可用')
    }
  }, [client, pollLogin])

  const closeLogin = useCallback(() => {
    loginFlow.current += 1
    setChallenge(null)
    setLoginError('')
  }, [])

  const logout = useCallback(async () => {
    loginFlow.current += 1
    commitSession(null)
    await client.logout()
    await refreshSession()
  }, [client, commitSession, refreshSession])

  const hasCapability = useCallback((capability: string) => {
    if (client.demoMode) return true
    return Boolean(session?.capabilities?.some(item => item.capability === capability))
  }, [client.demoMode, session])
  const hasCapabilityAtScope = useCallback((capability: string, scopeType: string) => {
    if (client.demoMode) return true
    return Boolean(session?.capabilities?.some(item => item.capability === capability && item.scopeType === scopeType))
  }, [client.demoMode, session])

  const request = useCallback(<T,>(action: AdminOperationAction, input: AdminRequestInput = {}) => client.request<T>(action, input), [client])

  const value = useMemo<SessionContextValue>(() => ({
    client,
    session,
    loading,
    error,
    challenge,
    loginError,
    demoMode: client.demoMode,
    sessionBoundary,
    hasCapability,
    hasCapabilityAtScope,
    request,
    refreshSession,
    beginLogin,
    closeLogin,
    logout,
  }), [beginLogin, challenge, client, closeLogin, error, hasCapability, hasCapabilityAtScope, loading, loginError, logout, refreshSession, request, session, sessionBoundary])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function isProtectedAdminQueryKey(queryKey: readonly unknown[]) {
  return ['admin', 'admin-detail', 'admin-read-page', 'admin-overview'].includes(String(queryKey[0] || ''))
}

export function useAdminSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useAdminSession must be used within SessionProvider')
  return value
}
