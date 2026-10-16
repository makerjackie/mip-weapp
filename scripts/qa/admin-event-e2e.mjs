// Authenticated end-to-end suite for the deployed MIP admin event module.
//
// It logs in with the configured test administrator (MIP_ADMIN_TEST_* in the
// ignored .env.secrets.local), then exercises the real event write/read path on
// the target origin: rich-text persistence, tags (create + activate + assign),
// edit, list lookup, and validation boundaries. It writes only clearly-marked
// QA objects and archives them at the end (pass --keep to inspect them).
//
// Usage:
//   node scripts/qa/admin-event-e2e.mjs [--origin=https://...] [--keep]
//
// Exit code is non-zero when any check fails, so it can gate a release.

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { loadCaseEnv } from '../lib/example-cloudbase.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const env = loadCaseEnv(root)
const flag = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const keep = process.argv.includes('--keep')
const origin = new URL(flag('--origin') || env.MIP_ADMIN_TEST_ORIGIN || 'https://admin.mip.cool').origin

if (!env.MIP_ADMIN_TEST_PHONE || !env.MIP_ADMIN_TEST_PASSWORD) {
  console.error('Missing MIP_ADMIN_TEST_PHONE / MIP_ADMIN_TEST_PASSWORD in the ignored .env.secrets.local')
  process.exit(2)
}

