'use strict'

const cloud = require('wx-server-sdk')
const { createCallbackHandler } = require('./domain/callback')
const { createLedgerClient } = require('./lib/ledger-client')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const appId = process.env.MEMBERSHIP_APP_ID || ''
const callLedger = createLedgerClient({
  cloud,
  functionName: process.env.MEMBERSHIP_LEDGER_FUNCTION || 'membership-payment-ledger',
  appId,
  secret: process.env.MEMBERSHIP_LEDGER_SECRET || '',
})
const handle = createCallbackHandler({ callLedger, appId })

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    return { errcode: 0, errmsg: 'ok', provider: 'cloudbase-native-cloudpay', contractVersion: 1 }
  }
  try {
    await handle(event)
    return { errcode: 0, errmsg: 'ok' }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[membership-cloudpay-callback]', code)
    return { errcode: -1, errmsg: code }
  }
}
