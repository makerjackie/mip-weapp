import { createAdminBff, type AdminBffEnv } from '../../server/admin-bff'

interface PagesContext {
  request: Request
  env: AdminBffEnv
}

export const onRequest = (context: PagesContext) => createAdminBff(context.env).handle(context.request)