const cookies = new Map()
async function raw(pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: 'POST',
    headers: {
      'Origin': origin,
      'Content-Type': 'application/json',
      'Cookie': [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(40_000),
    redirect: 'error',
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const index = pair.indexOf('=')
    cookies.set(pair.slice(0, index), pair.slice(index + 1))
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`)
  }
  return response.json()
}
function admin(action, input, idempotencyKey) {
  return raw('/api/admin', {
    contractVersion: 1,
    action,
    input,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  })
}
const newKey = prefix => `qa-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const results = []
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`)
  }
  catch (error) {
    results.push({ name, ok: false, detail: String(error?.message || error) })
    console.log(`  FAIL  ${name}  -> ${String(error?.message || error)}`)
  }
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const created = { eventId: null, eventVersion: null, tagId: null, tagVersion: null }

console.log(`admin event e2e against ${origin}`)
try {
  await raw('/api/auth/password/login', { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD })

  await check('authenticated session', async () => {
    const session = await admin('mip.admin.session', {})
    assert(session?.data?.enabled === true, 'session not enabled')
  })

  await check('event list returns items', async () => {
    const list = await admin('mip.admin.events.list', { filters: { query: '', status: '' }, limit: 5 })
    assert(Array.isArray(list?.data?.items), 'items not an array')
    return `${list.data.items.length} items`
  })

  const tagName = `QA测${Math.floor(Math.random() * 90 + 10)}`
  await check('create + activate tag (inline-create path)', async () => {
    const create = await admin('mip.admin.events.catalog.save', { kind: 'TAG', key: newKey('tag'), name: tagName, description: '', sortOrder: 0 }, newKey('tag-create'))
    assert(create?.ok === true && create.data?.id, `create failed: ${create?.error?.message}`)
    created.tagId = create.data.id
    assert(create.data.status === 'INACTIVE', `expected INACTIVE, got ${create.data.status}`)
    const activate = await admin('mip.admin.events.catalog.changeStatus', { kind: 'TAG', catalogId: created.tagId, expectedVersion: create.data.version, status: 'ACTIVE' }, newKey('tag-activate'))
    assert(activate?.ok === true && activate.data?.status === 'ACTIVE', `activate failed: ${activate?.error?.message}`)
    created.tagVersion = activate.data.version
    const list = await admin('mip.admin.events.catalog.list', { kind: 'TAG', selectable: true, limit: 100 })
    assert((list?.data?.items || []).some(item => item.id === created.tagId), 'created tag not selectable')
  })

  const title = `QA活动E2E${Math.floor(Math.random() * 900 + 100)}`
  const description = '<h2>活动亮点</h2><p style="text-align:center"><strong>加粗</strong> <em>斜体</em> <u>下划线</u></p><ul><li>列表一</li></ul>'
  const draft = () => ({
    scopeType: 'PLATFORM',
    branchId: null,
    title,
    summary: 'QA 端到端自测（可归档）',
    description,
    contentMedia: [],
    organizerIntroduction: '<p>主办方<strong>介绍</strong></p>',
    notices: '<p>报名<u>须知</u></p>',
    coverAssetId: null,
    eventTypeKey: 'general',
    eventMode: 'OFFLINE',
    accessType: 'FREE',
    registrationPolicy: 'AUTO',
    startsAt: '2031-05-01T02:00:00.000Z',
    endsAt: '2031-05-01T04:00:00.000Z',
    registrationDeadline: null,
    cancellationDeadline: null,
    venueName: 'QA场地',
    address: '',
    cityName: '深圳',
    capacity: null,
    waitlistEnabled: false,
    oversellEnabled: false,
    priceCents: 0,
    registrationSchema: [],
    tagIds: created.tagId ? [created.tagId] : [],
  })

  await check('create event with rich text + tag', async () => {
    const create = await admin('mip.admin.events.save', { draft: draft() }, newKey('event-create'))
    assert(create?.ok === true && create.data?.id, `create failed: ${create?.error?.message}`)
    created.eventId = create.data.id
    created.eventVersion = create.data.version
    return `id ${created.eventId.slice(0, 8)} status ${create.data.status}`
  })

  await check('readback persists formatted rich text + assigned tag', async () => {
    const got = await admin('mip.admin.events.get', { eventId: created.eventId })
    const data = got?.data || {}
    const html = String(data.description || '')
    assert(html.includes('<strong>') && html.includes('<em>') && html.includes('<u>') && html.includes('text-align:center'), 'formatted description not persisted')
    assert(String(data.notices || '').includes('<u>'), 'notices rich text not persisted')
    assert(Array.isArray(data.tagIds) && data.tagIds.includes(created.tagId), 'tag not assigned')
    assert(data.latitude === null && data.longitude === null, 'coordinates should be empty')
    created.eventVersion = data.version
  })

  await check('edit event updates rich text', async () => {
    const next = { ...draft(), title: `${title}改`, description: '<p><strong>改后</strong>内容</p>' }
    const edit = await admin('mip.admin.events.save', { draft: next, eventId: created.eventId, expectedVersion: created.eventVersion }, newKey('event-edit'))
    assert(edit?.ok === true && Number(edit.data.version) > created.eventVersion, `edit failed: ${edit?.error?.message}`)
    created.eventVersion = edit.data.version
    const got = await admin('mip.admin.events.get', { eventId: created.eventId })
    assert(String(got?.data?.description || '').includes('改后'), 'edited description not persisted')
  })

  await check('list lookup finds the created event', async () => {
    const list = await admin('mip.admin.events.list', { filters: { query: title, status: '' }, limit: 20 })
    assert((list?.data?.items || []).some(item => item.id === created.eventId), 'created event not found by search')
  })

  await check('server rejects 21-char title', async () => {
    const res = await admin('mip.admin.events.save', { draft: { ...draft(), title: 'ABCDEFGHIJKLMNOPQRSTU' } }, newKey('neg-title'))
    assert(res?.ok === false && String(res.error?.message || '').includes('20'), 'expected 20-char rejection')
  })
  await check('server rejects empty description', async () => {
    const res = await admin('mip.admin.events.save', { draft: { ...draft(), description: '' } }, newKey('neg-desc'))
    assert(res?.ok === false, 'expected empty-description rejection')
  })
  await check('server rejects tag name over 5 chars', async () => {
    const res = await admin('mip.admin.events.catalog.save', { kind: 'TAG', key: newKey('tag'), name: '123456', description: '', sortOrder: 0 }, newKey('neg-tag'))
    assert(res?.ok === false, 'expected long tag-name rejection')
  })
  await check('server rejects duplicate tag name', async () => {
    const res = await admin('mip.admin.events.catalog.save', { kind: 'TAG', key: newKey('tag'), name: tagName, description: '', sortOrder: 0 }, newKey('neg-dup'))
    assert(res?.ok === false, 'expected duplicate tag rejection')
  })

  if (!keep) {
    await check('cleanup: archive event + tag', async () => {
      if (created.eventId) {
        const res = await admin('mip.admin.events.archive', { eventId: created.eventId, expectedVersion: created.eventVersion, reason: 'QA e2e cleanup' }, newKey('archive-event'))
        assert(res?.ok === true, `event archive failed: ${res?.error?.message}`)
      }
      if (created.tagId) {
        const res = await admin('mip.admin.events.catalog.archive', { kind: 'TAG', catalogId: created.tagId, expectedVersion: created.tagVersion, reason: 'QA e2e cleanup' }, newKey('archive-tag'))
        assert(res?.ok === true, `tag archive failed: ${res?.error?.message}`)
      }
    })
  }
}
catch (error) {
  results.push({ name: 'login', ok: false, detail: String(error?.message || error) })
  console.log(`  FAIL  login -> ${String(error?.message || error)}`)
}
finally {
  try {
    await raw('/api/auth/logout')
  }
  catch { /* best effort */ }
}

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('failed checks:')
  for (const item of failed) {
    console.log(`  - ${item.name}: ${item.detail}`)
  }
}
process.exit(failed.length ? 1 : 0)
