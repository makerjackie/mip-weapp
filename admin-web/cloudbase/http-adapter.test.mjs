/* global Response, Buffer */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHttpHandler, trustedGatewayIp } from './http-adapter.mjs'
import { createStaticHandler } from './static-assets.mjs'

const origin = 'https://admin.example.com'
const event = (extra = {}) => ({ path: '/api/auth/session', httpMethod: 'GET', headers: {}, ...extra })
test('gateway strips spoofed IP and uses trusted metadata; preserves query and cookies', async () => {
  const main = createHttpHandler({ origin, handle: async request => {
    assert.equal(request.headers.get('cf-connecting-ip'), '203.0.113.2')
    assert.equal(request.headers.get('x-forwarded-for'), null)
    assert.equal(request.headers.get('x-cloudbase-context'), null)
    assert.equal(request.headers.get('cookie'), 'session=abc')
    assert.equal(request.url, origin + '/api/auth/session?code=123456')
    const response = new Response('ok')
    response.headers.append('set-cookie', 'a=1; HttpOnly; Secure')
    response.headers.append('set-cookie', 'b=2; HttpOnly; Secure')
    return response
  } })
  const result = await main(event({ headers: { 'cf-connecting-ip': 'spoof', 'x-forwarded-for': 'spoof', 'x-cloudbase-context': 'private', cookie: 'session=abc' }, requestContext: { identity: { sourceIp: '203.0.113.2' } }, queryStringParameters: { code: '123456' } }))
  assert.equal(result.statusCode, 200)
  assert.equal(result.multiValueHeaders['set-cookie'].length, 2)
  assert.equal(Buffer.from(result.body, 'base64').toString(), 'ok')
})
test('spoofed request headers never populate rate limit IP', async () => {
  const main = createHttpHandler({ origin, handle: request => { assert.equal(request.headers.get('cf-connecting-ip'), null); return new Response('ok') } })
  await main(event({ headers: { 'cf-connecting-ip': '203.0.113.4' } }))
})
test('base64 request body roundtrips and oversized UTF8 fails before BFF', async () => {
  let calls = 0
  const main = createHttpHandler({ origin, handle: async request => { calls++; assert.equal(await request.text(), '你好'); return new Response('ok') } })
  assert.equal((await main(event({ httpMethod: 'POST', body: Buffer.from('你好').toString('base64'), isBase64Encoded: true }))).statusCode, 200)
  assert.equal((await main(event({ httpMethod: 'POST', body: '中'.repeat(600000) }))).statusCode, 413)
  assert.equal(calls, 1)
})
test('invalid origin, absolute path and thrown failures fail closed without secrets', async () => {
  const main = createHttpHandler({ origin, handle: () => { throw new Error('private mysql password') } })
  assert.equal((await main(event({ path: '//evil.example/api' }))).statusCode, 400)
  assert.equal((await createHttpHandler({ origin: 'http://insecure.example' })(event())).statusCode, 503)
  const result = await main(event())
  assert.equal(result.statusCode, 503)
  assert.equal(result.body.includes('private'), false)
})
test('static assets return MIME, unknown files 404 and HEAD no body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mip-admin-assets-'))
  try {
    await writeFile(join(root, 'index.html'), '<html>admin</html>')
    await writeFile(join(root, '.env'), 'secret')
    const main = createHttpHandler({ origin, serveStatic: createStaticHandler(root) })
    const result = await main(event({ path: '/' }))
    assert.equal(result.headers['content-type'], 'text/html; charset=utf-8')
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal((await main(event({ path: '/missing.js' }))).statusCode, 404)
    assert.equal((await main(event({ path: '/.env' }))).statusCode, 404)
    assert.equal((await main(event({ path: '/', httpMethod: 'HEAD' }))).body, '')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CloudBase JSON runtime context provides per-invocation trusted source IP', () => {
  assert.equal(trustedGatewayIp(event(), { environment: JSON.stringify({ TCB_SOURCE_IP: '203.0.113.7', WX_CLIENTIP: '203.0.113.8' }) }), '203.0.113.7')
  assert.equal(trustedGatewayIp(event(), { environment: JSON.stringify({ WX_CLIENTIPV6: '2001:db8::1' }) }), '2001:db8::1')
  assert.equal(trustedGatewayIp(event(), { environ: 'OTHER=value;TCB_SOURCE_IP=203.0.113.9;EMPTY=' }), '203.0.113.9')
  assert.equal(trustedGatewayIp(event(), {}), undefined)
})
test('invalid platform IP never trusts spoofed headers or nested body context', () => {
  const spoofed = event({ headers: { 'x-forwarded-for': '203.0.113.4', 'x-real-ip': '203.0.113.4', 'cf-connecting-ip': '203.0.113.4', 'x-cloudbase-context': JSON.stringify({ TCB_SOURCE_IP: '203.0.113.4' }) }, body: JSON.stringify({ environment: { TCB_SOURCE_IP: '203.0.113.4' } }) })
  assert.equal(trustedGatewayIp(spoofed, { environment: '{invalid' }), undefined)
  assert.equal(trustedGatewayIp(spoofed, { environment: JSON.stringify({ TCB_SOURCE_IP: '203.0.113.4,203.0.113.5' }) }), undefined)
  assert.equal(trustedGatewayIp(spoofed, { environment: JSON.stringify({ TCB_SOURCE_IP: null, WX_CLIENTIP: '203.0.113.6' }) }), '203.0.113.6')
})
