import assert from 'node:assert/strict'
import { it } from 'vitest'
import { adminAssetRoute } from '../scripts/lib/admin-asset-route.mjs'

const root = { Domain: 'admin.example', Path: '/', UpstreamResourceName: 'staticstore', UpstreamResourceType: 'STATIC_STORE', PathRewrite: { StaticStorePrefix: '/mip-admin-console' } }
it('uses the owned BFF static handler for exact admin assets without modifying shared static settings', () => {
  const routes = [root, { Domain: 'other.example', Path: '/assets', UpstreamResourceName: 'other-app' }]
  assert.deepEqual(adminAssetRoute(routes, 'admin.example', 'mip-admin-web-api'), { action: 'createRoute', targetName: 'mip-admin-web-api', path: '/assets', domain: 'admin.example', upstreamResourceType: 'SCF', auth: false, enablePathTransmission: true })
  assert.equal(routes.length, 2)
})
it('refuses routes owned by another app, including more specific paths', () => {
  for (const path of ['/assets', '/assets/other']) {
    assert.throws(() => adminAssetRoute([root, { Domain: 'admin.example', Path: path, UpstreamResourceName: 'other-app', UpstreamResourceType: 'SCF' }], 'admin.example', 'mip-admin-web-api'), /belongs to another application/)
  }
  assert.throws(() => adminAssetRoute([], 'admin.example', 'mip-admin-web-api'), /root ownership/)
})
