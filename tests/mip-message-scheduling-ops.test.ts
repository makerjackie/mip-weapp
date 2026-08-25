import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MIP_STABLE_SECRET_KEYS } from '../scripts/lib/mip-local-secrets.mjs'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('MIP message scheduling operations', () => {
  it('keeps the dispatch HMAC stable and injects it only into the admin runtime', () => {
    const deployment = read('scripts/deploy-functions.mjs')
    const verification = read('scripts/verify-cloud.mjs')
    expect(MIP_STABLE_SECRET_KEYS).toContain('MIP_MESSAGE_DISPATCH_HMAC_SECRET')
    expect(read('.env.example')).toContain('MIP_MESSAGE_DISPATCH_HMAC_SECRET=')
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
    expect(command).toMatch(/limit < 1 \|\| limit > 10/)
    expect(command).toMatch(/maxBatches < 1 \|\| maxBatches > 100/)
    expect(command).toContain('signMessageDispatchRequest(request, secret)')
    expect(command).toContain('variables.MIP_OUTBOX_FUNCTION_NAME !== functionNames.outbox')
    expect(command).toContain('output.outboxWakeup === \'FAILED\'')
    expect(command).not.toContain('console.log(detail)')
    expect(command).not.toContain('console.log(variables)')
  })

  it('documents explicit execution without installing a database-warming timer', () => {
    const operations = read('docs/OPERATIONS.md')
    const deployment = read('scripts/deploy-functions.mjs')
    expect(operations).toContain('pnpm message-campaigns:run-due --')
    expect(operations).toContain('--confirm-message-dispatch=mip-admin-api')
    expect(operations).toContain('--drain --max-batches=100')
    expect(operations).toContain('不安装 timer')
    expect(deployment).not.toContain('mip-message-campaigns-every-5m')
  })
})
