import { QueryClient } from '@tanstack/react-query'
import { AdminApiClientError } from '../services/admin-api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (error instanceof AdminApiClientError
          && ['AUTH_REQUIRED', 'FORBIDDEN', 'CONFLICT'].includes(error.code)) return false
        return failureCount < 1
      },
    },
    mutations: { retry: false },
  },
})
