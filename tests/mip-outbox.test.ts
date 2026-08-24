import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMipCoreFunctionManifest } from '../scripts/lib/mip-function-manifest.mjs'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP durable outbox contract', () => {
  it('deploys the outbox worker as a protected direct mip-* function', () => {
    const names = resolveMipFunctionNames()
    const outbox = createMipCoreFunctionManifest(names).find(item => item.role === 'outbox')
    expect(outbox).toEqual({
      role: 'outbox',
      name: 'mip-outbox-worker',
      source: 'mip-outbox-worker',
      timeout: 60,
      clientInvokable: false,
    })
  })

  it('keeps the worker controlled and provides an explicit recovery command', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    const recovery = read('scripts/run-outbox.mjs')
    expect(deployment).toContain('removeForbiddenTimer(functionNames.outbox, \'mip-outbox-every-5m\')')
    expect(recovery).toContain('action: \'runBatch\'')
    expect(recovery).toContain('MIP_OUTBOX_HMAC_SECRET')
    expect(JSON.parse(read('package.json')).scripts['outbox:run']).toBe('node scripts/run-outbox.mjs')
  })

  it('activates only growth rules backed by current confirmed outbox events', () => {
    const seed = JSON.parse(read('database/mysql/mip/seed.demo.json'))
    const byType = new Map(seed.growthRules.map((item: { sourceEventType: string }) => [item.sourceEventType, item]))
    expect(byType.get('identity.profile_completed')).toMatchObject({ status: 'ACTIVE' })
    expect(byType.get('event.checked_in')).toMatchObject({ status: 'ACTIVE' })
    expect(byType.get('referral.confirmed')).toMatchObject({ status: 'DRAFT' })
    expect(byType.get('super_case.published')).toMatchObject({ status: 'DRAFT' })
  })
})
