import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AdminRequestInput, AdminSession } from '../domain/contracts'
import { AdminApiClient, AdminApiClientError, type AdminLoginChallenge } from '../services/admin-api'

interface SessionContextValue {
  client: AdminApiClient
  session: AdminSession | null
  loading: boolean
  error: AdminApiClientError | null
  challenge: AdminLoginChallenge | null
  loginError: string
  demoMode: boolean
  hasCapability: (capability: string) => boolean
  request: <T>(action: string, input?: AdminRequestInput) => Promise<T>
  refreshSession: () => Promise<void>
  beginLogin: () => Promise<void>
  closeLogin: () => void
  logout: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)
const defaultClient = new AdminApiClient()

export function SessionProvider({ children, client = defaultClient }: { children: ReactNode; client?: AdminApiClient }) {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AdminApiClientError | null>(null)
  const [challenge, setChallenge] = useState<AdminLoginChallenge | null>(null)
  const [loginError, setLoginError] = useState('')
  const loginFlow = useRef(0)

  const refreshSession = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (client.demoMode) {
      setSession({ enabled: true, actor: { id: 'demo', name: '演示运营账号' }, capabilities: [] })
      setLoading(false)
      return
    }
    try {
      setSession(await client.getSession())
    }
    catch (reason) {
      const next = reason instanceof AdminApiClientError
        ? reason
        : new AdminApiClientError('SERVICE_UNAVAILABLE', '运营会话暂时无法加载', true)
      if (next.code === 'AUTH_REQUIRED') setSession(null)
      setError(next)
    }
    finally { setLoading(false) }
  }, [client])

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
    await client.logout()
    setSession(null)
    await refreshSession()
  }, [client, refreshSession])

  const hasCapability = useCallback((capability: string) => {
    if (client.demoMode) return true
    return Boolean(session?.capabilities?.some(item => item.capability === capability))
  }, [client.demoMode, session])

  const request = useCallback(<T,>(action: string, input: AdminRequestInput = {}) => client.request<T>(action, input), [client])

  const value = useMemo<SessionContextValue>(() => ({
    client,
    session,
    loading,
    error,
    challenge,
    loginError,
    demoMode: client.demoMode,
    hasCapability,
    request,
    refreshSession,
    beginLogin,
    closeLogin,
    logout,
  }), [beginLogin, challenge, client, closeLogin, error, hasCapability, loading, loginError, logout, refreshSession, request, session])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useAdminSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useAdminSession must be used within SessionProvider')
  return value
}
