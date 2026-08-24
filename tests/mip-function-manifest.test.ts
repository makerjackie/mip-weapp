import { describe, expect, it } from 'vitest'
import { createMipCoreFunctionManifest } from '../scripts/lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'

describe('MIP Cloud Function manifest', () => {
  it('deploys only direct mip-* sources into matching mip-* targets', () => {
    const manifest = createMipCoreFunctionManifest(resolveMipFunctionNames())
    expect(manifest).toHaveLength(13)
    for (const item of manifest) {
      expect(item.source).toBe(item.name)
      expect(item.name).toMatch(/^mip-/)
    }
  })

  it('keeps internal ledgers and workers unavailable to clients', () => {
    const manifest = createMipCoreFunctionManifest(resolveMipFunctionNames())
    expect(manifest.filter(item => !item.clientInvokable).map(item => item.role)).toEqual([
      'ledger',
      'notification',
      'outbox',
    ])
    expect(manifest.find(item => item.role === 'notifications')).toEqual({
      role: 'notifications',
      name: 'mip-notifications-api',
      source: 'mip-notifications-api',
      timeout: 20,
      clientInvokable: true,
    })
  })
})
