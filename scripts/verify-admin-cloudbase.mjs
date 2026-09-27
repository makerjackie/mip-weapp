/** Real HTTPS checks; business calls are restricted to the reviewed read-only contract. */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { WEB_ADMIN_QUERY_ACTIONS } from '../admin-web/server/admin-mutation-contract.ts'
import { loadAdminReadPage } from '../admin-web/src/modules/admin-read-pages.ts'
import { loadCaseEnv } from './lib/example-cloudbase.mjs'

const root = path.resolve(import.meta.dirname, '..')
const targetPath = path.join(root, '.tmp/admin-cloudbase-deploy/target.private.json')
if (!fs.existsSync(targetPath)) {
  throw new Error('CloudBase target has not been deployed')
}
const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'))
const supplied = process.argv.find(value => value.startsWith('--origin='))?.slice(9)
const origin = new URL(supplied || target.origin).origin
if (!supplied || origin !== new URL(target.origin).origin || !origin.startsWith('https://')) {
  throw new Error('Supply --origin matching the deployed HTTPS target exactly')
}
const env = loadCaseEnv(root)
if (!env.MIP_ADMIN_TEST_PHONE || !env.MIP_ADMIN_TEST_PASSWORD) {
  throw new Error('Configured verification account is missing')
}
const output = path.join(root, '.tmp/cloudbase-migration/live-verification.public.json')
const report = {
  generatedAt: new Date().toISOString(),
  origin,
  passwordChanged: false,
  businessWrites: false,
  checks: [],
  modules: [],
  limitations: [
    'HTTP authentication and read-model verification, not browser visual acceptance.',
    'No business writes, refunds, exports, file uploads, or WeChat confirmation are exercised.',
    'Empty sections prove empty-state transport only; section counts distinguish nonempty coverage.',
  ],
}
const cookies = new Map()
function cookieHeader() {
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}
function record(id, passed, details = {}) {
  report.checks.push({ id, status: passed ? 'pass' : 'fail', ...details })
  return passed
}
async function api(route, body = {}, options = {}) {
  const response = await fetch(`${origin}${route}`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(45_000),
    headers: { 'Origin': options.origin || origin, 'Content-Type': 'application/json', 'Cookie': options.cookie ?? cookieHeader() },
    body: JSON.stringify(body),
  })
  if (!options.ignoreCookies) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0]
      const split = pair.indexOf('=')
      cookies.set(pair.slice(0, split), pair.slice(split + 1))
    }
  }
  let payload
  try {
    payload = await response.json()
  }
  catch { payload = null }
  return { response, payload }
}
let queue = Promise.resolve()
function read(action, input = {}) {
  if (!WEB_ADMIN_QUERY_ACTIONS.has(action)) {
    throw new Error('Verification attempted a non-query action')
  }
  const request = queue.then(async () => {
    const { response, payload } = await api('/api/admin', { contractVersion: 1, action, input })
    const passed = response.ok && payload?.ok === true
    record(action, passed, { httpStatus: response.status, responseHasData: payload?.data !== undefined })
    if (!passed) {
      throw new Error('Read query failed')
    }
    return payload.data
  })
  queue = request.catch(() => {})
  return request
}
async function staticCheck(resource, mime) {
  const response = await fetch(`${origin}${resource}`, { redirect: 'error', signal: AbortSignal.timeout(45_000) })
  const contentType = response.headers.get('content-type') || ''
  const content = await response.text()
  record(`static:${resource}`, response.ok && mime.test(contentType) && (mime.test('text/html') || !/^\s*<!doctype html/i.test(content)), { httpStatus: response.status, contentType })
}
try {
  await staticCheck('/', /text\/html/)
  const assets = fs.readdirSync(path.join(root, 'admin-web/dist/assets')).filter(file => /\.(?:js|css)$/.test(file))
  for (const file of assets) {
    await staticCheck(`/assets/${file}`, file.endsWith('.js') ? /(?:javascript|ecmascript)/ : /text\/css/)
  }
  const missing = await fetch(`${origin}/assets/nonexistent-migration-check-${Date.now()}.js`, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  record('static:missing-asset-404', missing.status === 404, { httpStatus: missing.status })
  const invalidOrigin = await api('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD }, { origin: 'https://untrusted.invalid' })
  record('auth:origin-rejected', invalidOrigin.response.status === 403, { httpStatus: invalidOrigin.response.status })
  const wrong = await api('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: `${env.MIP_ADMIN_TEST_PASSWORD}-wrong` })
  record('auth:wrong-password-rejected', wrong.response.status === 401, { httpStatus: wrong.response.status })
  const login = await api('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD })
  if (!record('auth:password-login', login.response.ok && login.payload?.authenticated === true, { httpStatus: login.response.status })) {
    throw new Error('Login unavailable')
  }
  const sessionCookie = login.response.headers.getSetCookie().find(value => value.startsWith('mip_admin_session=')) || ''
  record('auth:cookie-security', /;\s*HttpOnly/i.test(sessionCookie) && /;\s*Secure/i.test(sessionCookie) && /;\s*SameSite=Lax/i.test(sessionCookie))
  const session = await read('mip.admin.session')
  if (!record('auth:admin-enabled', session?.enabled === true)) {
    throw new Error('Account is not enabled')
  }
  const routes = ['users', 'events', 'orders', 'tasks', 'banners', 'game', 'permissions', 'messages', 'knowledge', 'opportunities', 'growth', 'operations', 'adminAccounts', 'auditLogs']
  for (const route of routes) {
    const start = report.checks.length
    try {
      const page = await loadAdminReadPage(route, { query: '', status: '', limit: 20 }, read, { hasCapability: () => true })
      const sections = page.sections.map(section => ({ rows: section.rows.length, columns: section.columns.length }))
      const passed = report.checks.slice(start).every(check => check.status === 'pass')
      report.modules.push({ route, status: passed ? 'pass' : 'fail', sections, hasNonemptySection: sections.some(section => section.rows > 0) })
    }
    catch {
      await queue
      report.modules.push({ route, status: 'fail' })
    }
  }
  for (const [action, input] of [
    ['mip.admin.dashboard.overview.get', {}],
    ['mip.admin.membershipAgreement.get', {}],
    ['mip.admin.membershipAgreement.get', { document: 'user' }],
    ['mip.admin.cards.list', { cardType: 'PROFILE', limit: 20 }],
    ['mip.admin.cards.list', { cardType: 'TEMPLATE' }],
  ]) {
    try {
      await read(action, input)
    }
    catch { /* The sanitized query check records the failure. */ }
  }
  const replayCookie = cookieHeader()
  const logout = await api('/api/auth/logout')
  record('auth:logout', logout.response.ok, { httpStatus: logout.response.status })
  const replay = await api('/api/admin', { contractVersion: 1, action: 'mip.admin.session', input: {} }, { cookie: replayCookie, ignoreCookies: true })
  record('auth:logout-replay-rejected', replay.response.status === 401, { httpStatus: replay.response.status })
}
catch {
  record('verification:completed', false)
}
finally {
  if (cookies.size) {
    try {
      await api('/api/auth/logout')
    }
    catch { record('auth:cleanup-logout', false) }
  }
  report.completedAt = new Date().toISOString()
  report.passed = report.checks.every(check => check.status === 'pass') && report.modules.every(module => module.status === 'pass')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failedChecks: report.checks.filter(check => check.status === 'fail').map(check => check.id), modules: report.modules.length, report: path.relative(root, output) }))
  if (!report.passed) {
    process.exitCode = 1
  }
}
