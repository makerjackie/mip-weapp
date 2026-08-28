import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { App, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppErrorBoundary } from './app/app-error-boundary'
import { queryClient } from './app/query-client'
import { router } from './app/router'
import { SessionProvider } from './app/session-provider'
import { adminTheme } from './app/theme'
import { AdminOperationProvider } from './features/admin-runtime/admin-operation-provider'
import './styles/app.css'

const root = document.getElementById('app')
if (!root) throw new Error('MIP admin root element is missing')

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <ConfigProvider locale={zhCN} theme={adminTheme}>
        <App>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <AdminOperationProvider>
                <RouterProvider router={router} />
              </AdminOperationProvider>
            </SessionProvider>
          </QueryClientProvider>
        </App>
      </ConfigProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
