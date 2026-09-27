import process from 'node:process'
import { loadCaseEnv } from './lib/example-cloudbase.mjs'

const env = loadCaseEnv(process.cwd())
const origin = new URL(env.MIP_ADMIN_TEST_ORIGIN || 'https://mipmini.01mvp.com').origin
if (!origin.startsWith('https://') && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
  throw new Error('Use HTTPS or a loopback test server')
}
if (!env.MIP_ADMIN_TEST_PHONE || !env.MIP_ADMIN_TEST_PASSWORD) {
  throw new Error('Configure MIP_ADMIN_TEST_PHONE and MIP_ADMIN_TEST_PASSWORD in ignored .env.secrets.local')
}
const cookies = new Map()
async function request(path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'Origin': origin,
      'Content-Type': 'application/json',
      'Cookie': [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]
    const separator = pair.indexOf('=')
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1))
  }
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`)
  }
  return payload
}

try {
  const login = await request('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD })
  if (login.authenticated !== true) {
    throw new Error('Password login failed')
  }
  const session = await request('/api/admin', { contractVersion: 1, action: 'mip.admin.session', input: {} })
  if (!session.ok || !session.data?.enabled) {
    throw new Error('Administrator session verification failed')
  }
  console.log('PASS: password login and real administrator session')
}
finally {
  if (cookies.size) {
    await request('/api/auth/logout')
    console.log('PASS: session logged out')
  }
}
