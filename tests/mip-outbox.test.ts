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
    expect(deployment).toContain('outbox: \'mip-outbox-every-5m\'')
    expect(deployment).toContain('removeOwnedLegacyTimer(spec.name, legacyTimerNames[spec.role])')
    expect(deployment).toContain('assertNoFunctionTimers(spec.name)')
    expect(recovery).toContain('action: \'runBatch\'')
    expect(recovery).toContain('MIP_OUTBOX_HMAC_SECRET')
    expect(JSON.parse(read('package.json')).scripts['outbox:run']).toBe('node scripts/run-outbox.mjs')
  })

  it('injects the same outbox wakeup target and secret into all mutation producers', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    for (const role of ['identity', 'events', 'opportunities', 'commerce', 'admin', 'game', 'tasks', 'ledger']) {
      expect(deployment).toContain(`'${role}'`)
    }
    expect(deployment).toContain('MIP_OUTBOX_FUNCTION_NAME: options.functionNames.outbox')
    expect(deployment).toContain('MIP_OUTBOX_HMAC_SECRET: options.secrets.outboxHmac')
    expect(deployment).toContain('return { ...shared, ...outboxWakeEnvironment, ...extra[role] }')
    const admin = read('cloudfunctions/mip-admin-api/index.js')
    const messagingOperations = read('cloudfunctions/mip-admin-api/domain/operations/messaging.js')
    expect(messagingOperations).toMatch(/mip\.admin\.messageCampaigns\.publish[^\n]+wakesOutbox: true/)
    expect(admin).toContain('if (routeAutomation.outbox)')
    expect(read('cloudfunctions/mip-admin-api/lib/post-commit-automation.js'))
      .toContain('outboxMutationActions.has(action)')
    expect(admin).toContain('sourceFunctionName: \'mip-admin-api\'')
  })

  it('uses event-driven bounded draining and triggers external delivery without a timer', () => {
    const wakeup = read('cloudfunctions/mip-admin-api/lib/outbox-wakeup.js')
    const service = read('cloudfunctions/mip-outbox-worker/domain/service.js')
    const clients = read('cloudfunctions/mip-outbox-worker/lib/internal-clients.js')

    expect(wakeup).toContain('drain: true')
    expect(wakeup).toContain('maxBatches: 100')
    expect(service).toContain('normalizeMaxBatches')
    expect(service).toContain('clients.runNotificationBatch')
    expect(clients).toContain('action: \'runDeliveryBatch\'')
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
