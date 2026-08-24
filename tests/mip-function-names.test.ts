import { describe, expect, it } from 'vitest'
import { resolveMipFunctionNames } from '../scripts/lib/mip-function-names.mjs'

describe('MIP Cloud Function names', () => {
  it('uses an isolated mip-* suite by default', () => {
    expect(resolveMipFunctionNames()).toEqual({
      identity: 'mip-identity-api',
      media: 'mip-media-api',
      events: 'mip-events-api',
      opportunities: 'mip-opportunities-api',
      community: 'mip-community-api',
      commerce: 'mip-commerce-api',
      admin: 'mip-admin-api',
      growth: 'mip-growth-api',
      tasks: 'mip-tasks-api',
      banners: 'mip-banners-api',
      game: 'mip-game-api',
      ai: 'mip-ai-api',
      notifications: 'mip-notifications-api',
      ledger: 'mip-payment-ledger',
      notification: 'mip-notification-worker',
      outbox: 'mip-outbox-worker',
      pay: 'mip-cloudpay',
      callback: 'mip-cloudpay-callback',
      refund: 'mip-refund-worker',
    })
  })

  it('rejects a legacy shared function target', () => {
    expect(() => resolveMipFunctionNames({
      MIP_IDENTITY_FUNCTION_NAME: 'membership-api',
    })).toThrow('mip-*')
  })

  it('rejects duplicate deployment targets', () => {
    expect(() => resolveMipFunctionNames({
      MIP_IDENTITY_FUNCTION_NAME: 'mip-shared',
      MIP_ADMIN_FUNCTION_NAME: 'mip-shared',
    })).toThrow('unique')
  })
})
