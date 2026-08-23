import { describe, expect, it } from 'vitest'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'

describe('MIP Cloud Function names', () => {
  it('uses an isolated mip-* suite by default', () => {
    expect(resolveMipFunctionNames()).toEqual({
      api: 'mip-api',
      admin: 'mip-admin-api',
      ledger: 'mip-payment-ledger',
      notification: 'mip-notification-worker',
      pay: 'mip-cloudpay',
      callback: 'mip-cloudpay-callback',
    })
  })

  it('rejects a legacy shared function target', () => {
    expect(() => resolveMipFunctionNames({
      MEMBERSHIP_FUNCTION_NAME: 'membership-api',
    })).toThrow('mip-*')
  })

  it('rejects duplicate deployment targets', () => {
    expect(() => resolveMipFunctionNames({
      MEMBERSHIP_FUNCTION_NAME: 'mip-shared',
      MEMBERSHIP_ADMIN_FUNCTION_NAME: 'mip-shared',
    })).toThrow('unique')
  })
})
