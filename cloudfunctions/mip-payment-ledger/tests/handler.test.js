'use strict'

const assert = require('node:assert/strict')
const Module = require('node:module')
const { describe, it } = require('node:test')

const legalActions = [
  'getPayableOrder',
  'markPaymentCreated',
  'applyPaymentCallback',
  'getRefundRequest',
  'getRefundRequestForProvider',
  'listPendingRefunds',
  'markRefundCreated',
  'markRefundFailed',
  'markRefundManualReview',
  'applyRefundCallback',
  'grantOwnerTestMembership',
  'revokeOwnerTestMembership',
]

function loadHandlerWithTrustedAuth() {
  const indexPath = require.resolve('../index')
  delete require.cache[indexPath]
  const metrics = { authSecrets: [], databaseFactories: 0, queries: 0 }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
      }
    }
    if (request === './lib/internal-auth' && parent?.filename === indexPath) {
      return {
        assertInternalRequest(event, options) {
          metrics.authSecrets.push(options.secrets)
          return 'app-1'
        },
      }
    }
    if (request === './lib/mysql' && parent?.filename === indexPath) {
      return {
        mysqlDatabase() {
          metrics.databaseFactories += 1
          return {
            async one() {
              metrics.queries += 1
              return { ok: 1 }
            },
          }
        },
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    return { ledgerFunction: require(indexPath), metrics }
  }
  finally {
    Module._load = originalLoad
  }
}

describe('mip payment ledger action dispatch', () => {
  it('fails closed for prototype and unknown handler names before opening the database', async () => {
    const { ledgerFunction, metrics } = loadHandlerWithTrustedAuth()
    const originalError = console.error
    console.error = () => {}
    try {
      for (const action of ['constructor', 'toString', '__proto__', 'unknownAction']) {
        assert.deepEqual(await ledgerFunction.main({ action }), {
          ok: false,
          error: { code: 'UNSUPPORTED_ACTION' },
        })
      }
    }
    finally {
      console.error = originalError
    }

    assert.equal(metrics.databaseFactories, 0)
    assert.equal(metrics.queries, 0)
  })

  it('uses a frozen null-prototype table containing every supported action', () => {
    const { ledgerFunction } = loadHandlerWithTrustedAuth()
    const { handlers } = ledgerFunction._test

    assert.equal(Object.getPrototypeOf(handlers), null)
    assert.equal(Object.isFrozen(handlers), true)
    assert.deepEqual(Object.keys(handlers).sort(), [...legalActions].sort())
    for (const action of legalActions) {
      assert.equal(Object.hasOwn(handlers, action), true)
      assert.equal(typeof handlers[action], 'function')
    }
  })

  it('keeps health outside the signed business action table', () => {
    const { ledgerFunction } = loadHandlerWithTrustedAuth()
    assert.equal(Object.hasOwn(ledgerFunction._test.handlers, 'health'), false)
  })

  it('uses a dedicated secret domain for Owner TEST membership actions', async () => {
    const previousLedgerSecret = process.env.MIP_LEDGER_SECRET
    const previousTestSecret = process.env.MIP_TEST_MEMBERSHIP_HMAC_SECRET
    process.env.MIP_LEDGER_SECRET = 'ledger-secret'.repeat(4)
    process.env.MIP_TEST_MEMBERSHIP_HMAC_SECRET = 'test-membership-secret'.repeat(2)
    const { ledgerFunction, metrics } = loadHandlerWithTrustedAuth()
    if (previousLedgerSecret === undefined) delete process.env.MIP_LEDGER_SECRET
    else process.env.MIP_LEDGER_SECRET = previousLedgerSecret
    if (previousTestSecret === undefined) delete process.env.MIP_TEST_MEMBERSHIP_HMAC_SECRET
    else process.env.MIP_TEST_MEMBERSHIP_HMAC_SECRET = previousTestSecret
    const originalError = console.error
    console.error = () => {}
    try {
      await ledgerFunction.main({ action: 'grantOwnerTestMembership' })
      await ledgerFunction.main({ action: 'getPayableOrder' })
    }
    finally {
      console.error = originalError
    }
    assert.deepEqual(metrics.authSecrets[0], ['test-membership-secrettest-membership-secret'])
    assert.deepEqual(metrics.authSecrets[1], ['ledger-secretledger-secretledger-secretledger-secret', undefined])
  })
})
