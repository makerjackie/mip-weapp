'use strict'

const { createHmac, randomBytes } = require('node:crypto')
const { canonicalJson } = require('./web-bff-auth')

const WEB_LOGIN_CONFIRM_TRANSPORT = 'MIP_WEB_LOGIN_CONFIRM_V1'

function createWebLoginConfirmationClient({
  endpoint,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  nonce = () => randomBytes(18).toString('base64url'),
  secret,
} = {}) {
  const normalizedEndpoint = exactHttpsUrl(endpoint)

  async function confirm({ appId, challengeCode, displayName, openId } = {}) {
    if (!normalizedEndpoint
      || typeof secret !== 'string'
      || secret.length < 32
      || typeof fetchImpl !== 'function'
      || typeof now !== 'function'
      || typeof nonce !== 'function') {
      throw codedError('WEB_LOGIN_CONFIG_REQUIRED')
    }
    if (!trustedIdentifier(appId, 64)
      || !trustedIdentifier(openId, 128)
      || typeof challengeCode !== 'string'
      || !/^[A-HJ-NP-Z2-9]{8}$/.test(challengeCode)
      || (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 80))) {
      throw codedError('WEB_LOGIN_REQUEST_INVALID')
    }
    const unsigned = {
      transport: WEB_LOGIN_CONFIRM_TRANSPORT,
      timestamp: now(),
      nonce: nonce(),
      challengeCode,
      principal: {
        appId,
        openId,
        ...(displayName ? { displayName } : {}),
      },
    }
    if (!Number.isSafeInteger(unsigned.timestamp)
      || !/^[A-Za-z0-9_-]{24,128}$/.test(unsigned.nonce)) {
      throw codedError('WEB_LOGIN_CONFIG_REQUIRED')
    }
    const signature = createHmac('sha256', secret)
      .update(canonicalJson(unsigned))
      .digest('hex')

    let response
    try {
      response = await fetchImpl(normalizedEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...unsigned, signature }),
        signal: AbortSignal.timeout(8_000),
      })
    }
    catch {
      throw codedError('WEB_LOGIN_UNAVAILABLE')
    }
    const payload = await safeJson(response)
    if (response.status === 404 && payload?.error?.code === 'CHALLENGE_NOT_FOUND') {
      throw codedError('WEB_LOGIN_CHALLENGE_NOT_FOUND')
    }
    if (!response.ok) throw codedError('WEB_LOGIN_UNAVAILABLE')
    if (!payload || payload.confirmed !== true || Reflect.ownKeys(payload).length !== 1) {
      throw codedError('WEB_LOGIN_RESPONSE_INVALID')
    }
    return { confirmed: true }
  }

  return Object.freeze({ confirm })
}

function exactHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url.toString()
      : ''
  }
  catch { return '' }
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

function codedError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

async function safeJson(response) {
  try { return await response.json() }
  catch { return null }
}

module.exports = {
  WEB_LOGIN_CONFIRM_TRANSPORT,
  createWebLoginConfirmationClient,
}
