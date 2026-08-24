'use strict'

const cloud = require('wx-server-sdk')
const { createCallbackHandler } = require('./domain/callback')
const { identityKey } = require('./lib/identity')
const { createLedgerClient } = require('./lib/ledger-client')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const appId = process.env.MIP_APP_ID || ''
let initializedLedgerClient
function callLedger(action, data) {
  initializedLedgerClient ||= createLedgerClient({
    cloud,
    functionName: process.env.MIP_LEDGER_FUNCTION || 'mip-payment-ledger',
    appId,
    secret: process.env.MIP_LEDGER_SECRET || '',
  })
  return initializedLedgerClient(action, data)
}
const handle = createCallbackHandler({
  appId,
  callLedger,
  identityKey,
  pepper: process.env.MIP_IDENTITY_PEPPER,
})

exports.main = async (event = {}) => {
  if (event.action === 'health') {
    return { errcode: 0, errmsg: 'ok', provider: 'cloudbase-native-cloudpay' }
  }
  try {
    await handle(event)
    return { errcode: 0, errmsg: 'ok' }
  }
  catch (error) {
    const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'INTERNAL_ERROR'
    console.error('[mip-cloudpay-callback]', code)
    return { errcode: -1, errmsg: code }
  }
}
