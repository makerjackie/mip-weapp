import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { assertInternalRequest } = require('../cloudfunctions/mip-payment-ledger/lib/internal-auth.js')

const secret = 'test-ledger-secret-with-at-least-32-characters'

const cases = [
  { provider: 'mip-cloudpay', action: 'getPayableOrder', field: 'forSync', value: true, changed: false },
  { provider: 'mip-cloudpay', action: 'applyPaymentCallback', field: 'providerPaidAt', value: '20260914150559', changed: '20260914150600' },
  { provider: 'mip-cloudpay-callback', action: 'applyPaymentCallback', field: 'providerPaidAt', value: '20260914150559', changed: '20260914150600' },
]

describe('payment adapter to ledger signature contract', () => {
  it.each(cases)('authenticates $provider $action including $field and rejects tampering', async ({ provider, action, field, value, changed }) => {
    const { createLedgerClient } = require(`../cloudfunctions/${provider}/lib/ledger-client.js`)
    let received: Record<string, unknown> = {}
    const options = { allowedAppIds: new Set(['test-app']), secrets: [secret] }
    const callLedger = createLedgerClient({
      appId: 'test-app',
      functionName: 'mip-payment-ledger',
      secret,
      cloud: {
        async callFunction({ data }: { data: Record<string, unknown> }) {
          received = data
          assertInternalRequest(data, options)
          return { result: { ok: true, data: { status: 'PAID' } } }
        },
      },
    })
    await expect(callLedger(action, { orderId: 'test-order', [field]: value })).resolves.toEqual({ status: 'PAID' })
    expect(() => assertInternalRequest({ ...received, [field]: changed }, options)).toThrow('FORBIDDEN')
    const omitted = { ...received }
    delete omitted[field]
    expect(() => assertInternalRequest(omitted, options)).toThrow('FORBIDDEN')
  })
})
