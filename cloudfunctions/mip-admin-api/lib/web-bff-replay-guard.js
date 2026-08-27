'use strict'

const WEB_BFF_REPLAY_TTL_MS = 2 * 60_000
const WEB_BFF_REPLAY_CLEANUP_INTERVAL_MS = 5 * 60_000

function createWebBffReplayGuard({
  database,
  now = Date.now,
  ttlMs = WEB_BFF_REPLAY_TTL_MS,
} = {}) {
  if (!database || typeof database.query !== 'function'
    || typeof now !== 'function'
    || !Number.isSafeInteger(ttlMs)
    || ttlMs < 60_000
    || ttlMs > 15 * 60_000) {
    throw new Error('WEB_BFF_REPLAY_GUARD_CONFIG_INVALID')
  }

  let cleanupAfter = 0

  async function consume(input = {}) {
    assertReplayInput(input)
    const acceptedAt = now()
    if (!Number.isSafeInteger(acceptedAt)) {
      throw new Error('WEB_BFF_REPLAY_GUARD_CONFIG_INVALID')
    }

    try {
      if (acceptedAt >= cleanupAfter) {
        await database.query(
          `DELETE FROM mip_web_bff_requests
           WHERE expires_at < UTC_TIMESTAMP(3)
           ORDER BY expires_at, app_id, nonce
           LIMIT 100`,
        )
        cleanupAfter = acceptedAt + WEB_BFF_REPLAY_CLEANUP_INTERVAL_MS
      }
      await database.query(
        `INSERT INTO mip_web_bff_requests (
           app_id, nonce, principal_identity_key, action, request_hash, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          input.appId,
          input.nonce,
          input.principalIdentityKey,
          input.action,
          input.requestHash,
          new Date(acceptedAt + ttlMs),
        ],
      )
    }
    catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') throw new Error('WEB_BFF_REPLAYED')
      throw new Error('WEB_BFF_REPLAY_GUARD_UNAVAILABLE')
    }
  }

  return Object.freeze({ consume })
}

function assertReplayInput(input) {
  if (!trustedIdentifier(input.appId, 64)
    || !/^[A-Za-z0-9_-]{24,128}$/.test(input.nonce || '')
    || !/^[a-f0-9]{64}$/.test(input.principalIdentityKey || '')
    || typeof input.action !== 'string'
    || input.action.length < 1
    || input.action.length > 160
    || !/^[a-f0-9]{64}$/.test(input.requestHash || '')) {
    throw new Error('WEB_BFF_REPLAY_GUARD_INPUT_INVALID')
  }
}

function trustedIdentifier(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && /^[A-Za-z0-9_-]+$/.test(value)
}

module.exports = {
  WEB_BFF_REPLAY_CLEANUP_INTERVAL_MS,
  WEB_BFF_REPLAY_TTL_MS,
  createWebBffReplayGuard,
}
