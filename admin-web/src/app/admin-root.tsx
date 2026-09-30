import { AdminOperationProvider } from '../features/admin-runtime/admin-operation-provider'
import { ResponsiveAppShell } from '../shared/ui/responsive-app-shell'

export function AdminRoot() {
  return <AdminOperationProvider><ResponsiveAppShell /></AdminOperationProvider>
}
