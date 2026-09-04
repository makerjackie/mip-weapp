import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { schedulerScfCloudApiRequest } from '../scripts/lib/message-scheduler-cloud.mjs'
import { reconcileMessageScheduler } from '../scripts/lib/message-scheduler-recovery.mjs'
import { MIP_STABLE_SECRET_KEYS } from '../scripts/lib/mip-local-secrets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const require = createRequire(import.meta.url)
const { verifySchedulerReconcile } = require('../cloudfunctions/mip-message-scheduler/lib/auth')

describe('MIP message scheduling operations', () => {
  it('keeps the dispatch HMAC stable and injects it only into the admin runtime', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    const verification = read('scripts/verify-cloud.mjs')
    expect(MIP_STABLE_SECRET_KEYS).toContain('MIP_MESSAGE_DISPATCH_HMAC_SECRET')
    expect(read('.env.example')).not.toContain('MIP_MESSAGE_DISPATCH_HMAC_SECRET=')
    expect(deployment).toContain('messageDispatchHmac: stableSecretValues.MIP_MESSAGE_DISPATCH_HMAC_SECRET')
    expect(deployment).toContain('MIP_MESSAGE_DISPATCH_HMAC_SECRET: options.secrets.messageDispatchHmac')
    expect(verification).toContain('String(variables.MIP_MESSAGE_DISPATCH_HMAC_SECRET || \'\').length < 32')
  })

  it('provides a bounded, confirmed, redacted recovery command with outbox recovery', () => {
    const command = read('scripts/run-message-campaigns.mjs')
    expect(JSON.parse(read('package.json')).scripts['message-campaigns:run-due'])
      .toBe('node scripts/run-message-campaigns.mjs')
    expect(command).toContain('argumentValue(\'--confirm-env=\')')
    expect(command).toContain('argumentValue(\'--confirm-message-dispatch=\')')
    expect(command).toContain('argumentValue(\'--confirm-message-scheduler=\')')
    expect(command).toMatch(/limit < 1 \|\| limit > 10/)
    expect(command).toMatch(/maxBatches < 1 \|\| maxBatches > 100/)
    expect(command).toContain('signMessageDispatchRequest(request, secret)')
    expect(command).toContain('reconcileMessageScheduler({')
    expect(read('scripts/lib/message-scheduler-recovery.mjs'))
      .toContain('signSchedulerReconcile(request, secret)')
    expect(command).toContain('variables.MIP_OUTBOX_FUNCTION_NAME !== functionNames.outbox')
    expect(command).toContain('schedulerScfCloudApiRequest(')
    expect(schedulerScfCloudApiRequest({ region: 'ap-shanghai' }, 'GetFunction', {
      FunctionName: 'mip-admin-api',
      Namespace: 'mip-test-env',
      ShowCode: 'FALSE',
    })).toMatchObject({
      action: 'GetFunction',
      region: 'ap-shanghai',
      service: 'scf',
    })
    expect(command).toContain('output.outboxWakeup === \'FAILED\'')
    expect(command).not.toContain('console.log(detail)')
    expect(command).not.toContain('console.log(variables)')
  })

  it('requires a verified scheduler reconcile after manual due dispatch', async () => {
    const secret = 'manual-recovery-scheduler-secret-at-least-32-bytes'
    let request: Record<string, unknown> = {}
    const result = await reconcileMessageScheduler({
      appId: 'wx0123456789abcdef',
      functionName: 'mip-message-scheduler',
      secret,
      now: () => Date.parse('2030-08-25T10:00:00.000Z'),
      nonce: () => '1234567890abcdef12345678',
      async invoke(input: { request: Record<string, unknown> }) {
        request = input.request
        return { ok: true, data: { verified: true, nextWakeAt: '2030-08-25T11:00:00.000Z' } }
      },
    })
    expect(result).toEqual({ status: 'VERIFIED', nextWakeConfigured: true })
    expect(verifySchedulerReconcile(request, {
      allowedAppIds: new Set(['wx0123456789abcdef']),
      sourceFunction: 'mip-admin-api',
      secret,
      now: () => Number(request.timestamp),
    }).appId).toBe('wx0123456789abcdef')
    await expect(reconcileMessageScheduler({
      appId: 'wx0123456789abcdef',
      functionName: 'mip-message-scheduler',
      secret,
      nonce: () => '1234567890abcdef12345678',
      async invoke() { return { ok: false, error: { code: 'MESSAGE_SCHEDULER_UNAVAILABLE' } } },
    })).rejects.toThrow('MESSAGE_SCHEDULER_UNAVAILABLE')
  })

  it('documents explicit execution without installing a database-warming timer', () => {
    const operations = read('docs/OPERATIONS.md')
    const deployment = read('scripts/deploy-functions.mjs')
    expect(operations).toContain('pnpm message-campaigns:run-due --')
    expect(operations).toContain('--confirm-message-dispatch=mip-admin-api')
    expect(operations).toContain('--confirm-message-scheduler=mip-message-scheduler')
    expect(operations).toContain('--drain --max-batches=100')
    expect(operations).toContain('不安装 timer')
    expect(deployment).not.toContain('mip-message-campaigns-every-5m')
  })
})
