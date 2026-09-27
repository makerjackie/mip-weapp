import { createPool } from 'mysql2/promise'
import { resolve } from 'node:path'
import { createAdminBff, type AdminBffEnv } from '../server/admin-bff.ts'
import { createMysqlAuthDatabase } from '../server/mysql-auth-database.ts'
// Runtime adapters are plain ESM so their protocol tests run without a transpiler.
// @ts-expect-error checked by dedicated Node protocol tests
import { createHttpHandler } from './http-adapter.mjs'
// @ts-expect-error checked by dedicated Node protocol tests
import { createStaticHandler } from './static-assets.mjs'

let handler: ReturnType<typeof createHttpHandler>
export async function main(event: unknown, context: unknown) {
  try {
  if (!handler) {
    const uri = process.env.MIP_ADMIN_AUTH_MYSQL_URI
    if (!uri) return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: false, error: { code: 'CONFIGURATION_REQUIRED', message: '登录服务暂时不可用' } }) }
    const parsed = new URL(uri)
    if (parsed.protocol !== 'mysql:' || !parsed.hostname || !parsed.username || !parsed.pathname.slice(1)) throw new Error('Invalid database configuration')
    const pool = createPool({ host: parsed.hostname, port: Number(parsed.port || 3306), user: decodeURIComponent(parsed.username), password: decodeURIComponent(parsed.password), database: decodeURIComponent(parsed.pathname.slice(1)), ssl: parsed.searchParams.get('ssl') === 'true' ? {} : undefined, connectionLimit: 3, maxIdle: 1, idleTimeout: 60_000, connectTimeout: 8000, timezone: 'Z', charset: 'utf8mb4', waitForConnections: true, queueLimit: 30, supportBigNumbers: true, bigNumberStrings: false, multipleStatements: false })
    const env: AdminBffEnv = { ...process.env, MIP_ADMIN_AUTH_DB: createMysqlAuthDatabase(pool) }
    const bff = createAdminBff(env)
    handler = createHttpHandler({ origin: env.MIP_WEB_ALLOWED_ORIGIN, handle: (request: Request) => bff.handle(request), serveStatic: createStaticHandler(resolve(__dirname, 'public')) })
  }
  return await handler(event, context)
  } catch {
    console.error('[mip-admin-cloudbase] initialization failed')
    return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用' } }) }
  }
}
