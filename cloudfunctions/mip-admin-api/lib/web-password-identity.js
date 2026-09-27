'use strict'

const { createAdminAccess } = require('../domain/access')
const { decryptPhone } = require('./phone')

// Only called inside the signed BFF transport; never exported in the public operation registry.
function createWebPasswordIdentity({ repository, database, phoneEncryptionKey }) {
  const access = createAdminAccess({ repository })
  return async function webPasswordIdentity(principal) {
    const context = await access.session(principal)
    const { appId, userId } = context.caller
    const row = await database.one(
      'SELECT phone_ciphertext FROM mip_private_profiles WHERE app_id = ? AND user_id = ? AND phone_verified_at IS NOT NULL LIMIT 1',
      [appId, userId],
    )
    if (!row?.phone_ciphertext) throw new Error('AUTH_REQUIRED')
    const phone = decryptPhone(row.phone_ciphertext, phoneEncryptionKey, { appId, userId })
    if (!phone) throw new Error('AUTH_REQUIRED')
    return { phone, userId }
  }
}
module.exports = { createWebPasswordIdentity }
