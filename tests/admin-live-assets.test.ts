import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { it } from 'vitest'
import { validateManifest, verifyLiveAssets } from '../scripts/verify-admin-live-assets.mjs'

const html = '<!doctype html><script type="module" src="/assets/index-testhash.js"></script>'
const js = 'console.log("current build")'
const file = (path: string, text: string) => ({ path, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })
const manifest = { prefix: 'mip-admin-console/', files: [file('index.html', html), file('assets/index-testhash.js', js)] }
const origin = 'https://admin.example.test'
const response = (content: string, mime: string, status = 200) => new Response(content, { status, headers: { 'content-type': mime } })

it('accepts matching public bytes without recording the origin', async () => {
  const report = await verifyLiveAssets({ origin, manifest, fetchImpl: async (url: string) => url === `${origin}/` ? response(html, 'text/html') : response(js, 'text/javascript') })
  assert.equal(report.filesMatched, 2)
  assert.equal(report.entry, '/assets/index-testhash.js')
  assert.ok(!JSON.stringify(report).includes(origin))
})

it('rejects stale HTML and missing JS even when a gateway otherwise responds', async () => {
  await assert.rejects(verifyLiveAssets({ origin, manifest, fetchImpl: async () => response('<html>old release</html>', 'text/html') }), /mismatch/)
  await assert.rejects(verifyLiveAssets({ origin, manifest, fetchImpl: async (url: string) => url === `${origin}/` ? response(html, 'text/html') : response('missing', 'text/plain', 404) }), /HTTP mismatch/)
})

it('rejects wrong resource MIME even with the expected bytes', async () => {
  await assert.rejects(verifyLiveAssets({ origin, manifest, fetchImpl: async (url: string) => url === `${origin}/` ? response(html, 'text/html') : response(js, 'text/html') }), /MIME mismatch/)
})

it('rejects path traversal and metadata in a hosting manifest', () => {
  for (const path of ['../outside.js', 'assets/../outside.js', 'assets/%2e%2e/outside.js', '/outside.js', 'assets/private.key', 'assets/source.js.map', '_worker.js']) {
    assert.throws(() => validateManifest({ ...manifest, files: [...manifest.files, file(path, js)] }))
  }
})
